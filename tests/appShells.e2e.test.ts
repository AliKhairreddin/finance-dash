import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import ts from "typescript";
import { createAuthSessionToken } from "../worker/auth";

const finance = "finance.thatcanadian.dev";
const statements = "statements.thatcanadian.dev";
const receipts = "receipts.thatcanadian.dev";
const secret = "isolated-app-shell-test-secret";
const config = ts.parseConfigFileTextToJson("wrangler.jsonc", await readFile("wrangler.jsonc", "utf8")).config;
let runtime: Miniflare;

before(async () => {
  const bundle = await build({
    entryPoints: [config.main], bundle: true, format: "esm", platform: "browser",
    external: ["node:*", "cloudflare:*"], write: false
  });
  const name = "app-shells-e2e";
  runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [{
      config: {
        name, type: "worker",
        compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
        manifest: { mainModule: "worker.mjs", modules: { "worker.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
        exports: { TelegramOtpState: { type: "durable-object", storage: "sqlite" } },
        env: {
          ASSETS: { type: "assets" },
          AUTH_SESSION_SECRET: { type: "text", value: secret },
          TELEGRAM_BOT_TOKEN: { type: "text", value: "local-test" },
          TELEGRAM_AUTH_USERS_JSON: { type: "text", value: JSON.stringify({ Ali: "1", "Ali M": "2", Alaa: "3", Amin: "4" }) },
          TELEGRAM_PASSWORDLESS_USERS_JSON: { type: "text", value: "[]" },
          TELEGRAM_OTP_STATE: { type: "durable-object", workerName: name, exportName: "TelegramOtpState" }
        },
        assets: {
          directory: config.assets.directory, hasUserWorker: true, runWorkerFirst: config.assets.run_worker_first,
          htmlHandling: config.assets.html_handling, notFoundHandling: config.assets.not_found_handling
        }
      },
      dev: { outboundService: { type: "fetcher", handler: () => { throw new Error("App shell routes must not call external services"); } } }
    }]
  });
});

after(async () => { await runtime?.dispose(); });

async function fetchRoute(host: string, route: string, method = "GET", user?: string) {
  const headers: Record<string, string> = {};
  if (user) headers.Cookie = `__Host-finance_session=${await createAuthSessionToken(secret, host, user)}`;
  return runtime.dispatchFetch(`https://${host}${route}`, { headers, method, redirect: "manual" });
}

async function assertApp(host: string, routes: string[], file: string, user?: string) {
  const expected = await readFile(path.join(config.assets.directory, file), "utf8");
  for (const route of routes) {
    for (const method of ["GET", "HEAD"]) {
      const response = await fetchRoute(host, route, method, user);
      assert.equal(response.status, 200, `${method} ${host}${route} returned ${response.status} (Location: ${response.headers.get("Location")})`);
      assert.equal(response.headers.get("Location"), null);
      assert.match(response.headers.get("Content-Type") ?? "", /^text\/html/);
      assert.equal(await response.text(), method === "HEAD" ? "" : expected);
    }
  }
  const scripts = [...expected.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)];
  assert.ok(scripts.length > 0, `Build ${file} before running the app shell checks`);
  for (const [, src] of scripts) {
    const response = await fetchRoute(host, src, "GET", user);
    assert.equal(response.status, 200, src);
    assert.match(response.headers.get("Content-Type") ?? "", /javascript/);
    assert.equal(await response.text(), await readFile(path.join(config.assets.directory, src), "utf8"));
  }
  return expected;
}

test("public top-up links serve the built form", async () => {
  await assertApp(finance, ["/top-up", "/top-up/", "/payments", "/payments/?source=test"], "top-up.html");
});

test("the receipt camera opens at its manifest start URL without a session", async () => {
  await assertApp(receipts, ["/"], "receipt-capture.html");
});

test("signed-in Statements links serve the built workspace on both hosts", async () => {
  const html = await assertApp(statements, ["/", "/?company=artec", "/statements", "/statements/", "/statements/transactions?search=test"], "statements.html", "ali");
  assert.match(html, /<title>Statements Dashboard<\/title>/);
  assert.match(html, /statement-icons\/statement-ledger-v1\.svg/);
  await assertApp(finance, ["/statements", "/statements/transactions?company=artec"], "statements.html", "ali");
  for (const host of [finance, statements]) {
    const response = await fetchRoute(host, "/statements.html", "GET", "ali");
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("Location")!, `https://${host}`).pathname, "/statements");
  }
});

test("signed-out and unauthorized users cannot open the private Statements workspace", async () => {
  const signedOut = await fetchRoute(statements, "/");
  assert.equal(signedOut.status, 303);
  assert.equal(signedOut.headers.get("Location"), "/login?returnTo=%2F");
  assert.equal((await fetchRoute(statements, "/", "GET", "amin")).status, 403);
});
