import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";
import {
  createAuthSessionToken,
  enforceSiteAuthentication,
  verifyAuthSessionToken,
  verifyLoginCredentials
} from "./auth";
import {
  cancelTelegramOtpTransition,
  issueTelegramOtpTransition,
  verifyTelegramOtpTransition,
  type TelegramOtpStoredState
} from "./telegramOtp";

const testSessionSecret = "test-session-secret-with-enough-entropy";
const testSalt = Buffer.from("0123456789abcdef", "utf8");
const testSlashPassword = "slash-testing-password-456!";
const testSlashPasswordHash = [
  "pbkdf2-sha256",
  100_000,
  testSalt.toString("base64url"),
  pbkdf2Sync(testSlashPassword, testSalt, 100_000, 32, "sha256").toString("base64url")
].join("$");

class FakeTelegramOtpState {
  state: TelegramOtpStoredState | undefined;

  async issueOtp(challengeId: string, codeHash: string, now: number) {
    const transition = issueTelegramOtpTransition(this.state, { challengeId, codeHash, now });
    this.state = transition.state;
    return transition.result;
  }

  async verifyOtp(challengeId: string, codeHash: string, now: number) {
    const transition = await verifyTelegramOtpTransition(this.state, { challengeId, codeHash, now });
    this.state = transition.state;
    return transition.result;
  }

  async cancelOtp(challengeId: string, now: number) {
    this.state = cancelTelegramOtpTransition(this.state, challengeId, now);
  }

  async ensureWebhook() {
    return false;
  }
}

function telegramEnv(state = new FakeTelegramOtpState()) {
  return {
    AUTH_SESSION_SECRET: testSessionSecret,
    TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "5518715264" }),
    TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
    TELEGRAM_OTP_STATE: { getByName: () => state }
  } as never;
}

const slashEnv = {
  AUTH_SESSION_SECRET: testSessionSecret,
  SLASH_AUTH_USERNAME: "slash-test",
  SLASH_AUTH_PASSWORD_HASH: testSlashPasswordHash
} as never;

function formRequest(url: string, values: Record<string, string>, cookie?: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: new URLSearchParams(values)
  });
}

function cookieFrom(response: Response, name: string): string {
  const match = response.headers.get("Set-Cookie")?.match(new RegExp(`${name}=[^;]*`));
  assert.ok(match, `Expected ${name} cookie`);
  return match[0];
}

test("password verification accepts only the configured Slash credential", async () => {
  const credential = { username: "slash-test", passwordHash: testSlashPasswordHash };
  assert.equal(await verifyLoginCredentials("slash-test", testSlashPassword, credential), true);
  assert.equal(await verifyLoginCredentials("slash-test", "wrong-password", credential), false);
  assert.equal(await verifyLoginCredentials("wrong-user", testSlashPassword, credential), false);
});

test("signed sessions expire and reject tampering or a different hostname", async () => {
  const now = Date.parse("2026-07-28T12:00:00.000Z");
  const token = await createAuthSessionToken(
    testSessionSecret,
    "slash.thatcanadian.dev",
    "slash-test",
    now
  );
  assert.equal(await verifyAuthSessionToken(token, testSessionSecret, "slash.thatcanadian.dev", now), true);
  assert.equal(await verifyAuthSessionToken(token, testSessionSecret, "finance.thatcanadian.dev", now), false);
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

test("authentication fails closed when Telegram secrets are missing or malformed", async () => {
  const pageResponse = await enforceSiteAuthentication(new Request("https://finance.example/"), {} as never);
  assert.equal(pageResponse?.status, 503);

  const apiResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/api/health"),
    {} as never
  );
  assert.equal(apiResponse?.status, 503);
  assert.deepEqual(await apiResponse?.json(), { message: "Site authentication is not configured" });

  const malformedResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/login"),
    { ...(telegramEnv() as unknown as Record<string, unknown>), TELEGRAM_AUTH_USERS_JSON: "not-json" } as never
  );
  assert.equal(malformedResponse?.status, 503);
});

