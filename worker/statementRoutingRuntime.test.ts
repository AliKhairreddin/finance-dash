import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { createAuthSessionToken } from "./auth";

test("signed-in Statements routes serve HTML without Cloudflare asset redirect loops", async () => {
  const config = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile("wrangler.jsonc", "utf8")).config;
  const directory = await mkdtemp(path.join(tmpdir(), "statement-routing-"));
  const secret = "isolated-statement-routing-runtime-test-secret";
  let runtime: Miniflare | undefined;
  try {
    await copyFile("statements.html", path.join(directory, "statements.html"));
    await writeFile(path.join(directory, "index.html"), "<title>Finance fixture</title>");
    await mkdir(path.join(directory, "assets"));
    await writeFile(path.join(directory, "assets/app.js"), "// static asset fixture");
    const bundled = await build({
      stdin: {
        contents: `
          import { routeStatementSurface } from './worker/statementRouting';
          export default { async fetch(request, env) {
            return await routeStatementSurface(request, {
              ...env, AUTH_SESSION_SECRET: ${JSON.stringify(secret)},
              TELEGRAM_BOT_TOKEN: 'test-only',
              TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: '1', 'Ali M': '2', Alaa: '3', Amin: '4' }),
              TELEGRAM_PASSWORDLESS_USERS_JSON: '[]', TELEGRAM_OTP_STATE: { getByName: () => ({}) }
            }) ?? env.ASSETS.fetch(request);
          } };
        `,
        resolveDir: process.cwd(), loader: "ts"
      },
      bundle: true, format: "esm", platform: "browser", external: ["node:*"], write: false
    });
    runtime = new Miniflare({
      telemetry: { enabled: false },
      workers: [{
        config: {
          name: "statement-routing-runtime-test", type: "worker",
          compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
          manifest: { mainModule: "worker.mjs", modules: { "worker.mjs": { type: "esm", contents: bundled.outputFiles[0].text } } },
          env: { ASSETS: { type: "assets" } },
          assets: {
            directory, hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first,
            htmlHandling: config.assets.html_handling,
            notFoundHandling: config.assets.not_found_handling
          }
        },
        dev: { outboundService: { type: "fetcher", handler: () => { throw new Error("Routing tests must not call external services"); } } }
      }]
    });
    for (const hostname of ["statements.thatcanadian.dev", "finance.thatcanadian.dev"]) {
      const cookie = `__Host-finance_session=${await createAuthSessionToken(secret, hostname, "ali")}`;
      const routes = hostname.startsWith("statements.")
        ? ["/", "/?company=artec", "/statements", "/statements/", "/statements/transactions?search=test"]
        : ["/statements", "/statements/transactions?company=artec"];
      for (const route of routes) {
        for (const method of ["GET", "HEAD"]) {
          const response = await runtime.dispatchFetch(`https://${hostname}${route}`, { method, headers: { Cookie: cookie }, redirect: "manual" });
          assert.equal(response.status, 200, `${method} ${hostname}${route} must serve the shell, received redirect to ${response.headers.get("Location")}`);
          assert.equal(response.headers.get("Location"), null);
          assert.match(response.headers.get("Content-Type") ?? "", /text\/html/);
          const html = await response.text();
          if (method === "GET") {
            assert.match(html, /<title>Statements Dashboard<\/title>/);
            assert.match(html, /statement-icons\/statement-ledger-v1\.svg/);
          } else assert.equal(html, "");
        }
      }
      const canonical = await runtime.dispatchFetch(`https://${hostname}/statements.html`, { headers: { Cookie: cookie }, redirect: "manual" });
      assert.equal(canonical.status, 307, "The runtime must exercise real Cloudflare HTML canonicalization");
      assert.equal(new URL(canonical.headers.get("Location")!, `https://${hostname}`).pathname, "/statements");
      const asset = await runtime.dispatchFetch(`https://${hostname}/assets/app.js`, { headers: { Cookie: cookie }, redirect: "manual" });
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "// static asset fixture");
    }
    const unauthenticated = await runtime.dispatchFetch("https://statements.thatcanadian.dev/", { redirect: "manual" });
    assert.equal(unauthenticated.status, 303);
    assert.equal(unauthenticated.headers.get("Location"), "/login?returnTo=%2F");
    const forbidden = await runtime.dispatchFetch("https://statements.thatcanadian.dev/", {
      headers: { Cookie: `__Host-finance_session=${await createAuthSessionToken(secret, "statements.thatcanadian.dev", "amin")}` }, redirect: "manual"
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
