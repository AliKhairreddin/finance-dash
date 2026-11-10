import assert from "node:assert/strict";
import test from "node:test";
import { createAuthSessionToken, enforceSiteAuthentication, getDashboardSession } from "./auth";
import { createStatementPassword, parseStatementPasswords, statementPasswordAttempt, statementPasswordHostname, verifyStatementPassword } from "./statementPassword";

const password = "Test-only-strong-password-264";
const secret = "test-only-statement-session-secret";
const credentials = { "ali m": await createStatementPassword(password), alaa: await createStatementPassword(password + "A") };
function env() {
  let attempts: number[] = [];
  return {
    AUTH_SESSION_SECRET: secret, TELEGRAM_BOT_TOKEN: "test-only",
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "1", "Ali M": "2", Alaa: "3" }),
    TELEGRAM_PASSWORDLESS_USERS_JSON: '["Ali M"]',
    STATEMENT_PASSWORD_USERS_JSON: JSON.stringify(credentials),
    TELEGRAM_OTP_STATE: { getByName: () => ({
      async consumeStatementPasswordAttempt() { const next = statementPasswordAttempt(attempts, Date.now()); attempts = next.times; return next.retryAfterSeconds; },
      async issueOtp() { throw new Error("Password users must not request OTPs"); },
      async verifyOtp() { throw new Error("Password users must not verify OTPs"); }
    }) }
  } as unknown as Parameters<typeof enforceSiteAuthentication>[1];
}
function request(values: Record<string, string>, hostname = statementPasswordHostname, origin = `https://${hostname}`) {
  return new Request(`https://${hostname}/login`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin }, body: new URLSearchParams(values) });
}
function cookie(response: Response) { return response.headers.get("Set-Cookie")!.match(/__Host-finance_session=[^;]+/)![0]; }

test("statement passwords are salted, validated and compared without normalizing the password", async () => {
  assert.notEqual(credentials["ali m"].salt, (await createStatementPassword(password)).salt);
  assert.equal(await verifyStatementPassword(password, credentials["ali m"]), true);
  assert.equal(await verifyStatementPassword(password + " ", credentials["ali m"]), false);
  assert.equal(parseStatementPasswords("{}"), null);
  assert.equal(parseStatementPasswords(JSON.stringify({ ...credentials, ali: credentials.alaa })), null);
  assert.equal(parseStatementPasswords(JSON.stringify(credentials))?.size, 2);
});

test("both statement users get password login without OTP or sign-in alerts", async () => {
  for (const [username, value] of [[" Ali M ", password], ["ALAA", password + "A"]]) {
    const config = env();
    const form = await enforceSiteAuthentication(request({ step: "request", username }), config, { sendTelegramSignInAlert: async () => { throw new Error("No alert required"); } });
    assert.equal(form?.status, 200);
    assert.match(await form!.text(), /autocomplete="current-password"/);
    const response = await enforceSiteAuthentication(request({ step: "password", username, password: value, returnTo: "/?view=documents" }), config);
    assert.equal(response?.status, 303);
    assert.equal(response?.headers.get("Location"), "/?view=documents");
    const authenticated = new Request(`https://${statementPasswordHostname}/api/statements/bootstrap`, { headers: { Cookie: cookie(response!) } });
    assert.equal(await enforceSiteAuthentication(authenticated, config), null);
    assert.equal((await getDashboardSession(authenticated, config))?.username, username.trim().toLowerCase() === "alaa" ? "Alaa" : "Ali M");
    assert.match(response!.headers.get("Set-Cookie")!, /HttpOnly; Secure; SameSite=Strict/);
    const finance = new Request("https://finance.thatcanadian.dev/api/session", { headers: { Cookie: cookie(response!) } });
    assert.equal(await getDashboardSession(finance, config), null);
  }
});

test("password authentication fails closed, rejects cross-origin posts and rate limits guesses", async () => {
  const config = env();
  assert.equal((await enforceSiteAuthentication(request({ step: "password", username: "Ali M", password }, statementPasswordHostname, "https://evil.example"), config))?.status, 403);
  assert.equal((await enforceSiteAuthentication(request({ step: "password", username: "Ali M", password }, "finance.thatcanadian.dev"), config))?.status, 403);
  for (let i = 0; i < 10; i++) {
    const response = await enforceSiteAuthentication(request({ step: "password", username: "Ali M", password: "wrong" }), config);
    assert.equal(response?.status, 401);
    assert.equal(response?.headers.get("Set-Cookie"), null);
  }
  const limited = await enforceSiteAuthentication(request({ step: "password", username: "Ali M", password }), config);
  assert.equal(limited?.status, 429);
  assert.ok(Number(limited?.headers.get("Retry-After")) > 0);
  const missing = { ...env(), STATEMENT_PASSWORD_USERS_JSON: undefined };
  assert.equal((await enforceSiteAuthentication(request({ step: "request", username: "Alaa" }), missing))?.status, 503);
  assert.equal((await enforceSiteAuthentication(request({ step: "password", username: "Alaa", password }), missing))?.status, 503);
  assert.equal(statementPasswordAttempt(Array(10).fill(1000), 901001).retryAfterSeconds, 0);
});

test("old OTP sessions and passwordless exceptions cannot bypass statement passwords; rotation revokes sessions", async () => {
  const config = env();
  for (const subject of ["ali m", "alaa", "passwordless:ali m"]) {
    const token = await createAuthSessionToken(secret, statementPasswordHostname, subject);
    assert.equal(await getDashboardSession(new Request(`https://${statementPasswordHostname}/`, { headers: { Cookie: `__Host-finance_session=${token}` } }), config), null);
  }
  const login = await enforceSiteAuthentication(request({ step: "password", username: "Ali M", password }), config);
  const rotated = { ...config, STATEMENT_PASSWORD_USERS_JSON: JSON.stringify({ ...credentials, "ali m": await createStatementPassword(password) }) };
  assert.equal(await getDashboardSession(new Request(`https://${statementPasswordHostname}/`, { headers: { Cookie: cookie(login!) } }), rotated), null);
  const ali = await createAuthSessionToken(secret, statementPasswordHostname, "ali");
  assert.equal((await getDashboardSession(new Request(`https://${statementPasswordHostname}/`, { headers: { Cookie: `__Host-finance_session=${ali}` } }), config))?.username, "Ali");
});