test("login page matches the dashboard theme and requests a Telegram username", async () => {
  const response = await enforceSiteAuthentication(
    new Request("https://finance.example/login"),
    telegramEnv()
  );
  assert.equal(response?.status, 200);

  const contentSecurityPolicy = response?.headers.get("Content-Security-Policy") ?? "";
  const nonce = contentSecurityPolicy.match(/script-src 'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.match(contentSecurityPolicy, /img-src 'self'/);
  assert.match(contentSecurityPolicy, /manifest-src 'self'/);

  const body = await response?.text() ?? "";
  assert.match(body, /Sign in to Finance/);
  assert.match(body, /send a code to your Telegram/);
  assert.match(body, /name="step" value="request"/);
  assert.match(body, /data-theme-toggle/);
  assert.match(body, new RegExp(`<script nonce="${nonce}">`));
  assert.match(body, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=20260729-2">/);
  assert.match(body, /<link rel="manifest" href="\/site\.webmanifest\?v=20260729-2" crossorigin="use-credentials">/);
  assert.doesNotMatch(body, /type="password"/);
});

test("only app branding assets are public before authentication", async () => {
  const env = telegramEnv();
  const publicPaths = [
    "/apple-touch-icon.png",
    "/favicon.svg",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/site.webmanifest"
  ];

  for (const pathname of publicPaths) {
    const response = await enforceSiteAuthentication(new Request(`https://finance.example${pathname}`), env);
    assert.equal(response, null, pathname);
  }

  const privateAssetResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/assets/dashboard.js"),
    env
  );
  assert.equal(privateAssetResponse?.status, 303);
  assert.equal(privateAssetResponse?.headers.get("Location"), "/login?returnTo=%2Fassets%2Fdashboard.js");

  const brandingWriteResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/site.webmanifest", { method: "POST" }),
    env
  );
  assert.equal(brandingWriteResponse?.status, 303);
});

test("unauthenticated requests redirect pages and reject APIs", async () => {
  const env = telegramEnv();
  const pageResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/income?view=weekly"),
    env
  );
  assert.equal(pageResponse?.status, 303);
  assert.equal(pageResponse?.headers.get("Location"), "/login?returnTo=%2Fincome%3Fview%3Dweekly");

  const apiResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/api/dashboard"),
    env
  );
  assert.equal(apiResponse?.status, 401);
  assert.deepEqual(await apiResponse?.json(), { message: "Authentication required" });
});

test("Telegram OTP creates a secure session that authenticates the next request", async () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const env = telegramEnv();
  const delivered: Array<{ chatId: string; text: string; protected: boolean }> = [];
  const dependencies = {
    now: () => now,
    generateOtp: () => "123456",
    async sendTelegramMessage(_env: unknown, chatId: string, text: string, protectContent = false) {
      delivered.push({ chatId, text, protected: protectContent });
    }
  };

  const requestResponse = await enforceSiteAuthentication(
    formRequest("https://finance.example/login", {
      step: "request",
      username: "Ali",
      returnTo: "/income"
    }),
    env,
    dependencies as never
  );
  assert.equal(requestResponse?.status, 200);
  assert.deepEqual(delivered, [{
    chatId: "5518715264",
    text: "Your Finance Dash sign-in code is 123456. It expires in 5 minutes. If you didn’t request this code, you can ignore this message.",
    protected: true
  }]);
  assert.match(await requestResponse?.text() ?? "", /Enter the 6-digit code sent to Ali on Telegram/);
  const loginCookie = cookieFrom(requestResponse as Response, "__Host-finance_login");

  const verifyResponse = await enforceSiteAuthentication(
    formRequest("https://finance.example/login", {
      step: "verify",
      code: "123456",
      returnTo: "/income"
    }, loginCookie),
    env,
    dependencies as never
  );
  assert.equal(verifyResponse?.status, 303);
  assert.equal(verifyResponse?.headers.get("Location"), "/income");
  const setCookie = verifyResponse?.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /__Host-finance_session=.*HttpOnly.*Secure.*SameSite=Strict/);
  const sessionCookie = cookieFrom(verifyResponse as Response, "__Host-finance_session");

  const authenticatedResponse = await enforceSiteAuthentication(
    new Request("https://finance.example/income", { headers: { Cookie: sessionCookie } }),
    env,
    dependencies as never
  );
  assert.equal(authenticatedResponse, null);
});

