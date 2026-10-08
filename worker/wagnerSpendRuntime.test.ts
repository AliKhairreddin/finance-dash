import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare, type Request as RuntimeRequest } from "miniflare";
import ts from "typescript";

test("Wagner loads and caches reports in workerd and never follows source redirects", async () => {
  const config = ts.parseConfigFileTextToJson("wrangler.jsonc", readFileSync("wrangler.jsonc", "utf8")).config;
  const bundled = await build({
    stdin: {
      contents: `
        import { handleWagnerSpendApi } from './shared/wagnerSpendApi';
        const saved = new Map();
        const cache = {
          async acquire(key) { return saved.has(key) ? { status: 'cached', ...saved.get(key) } : { status: 'claimed' }; },
          async save(key, attemptId, entry) { saved.set(key, entry); },
          async release() {}
        };
        export default { fetch(request) { return handleWagnerSpendApi(new URL(request.url), 'test-source-key', cache); } };
      `,
      resolveDir: process.cwd(), loader: "ts"
    },
    bundle: true, format: "esm", write: false
  });
  let sourceCalls = 0;
  let redirect = false;
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [{
      config: {
        name: "wagner-runtime-test", type: "worker",
        compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
        manifest: { mainModule: "worker.mjs", modules: { "worker.mjs": { type: "esm", contents: bundled.outputFiles[0].text } } }
      },
      dev: {
        outboundService: {
          type: "fetcher",
          handler: async (request: RuntimeRequest) => {
            const url = new URL(request.url);
            assert.equal(url.origin, "https://www.inchops.com", "Credentials must never be forwarded to a redirect destination");
            assert.equal(request.headers.get("Authorization"), "Bearer test-source-key");
            sourceCalls++;
            if (redirect) return new Response(null, { status: 307, headers: { Location: "https://unexpected.example/" } });
            if (url.pathname.endsWith("/dimensions")) return Response.json({ agencies: [], ad_accounts: [], buyers: [], teams: [], sources: [], verticals: [], categories: [] });
            return Response.json({
              from: url.searchParams.get("from"), to: url.searchParams.get("to"), currency: "USD", group_by: ["agency"],
              data_through: "2026-10-08", generated_at: "2026-10-08T12:00:00Z",
              totals: { spend_usd: 5, commission_usd: 0.15, rows: 1 },
              rows: [{ agency_id: "agency", agency_name: "Agency", spend_usd: 5, commission_usd: 0.15 }]
            });
          }
        }
      }
    }]
  });
  try {
    const url = "https://finance.example/api/media-spend/wagner?fromDate=2026-09-01&toDate=2026-09-07";
    const first = await runtime.dispatchFetch(url);
    assert.equal(first.status, 200, await first.clone().text());
    const report = await first.json();
    const cached = await runtime.dispatchFetch(url);
    assert.equal(cached.status, 200);
    assert.deepEqual(await cached.json(), report);
    assert.equal(sourceCalls, 1);

    const dimensions = await runtime.dispatchFetch("https://finance.example/api/media-spend/wagner/dimensions");
    assert.equal(dimensions.status, 200, await dimensions.clone().text());
    assert.equal(sourceCalls, 2);

    redirect = true;
    const uncached = "https://finance.example/api/media-spend/wagner?fromDate=2026-09-08&toDate=2026-09-09";
    const rejected = await runtime.dispatchFetch(uncached);
    assert.equal(rejected.status, 502);
    assert.doesNotMatch(await rejected.text(), /test-source-key|unexpected.example/);
    assert.equal(sourceCalls, 3);
    redirect = false;
    assert.equal((await runtime.dispatchFetch(uncached)).status, 200, "A rejected redirect must not be saved as a report");
    assert.equal(sourceCalls, 4);
  } finally {
    await runtime.dispose();
  }
});
