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
const testSlashPassword = "slash-testing-password-456!";
const testSlashPasswordHash = [
  "pbkdf2-sha256",
  100_000,
  testSalt.toString("base64url"),
  pbkdf2Sync(testSlashPassword, testSalt, 100_000, 32, "sha256").toString("base64url")
].join("$");
const testEnv = {
  AUTH_USERNAME: "finance-test",
  AUTH_PASSWORD_HASH: testPasswordHash,
  AUTH_SESSION_SECRET: testSessionSecret
};
const testSlashEnv = {
  ...testEnv,
  SLASH_AUTH_USERNAME: "slash-test",
  SLASH_AUTH_PASSWORD_HASH: testSlashPasswordHash
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

test("signed sessions expire and reject tampering or a different hostname", async () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const token = await createAuthSessionToken(testSessionSecret, "slash.thatcanadian.dev", now);
  assert.equal(
    await verifyAuthSessionToken(token, testSessionSecret, "slash.thatcanadian.dev", now),
    true
  );
  assert.equal(
    await verifyAuthSessionToken(token, testSessionSecret, "finance.thatcanadian.dev", now),
    false
  );
  assert.equal(
    await verifyAuthSessionToken(`${token}tampered`, testSessionSecret, "slash.thatcanadian.dev", now),
    false
  );
  assert.equal(
    await verifyAuthSessionToken(
      token,
      testSessionSecret,
      "slash.thatcanadian.dev",
      now + 12 * 60 * 60 * 1000
    ),
    false
  );
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
  assert.match(contentSecurityPolicy, /img-src 'self'/);
  assert.match(contentSecurityPolicy, /manifest-src 'self'/);

  const body = await response?.text() ?? "";
  assert.match(body, /Sign in to Finance/);
  assert.match(body, /data-theme-toggle/);
  assert.match(body, new RegExp(`<script nonce="${nonce}">`));
  assert.match(body, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=20260729-2">/);
  assert.match(body, /<link rel="manifest" href="\/site\.webmanifest\?v=20260729-2" crossorigin="use-credentials">/);
  assert.match(body, /<meta name="apple-mobile-web-app-title" content="Finance">/);
  assert.doesNotMatch(body, /radial-gradient|#8dd8ff/);
});

test("only app branding assets are public before authentication", async () => {
  const publicPaths = [
    "/apple-touch-icon.png",
    "/favicon.svg",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/site.webmanifest"
  ];

  for (const pathname of publicPaths) {
    const response = await enforceSiteAuthentication(
      new Request(`https://finance.example${pathname}`),
      testEnv as never
    );
    assert.equal(response, null, pathname);
  }

  const privateAssetResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/assets/dashboard.js"),
    testEnv as never
  );
  assert.equal(privateAssetResponse?.status, 303);
  assert.equal(
    privateAssetResponse?.headers.get("Location"),
    "/login?returnTo=%2Fassets%2Fdashboard.js"
  );

  const brandingWriteResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/site.webmanifest", { method: "POST" }),
    testEnv as never
  );
  assert.equal(brandingWriteResponse?.status, 303);
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

test("Slash-only credentials authenticate Slash and are rejected by Finance", async () => {
  const slashLoginResponse = await enforceSiteAuthentication(
    new Request("https://slash.thatcanadian.dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "slash-test",
        password: testSlashPassword,
        returnTo: "/"
      })
    }),
    testSlashEnv as never
  );
  assert.equal(slashLoginResponse?.status, 303);

  const cookie = slashLoginResponse?.headers.get("Set-Cookie")?.split(";", 1)[0] ?? "";
  assert.match(cookie, /^__Host-finance_session=/);
  assert.equal(
    await enforceSiteAuthentication(
      new Request("https://slash.thatcanadian.dev/", { headers: { Cookie: cookie } }),
      testSlashEnv as never
    ),
    null
  );

  const financeLoginResponse = await enforceSiteAuthentication(
    new Request("https://finance.thatcanadian.dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "slash-test", password: testSlashPassword })
    }),
    testSlashEnv as never
  );
  assert.equal(financeLoginResponse?.status, 401);

  const financeSessionResponse = await enforceSiteAuthentication(
    new Request("https://finance.thatcanadian.dev/", { headers: { Cookie: cookie } }),
    testSlashEnv as never
  );
  assert.equal(financeSessionResponse?.status, 303);
  assert.equal(financeSessionResponse?.headers.get("Location"), "/login?returnTo=%2F");
});

test("Slash fails closed when its additional credential is not configured", async () => {
  const response = await enforceSiteAuthentication(
    new Request("https://slash.thatcanadian.dev/login"),
    testEnv as never
  );
  assert.equal(response?.status, 503);
});

test("logout clears the secure session cookie and returns to sign in", async () => {
  const token = await createAuthSessionToken(testSessionSecret, "finance.example");
  const response = await enforceSiteAuthentication(
    new Request("https://finance.example/logout", {
      headers: { Cookie: `__Host-finance_session=${token}` }
    }),
    testEnv as never
  );

  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("Location"), "/login");
  const setCookie = response?.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /^__Host-finance_session=;/);
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
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