test("wrong Telegram codes are rejected and decrement the remaining attempts", async () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const env = telegramEnv();
  const dependencies = {
    now: () => now,
    generateOtp: () => "123456",
    async sendTelegramMessage() {}
  };
  const requestResponse = await enforceSiteAuthentication(
    formRequest("https://finance.example/login", { step: "request", username: "ali" }),
    env,
    dependencies as never
  );
  const loginCookie = cookieFrom(requestResponse as Response, "__Host-finance_login");
  const verifyResponse = await enforceSiteAuthentication(
    formRequest("https://finance.example/login", { step: "verify", code: "654321" }, loginCookie),
    env,
    dependencies as never
  );
  assert.equal(verifyResponse?.status, 401);
  assert.match(await verifyResponse?.text() ?? "", /Incorrect code\. 4 attempts remaining/);
});

test("unknown usernames do not send a message or reveal whether an account exists", async () => {
  let messages = 0;
  const response = await enforceSiteAuthentication(
    formRequest("https://finance.example/login", { step: "request", username: "Unknown" }),
    telegramEnv(),
    {
      now: () => Date.parse("2026-08-21T20:00:00.000Z"),
      generateOtp: () => "123456",
      async sendTelegramMessage() { messages += 1; }
    } as never
  );
  assert.equal(response?.status, 200);
  assert.equal(messages, 0);
  assert.match(await response?.text() ?? "", /Enter the 6-digit code sent to Unknown on Telegram/);
});

test("Slash credentials authenticate only the Slash hostname", async () => {
  const slashLoginResponse = await enforceSiteAuthentication(
    formRequest("https://slash.thatcanadian.dev/login", {
      username: "slash-test",
      password: testSlashPassword,
      returnTo: "/"
    }),
    slashEnv
  );
  assert.equal(slashLoginResponse?.status, 303);

  const cookie = cookieFrom(slashLoginResponse as Response, "__Host-finance_session");
  assert.equal(
    await enforceSiteAuthentication(
      new Request("https://slash.thatcanadian.dev/", { headers: { Cookie: cookie } }),
      slashEnv
    ),
    null
  );

  const financeSessionResponse = await enforceSiteAuthentication(
    new Request("https://finance.thatcanadian.dev/", { headers: { Cookie: cookie } }),
    telegramEnv()
  );
  assert.equal(financeSessionResponse?.status, 303);
  assert.equal(financeSessionResponse?.headers.get("Location"), "/login?returnTo=%2F");
});

test("Slash fails closed when its credential is not configured", async () => {
  const response = await enforceSiteAuthentication(
    new Request("https://slash.thatcanadian.dev/login"),
    telegramEnv()
  );
  assert.equal(response?.status, 503);
});

test("logout clears both authentication cookies", async () => {
  const token = await createAuthSessionToken(testSessionSecret, "finance.example", "ali");
  const response = await enforceSiteAuthentication(
    new Request("https://finance.example/logout", {
      headers: { Cookie: `__Host-finance_session=${token}` }
    }),
    telegramEnv()
  );

  assert.equal(response?.status, 303);
  assert.equal(response?.headers.get("Location"), "/login");
  const setCookie = response?.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /__Host-finance_session=;.*Max-Age=0/);
  assert.match(setCookie, /__Host-finance_login=;.*Max-Age=0/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
});
