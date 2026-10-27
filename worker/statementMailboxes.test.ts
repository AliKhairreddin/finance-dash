import assert from "node:assert/strict";
import test from "node:test";
import { mailboxAuthorizationUrl, mailboxCallbackLanding, handleMailboxApi } from "./statementMailboxes";
import { mailboxCallback, mailboxScanDate } from "../shared/statementMailboxes";
import { mailboxBytes, mailboxDecrypt, mailboxEncrypt, mailboxJson, mailboxList, mailboxPage, mailboxUrl, MailboxHttpError } from "../shared/mailboxHttp";
import { mailboxContent } from "../shared/mailboxContent";
import { PDFDocument } from "pdf-lib";

test("mailbox authorization selects one account with read-only scopes, offline access and PKCE", () => {
  for (const provider of ["gmail", "outlook"] as const) {
    const url = new URL(mailboxAuthorizationUrl(provider, "app", "state", "challenge"));
    assert.equal(url.searchParams.get("redirect_uri"), mailboxCallback(provider));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("prompt")?.includes("select_account"));
    assert.doesNotMatch(url.searchParams.get("scope")!, /Mail\.ReadWrite|gmail\.modify|Mail\.Send/);
  }
  assert.equal(new URL(mailboxAuthorizationUrl("gmail", "app", "state", "challenge")).searchParams.get("access_type"), "offline");
});
test("OAuth callback requires the host-bound state and escapes the authorization code", async () => {
  const state = "a".repeat(64), url = new URL(mailboxCallback("gmail")); url.search = new URLSearchParams({ state, code: '"><script>alert(1)</script>' }).toString();
  assert.equal(mailboxCallbackLanding(new Request(url))?.status, 303);
  const landing = mailboxCallbackLanding(new Request(url, { headers: { Cookie: `__Host-mailbox-state=${state}` } }));
  assert.equal(landing?.status, 200); assert.match(landing!.headers.get("Content-Security-Policy")!, /frame-ancestors 'none'/);
  const html = await landing!.text(); assert.match(html, /method="post"/); assert.doesNotMatch(html, /<script>alert/); assert.match(html, /&lt;script&gt;/);
  const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "secret" };
  assert.equal((await handleMailboxApi(new Request(url, { method: "POST", headers: { Origin: "https://attacker.example" } }), env, { username: "Ali" } as never))?.status, 403);
  assert.equal((await handleMailboxApi(new Request(url), env, null))?.status, 403);
});
test("scan dates and provider cursors reject invalid or off-origin values", () => {
  assert.equal(mailboxScanDate("2026-01-01", Date.parse("2026-10-27")), "2026-01-01");
  for (const value of ["2026-02-30", "2030-01-01", "", "yesterday"]) assert.throws(() => mailboxScanDate(value, Date.parse("2026-10-27")));
  assert.throws(() => mailboxList("outlook", 0, 1000, "https://evil.example/steal"));
  assert.throws(() => mailboxList("outlook", 0, 1000, "https://graph.microsoft.com/v1.0/me/drive"));
  assert.throws(() => mailboxUrl("https://user:password@graph.microsoft.com/v1.0/me/messages", "outlook"));
  assert.throws(() => mailboxPage("outlook", {})); assert.throws(() => mailboxPage("gmail", {}));
  assert.deepEqual(mailboxPage("gmail", { resultSizeEstimate: 0 }), { ids: [], next: undefined });
  assert.deepEqual(mailboxPage("outlook", { value: [{ id: "one" }, { id: "one" }] }).ids, ["one"]);
});
test("credential encryption is authenticated and randomized", async () => {
  const key = "ab".repeat(32), a = await mailboxEncrypt("refresh-secret", key), b = await mailboxEncrypt("refresh-secret", key);
  assert.notEqual(a, b); assert.equal(await mailboxDecrypt(a, key), "refresh-secret"); assert.doesNotMatch(a, /refresh-secret/);
  await assert.rejects(mailboxDecrypt(a, "cd".repeat(32))); await assert.rejects(mailboxDecrypt(a.slice(0, -2) + "00", key));
});
test("rate limits preserve Retry-After without exposing provider bodies", async () => {
  const fetch = globalThis.fetch; globalThis.fetch = async () => new Response("secret-access-token", { status: 429, headers: { "Retry-After": "120" } });
  try { await assert.rejects(mailboxJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", "test"), error => error instanceof MailboxHttpError && error.delay === 120000 && !error.message.includes("secret")); } finally { globalThis.fetch = fetch; }
  await assert.rejects(mailboxBytes(new Response(new Uint8Array(100)), 10));
});
test("body receipts become deterministic PDFs while ordinary messages are ignored", async () => {
  const mail = new TextEncoder().encode("From: billing@example.com\r\nSubject: Your receipt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nReceipt 123\r\nTotal EUR 19.50");
  const a = await mailboxContent(mail), b = await mailboxContent(mail);
  assert.equal(a.files.length, 1); assert.equal(a.files[0].hash, b.files[0].hash);
  assert.equal((await PDFDocument.load(a.files[0].bytes)).getPageCount(), 1);
  assert.equal((await mailboxContent(new TextEncoder().encode("Subject: Lunch plans\r\n\r\nSee you tomorrow"))).files.length, 0);
});
test("attachments import original PDFs and flag unsupported body text without executing HTML", async () => {
  const doc = await PDFDocument.create(); doc.addPage(); const pdf = await doc.save();
  const mail = `From: billing@example.com\r\nSubject: Document attached\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: text/plain\r\n\r\nAttached.\r\n--test\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="invoice.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(pdf).toString("base64")}\r\n--test--`;
  const result = await mailboxContent(new TextEncoder().encode(mail)); assert.equal(result.files.length, 1); assert.deepEqual(result.files[0].bytes, new Uint8Array(pdf));
  const unsupported = await mailboxContent(new TextEncoder().encode("Subject: Receipt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nInvoice 中文 EUR 10"));
  assert.equal(unsupported.files.length, 0); assert.match(unsupported.issue!, /manual import/);
});
test("Gmail quota errors using HTTP 403 are retried as rate limits", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ error: { errors: [{ reason: "userRateLimitExceeded", message: "private provider detail" }] } }, { status: 403, headers: { "Retry-After": "180" } });
  try { await assert.rejects(mailboxJson("https://gmail.googleapis.com/gmail/v1/users/me/profile", "test"), error => error instanceof MailboxHttpError && error.status === 429 && error.delay === 180000 && !error.message.includes("private")); } finally { globalThis.fetch = original; }
});
