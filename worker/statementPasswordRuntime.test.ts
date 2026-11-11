import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { createStatementPassword } from "./statementPassword";

test("Cloudflare runtime verifies scrypt passwords and serializes concurrent durable login attempts", async () => {
  const password = "isolated-runtime-password-123";
  const credential = await createStatementPassword(password);
  const bundle = await build({
    stdin: { contents: `
      import { enforceSiteAuthentication, getDashboardSession } from './worker/auth';
      export { TelegramOtpState } from './worker/telegramOtpState';
      export default { async fetch(request, bindings) {
        const env = { ...bindings, AUTH_SESSION_SECRET: 'runtime-only-secret', TELEGRAM_BOT_TOKEN: 'no-network',
          TELEGRAM_AUTH_USERS_JSON: '{"Ali":"1","Ali M":"2"}', TELEGRAM_TOPUP_USERS_JSON: '{"Alaa":"3"}', DASHBOARD_ADMINISTRATOR_USERS: 'Alaa', TELEGRAM_PASSWORDLESS_USERS_JSON: '[]',
          STATEMENT_PASSWORD_USERS_JSON: ${JSON.stringify(JSON.stringify({ "ali m": credential, alaa: credential }))} };
        return await enforceSiteAuthentication(request, env) ?? Response.json(await getDashboardSession(request, env));
      } };
    `, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "esm", platform: "browser", external: ["node:*", "cloudflare:*"], write: false
  });
  const runtime = new Miniflare({ telemetry: { enabled: false }, workers: [{
    config: {
      name: "statement-password-runtime", type: "worker", compatibilityDate: "2026-08-21", compatibilityFlags: ["nodejs_compat"],
      manifest: { mainModule: "worker.mjs", modules: { "worker.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
      env: { TELEGRAM_OTP_STATE: { type: "durable-object", workerName: "statement-password-runtime", exportName: "TelegramOtpState" } },
      exports: { TelegramOtpState: { type: "durable-object", storage: "sqlite" } }
    },
    dev: { outboundService: { type: "fetcher", handler: () => { throw new Error("Password login must not contact external services"); } } }
  }] });
  const login = (username: string, value: string, host = "finance.thatcanadian.dev") => runtime.dispatchFetch(`https://${host}/login`, {
    method: "POST", redirect: "manual", headers: { Origin: `https://${host}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ step: "password", username, password: value }).toString()
  });
  try {
    for (const username of ["Ali M", "Alaa"]) {
      const result = await login(username, password);
      assert.equal(result.status, 303, await result.text());
      const cookie = result.headers.get("Set-Cookie")!.match(/__Host-finance_session=[^;]+/)![0];
      const session = await runtime.dispatchFetch("https://finance.thatcanadian.dev/api/session", { headers: { Cookie: cookie } });
      assert.deepEqual(await session.json(), { username, role: "administrator" });
    }
    const guesses = await Promise.all(Array.from({ length: 12 }, (_, i) => login("Alaa", "wrong", i % 2 ? "finance.thatcanadian.dev" : "statements.thatcanadian.dev")));
    assert.equal(guesses.filter(response => response.status === 401).length, 9);
    assert.equal(guesses.filter(response => response.status === 429).length, 3);
    assert.equal((await login("Alaa", password)).status, 429);
  } finally { await runtime.dispose(); }
});
