import assert from "node:assert/strict";
import test from "node:test";
import { exactCleanRow, exactCursor, exactInitialUrl, exactRows, exactSafeUrl, exactWritePayload } from "./exact";
import { exactDecrypt, exactEncrypt, exactHttp, exactRateDelay, ExactHttpError } from "./exactHttp";

test("Exact follows only same-resource, same-host pagination", () => {
  const initial = exactInitialUrl(3503006, "accounts", "9007199254740993");
  assert.equal(new URL(initial).searchParams.get("$filter"), "Timestamp gt 9007199254740993L");
  assert.equal(exactSafeUrl("/api/v1/3503006/sync/CRM/Accounts?$skiptoken=next", "/api/v1/3503006/sync/CRM/Accounts"), "https://start.exactonline.nl/api/v1/3503006/sync/CRM/Accounts?$skiptoken=next");
  for (const url of ["https://evil.example/api/v1/3503006/sync/CRM/Accounts", "https://start.exactonline.nl/api/v1/999/sync/CRM/Accounts", "https://user@start.exactonline.nl/api/v1/3503006/sync/CRM/Accounts"]) assert.throws(() => exactSafeUrl(url, "/api/v1/3503006/sync/CRM/Accounts"));
});
test("Exact incomplete responses are never interpreted as zero records", () => {
  for (const value of [{}, { error: "Denied" }, { d: null }, { d: {} }, { d: { results: [null] } }, { d: { results: [], __next: 123 } }]) assert.throws(() => exactRows(value));
  assert.deepEqual(exactRows({ d: { results: [], __next: "next" } }), { rows: [], next: "next" });
  assert.throws(() => exactCursor(9007199254740992));
  assert.equal(exactCursor("9007199254740993"), "9007199254740993");
});
test("Exact record storage excludes unrequested private fields and requires stable identifiers", () => {
  assert.deepEqual(exactCleanRow("accounts", { ID: "abc", Timestamp: "20", Name: "Company", BSN: "private", Logo: "large" }), { ID: "abc", Timestamp: "20", Name: "Company" });
  assert.throws(() => exactCleanRow("accounts", { Timestamp: "20", Name: "Company" }));
  assert.throws(() => exactCleanRow("payables", { HID: 9007199254740992, Amount: 1 }));
});
test("Exact edits cannot smuggle financial, status, company or account changes", () => {
  assert.deepEqual(exactWritePayload("invoices", { Description: "Reviewed", YourRef: "REF", AmountFC: 999, Status: 50, Division: 999, InvoiceTo: "other" }, true), { Description: "Reviewed", YourRef: "REF" });
  assert.deepEqual(exactWritePayload("accounts", { Name: "Acme", CreditLineSales: 1000000, IsSupplier: true }, true), { Name: "Acme" });
});
test("Exact invoice validation requires explicit company reference data, dates and amounts", () => {
  const guid = "11111111-1111-1111-1111-111111111111";
  const input = { Description: "Services", YourRef: "R", Journal: "70", Currency: "EUR", Account: guid, Date: "2026-10-26", lines: [{ description: "Services", amount: "123.45", glAccount: guid, vatCode: "0", item: guid }] };
  const payload = exactWritePayload("invoices", input, false);
  assert.equal(payload.OrderedBy, guid); assert.equal(payload.Journal, "70");
  assert.deepEqual(payload.SalesInvoiceLines, [{ Description: "Services", GLAccount: guid, VATCode: "0", Item: guid, Quantity: 1, UnitPrice: 123.45 }]);
  for (const bad of [{ ...input, Date: "2026-02-30" }, { ...input, Account: "wrong" }, { ...input, lines: [] }, { ...input, lines: [{ ...input.lines[0], amount: "123.456" }] }]) assert.throws(() => exactWritePayload("invoices", bad, false));
  assert.throws(() => exactWritePayload("documents", { Subject: "Test", DocumentDate: "2026-10-26" }, false));
});
test("Exact credential ciphertext authenticates both content and key", async () => {
  const key = "11".repeat(32), secret = '{"refresh_token":"test"}';
  const a = await exactEncrypt(secret, key), b = await exactEncrypt(secret, key);
  assert.notEqual(a, b); assert.equal(a.includes("refresh_token"), false);
  assert.equal(await exactDecrypt(a, key), secret);
  await assert.rejects(exactDecrypt(a, "22".repeat(32)));
  await assert.rejects(exactDecrypt(a.slice(0, -4), key));
});
test("Exact honors provider quota resets and never retries writes automatically", async () => {
  assert.equal(exactRateDelay(new Headers({ "Retry-After": "3600" })), 3600000);
  assert.equal(exactRateDelay(new Headers({ "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "2000" }), 1000000), 1001000);
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("private upstream body", { status: 503 }); };
  try { await assert.rejects(exactHttp("https://start.exactonline.nl/api/v1/1/crm/Accounts", "test-token", { method: "POST", body: "{}" }), (e: unknown) => e instanceof ExactHttpError && e.status === 503 && !e.message.includes("private")); assert.equal(calls, 1); } finally { globalThis.fetch = original; }
});
