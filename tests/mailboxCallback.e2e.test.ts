import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createAuthSessionToken } from "../worker/auth";
import { routeStatementSurface } from "../worker/statementRouting";
import { mailboxCallback, mailboxOrigin } from "../shared/statementMailboxes";

test("a mailbox provider return restores the Strict session for the same-origin form POST", async t => {
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND"] });
  t.after(() => browser.close());
  const secret = "isolated-mailbox-session-secret";
  const env = {
    AUTH_SESSION_SECRET: secret, TELEGRAM_BOT_TOKEN: "local-test", TELEGRAM_AUTH_USERS_JSON: '{"Ali":"1"}',
    TELEGRAM_OTP_STATE: {}, CONVEX_URL: "https://fixture.convex.cloud", CONVEX_SERVICE_TOKEN: "fixture",
  } as WorkerEnv;
  const exchanged: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), env.CONVEX_URL + "/api/action");
    const action = JSON.parse(String(init?.body));
    assert.equal(action.path, "statementMailboxSync:finish");
    assert.equal(action.args[0].actor, "Ali");
    assert.equal(action.args[0].code, "fixture-code");
    exchanged.push(action.args[0].provider);
    return Response.json({ status: "success", value: null });
  });
  for (const provider of ["gmail", "outlook"] as const) {
    const automatic = provider === "gmail";
    const context = await browser.newContext({ javaScriptEnabled: automatic, serviceWorkers: "block" });
    try {
      const state = "a".repeat(64);
      const session = await createAuthSessionToken(secret, new URL(mailboxOrigin).hostname, "ali");
      await context.addCookies([
        { name: "__Host-finance_session", value: session, url: mailboxOrigin, secure: true, httpOnly: true, sameSite: "Strict" },
        { name: "__Host-mailbox-state", value: state, url: mailboxOrigin, secure: true, httpOnly: true, sameSite: "Lax" },
      ]);
      const callback = new URL(mailboxCallback(provider));
      callback.search = new URLSearchParams({ state, code: "fixture-code" }).toString();
      const providerUrl = "https://mail-provider.test/return";
      const page = await context.newPage();
      await context.route("**/*", async route => {
        const navigation = route.request();
        const url = new URL(navigation.url());
        if (url.href === providerUrl) {
          return route.fulfill({ contentType: "text/html", body: `<a href="${callback.href}">Return to Statements</a>` });
        }
        if (url.origin !== mailboxOrigin || url.pathname !== callback.pathname) {
          return route.fulfill({ status: 404, body: "" });
        }
        const result = await routeStatementSurface(new Request(url, {
          method: navigation.method(), headers: await navigation.allHeaders(), body: navigation.postData(),
        }), env);
        assert.ok(result);
        await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: await result.text() });
      });
      await page.goto(providerUrl);
      const landing = page.waitForRequest(r => r.url() === callback.href && r.method() === "GET");
      const submission = page.waitForResponse(r => r.request().method() === "POST");
      await page.getByRole("link", { name: "Return to Statements" }).click();
      assert.doesNotMatch((await (await landing).allHeaders()).cookie ?? "", /__Host-finance_session=/);
      if (!automatic) await page.getByRole("button", { name: "Continue to Statements" }).click();
      const result = await submission;
      const headers = await result.request().allHeaders();
      assert.match(headers.cookie ?? "", /__Host-finance_session=/);
      assert.equal(result.status(), 303, provider + " callback");
      assert.equal(headers.origin, mailboxOrigin);
      assert.ok(!headers.referer || headers.referer === mailboxOrigin + "/", "The callback URL must stay out of Referer.");
      assert.equal(result.headers().location, "/?view=settings&mailboxResult=connected");
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(exchanged, ["gmail", "outlook"]);
});
