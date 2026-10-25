import assert from "node:assert/strict";
import test from "node:test";
import { createAuthSessionToken } from "./auth";
import { isStatementSurface, routeStatementSurface } from "./statementRouting";

const secret = "statement-routing-test-secret-with-enough-entropy";
const env = {
  AUTH_SESSION_SECRET: secret, TELEGRAM_BOT_TOKEN: "test-bot", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "1", "Ali M": "2", Alaa: "3", Amin: "4" }),
  TELEGRAM_PASSWORDLESS_USERS_JSON: "[]", TELEGRAM_OTP_STATE: { getByName: () => ({}) }, ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) }
} as unknown as WorkerEnv;
async function request(hostname: string, path: string, username: string) {
  return new Request(`https://${hostname}${path}`, { headers: { Cookie: `__Host-finance_session=${await createAuthSessionToken(secret, hostname, username)}` } });
}
test("statements host cannot route into finance or public financial hooks", async () => {
  for (const path of ["/api/snapshot", "/api/telegram/webhook", "/api/internal/documents/archive-invoices"]) {
    assert.equal((await routeStatementSurface(await request("statements.thatcanadian.dev", path, "ali"), env))?.status, 404);
  }
  assert.equal(await routeStatementSurface(await request("finance.thatcanadian.dev", "/api/snapshot", "ali"), env), null);
  assert.equal(isStatementSurface(new URL("https://finance.thatcanadian.dev/statements-elsewhere")), false);
});
test("only the three named existing users can open statements", async () => {
  for (const username of ["ali", "ali m", "alaa"]) {
    const response = await routeStatementSurface(await request("statements.thatcanadian.dev", "/", username), env);
    assert.equal(response?.status, 200); assert.equal(await response?.text(), "/");
  }
  assert.equal((await routeStatementSurface(await request("statements.thatcanadian.dev", "/", "amin"), env))?.status, 403);
  assert.equal((await routeStatementSurface(new Request("https://statements.thatcanadian.dev/"), env))?.status, 303);
});
test("sessions are host bound and static OCR assets carry no private access", async () => {
  const token = await createAuthSessionToken(secret, "finance.thatcanadian.dev", "ali");
  assert.equal((await routeStatementSurface(new Request("https://statements.thatcanadian.dev/", { headers: { Cookie: `__Host-finance_session=${token}` } }), env))?.status, 303);
  const asset = await routeStatementSurface(new Request("https://finance.thatcanadian.dev/statement-ocr-assets/pdf.min.mjs"), env);
  assert.equal(asset?.status, 200); assert.equal(asset?.headers.get("Access-Control-Allow-Origin"), "*");
});
