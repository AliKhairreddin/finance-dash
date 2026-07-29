import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";
import {
  createAuthSessionToken,
  enforceSiteAuthentication,
  verifyAuthSessionToken,
  verifyLoginCredentials
} from "./auth";

const testSessionSecret = "test-session-secret-with-enough-entropy";
const testSalt = Buffer.from("0123456789abcdef", "utf8");
const testPassword = "testing-password-123!";
const testPasswordHash = [
  "pbkdf2-sha256",
  100_000,
  testSalt.toString("base64url"),
  pbkdf2Sync(testPassword, testSalt, 100_000, 32, "sha256").toString("base64url")
].join("$");
const testEnv = {
  AUTH_USERNAME: "finance-test",
  AUTH_PASSWORD_HASH: testPasswordHash,
  AUTH_SESSION_SECRET: testSessionSecret
};

test("login credential verification accepts only the configured username and password", async () => {
  assert.equal(
    await verifyLoginCredentials("finance-test", testPassword, {
      username: testEnv.AUTH_USERNAME,
      passwordHash: testEnv.AUTH_PASSWORD_HASH
    }),
    true
  );
  assert.equal(
    await verifyLoginCredentials("finance-test", "wrong-password", {
      username: testEnv.AUTH_USERNAME,
      passwordHash: testEnv.AUTH_PASSWORD_HASH
    }),
    false
  );
  assert.equal(
    await verifyLoginCredentials("wrong-user", testPassword, {
      username: testEnv.AUTH_USERNAME,
      passwordHash: testEnv.AUTH_PASSWORD_HASH
    }),
    false
  );
});

test("signed sessions expire and reject tampering", async () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const token = await createAuthSessionToken(testSessionSecret, now);
  assert.equal(await verifyAuthSessionToken(token, testSessionSecret, now), true);
  assert.equal(await verifyAuthSessionToken(`${token}tampered`, testSessionSecret, now), false);
  assert.equal(await verifyAuthSessionToken(token, testSessionSecret, now + 12 * 60 * 60 * 1000), false);
});

test("authentication fails closed when required secrets are missing", async () => {
  const pageResponse = await enforceSiteAuthentication(new Request("https://finance.example/"), {} as never);
  assert.equal(pageResponse?.status, 503);

  const apiResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/api/health"),
    {} as never
  );
  assert.equal(apiResponse?.status, 503);
  assert.deepEqual(await apiResponse?.json(), { message: "Site authentication is not configured" });
});

test("authentication fails closed when the password verifier is unsupported", async () => {
  const response = await enforceSiteAuthentication(
    new Request("https://finance.example/login"),
    {
      ...testEnv,
      AUTH_PASSWORD_HASH: testEnv.AUTH_PASSWORD_HASH.replace("$100000$", "$210000$")
    } as never
  );
  assert.equal(response?.status, 503);
});

test("login page matches the dashboard theme and authorizes only its nonce-scoped script", async () => {
  const response = await enforceSiteAuthentication(
    new Request("https://finance.example/login"),
    testEnv as never
  );
  assert.equal(response?.status, 200);

  const contentSecurityPolicy = response?.headers.get("Content-Security-Policy") ?? "";
  const nonce = contentSecurityPolicy.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);

  const body = await response?.text() ?? "";
  assert.match(body, /Sign in to Finance/);
  assert.match(body, /data-theme-toggle/);
  assert.match(body, new RegExp(`<script nonce="${nonce}">`));
  assert.doesNotMatch(body, /radial-gradient|#8dd8ff/);
});

test("unauthenticated requests redirect pages and reject APIs", async () => {
  const pageResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/income?view=weekly"),
    testEnv as never
  );
  assert.equal(pageResponse?.status, 303);
  assert.equal(pageResponse?.headers.get("Location"), "/login?returnTo=%2Fincome%3Fview%3Dweekly");

  const apiResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/api/dashboard"),
    testEnv as never
  );
  assert.equal(apiResponse?.status, 401);
  assert.deepEqual(await apiResponse?.json(), { message: "Authentication required" });
});

test("valid login creates a secure cookie that authenticates the next request", async () => {
  const body = new URLSearchParams({
    username: "finance-test",
    password: testPassword,
    returnTo: "/income"
  });
  const loginResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }),
    testEnv as never
  );

  assert.equal(loginResponse?.status, 303);
  assert.equal(loginResponse?.headers.get("Location"), "/income");
  const setCookie = loginResponse?.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /^__Host-finance_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);

  const cookie = setCookie.split(";", 1)[0];
  const authenticatedResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/income", { headers: { Cookie: cookie } }),
    testEnv as never
  );
  assert.equal(authenticatedResponse, null);
});

test("invalid credentials return the generic login error without setting a cookie", async () => {
  const response = await enforceSiteAuthentication(
    new Request("https://finance.example/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "finance-test", password: "not-the-password" })
    }),
    testEnv as never
  );

  assert.equal(response?.status, 401);
  assert.equal(response?.headers.has("Set-Cookie"), false);
  assert.match(await response?.text() ?? "", /Invalid username or password/);
});
