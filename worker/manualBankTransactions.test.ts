import assert from "node:assert/strict";
import test from "node:test";
import { handleManualBankApi } from "./manualBankTransactions";
import { financeOperatorCanAccess } from "../shared/dashboardAccess";

const env = { CONVEX_URL: "https://manual-ledger-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test" };
const session = { username: "Ali", role: "administrator" as const };
const origin = "https://finance.example";
test("manual ledger API scopes access and protects edits against cross-site requests", async () => {
  for (const role of ["transaction-reviewer", "media-spend-reviewer"] as const) {
    const result = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions?source=kraken`), env, { username: "Reader", role });
    assert.equal(result?.status, 403);
  }
  const foreign = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions/abc`, { method: "PATCH", headers: { Origin: "https://other.example" }, body: "{}" }), env, session);
  assert.equal(foreign?.status, 403);
  assert.equal(financeOperatorCanAccess(new Request(`${origin}/api/manual-bank-transactions?source=kraken`)), true);
  assert.equal(financeOperatorCanAccess(new Request(`${origin}/api/manual-bank-transactions/abc`, { method: "PATCH" })), true);
  assert.equal(financeOperatorCanAccess(new Request(`${origin}/api/manual-bank-transactions`, { method: "POST" })), false);
});
test("manual ledger API passes global sorts and validated edits with the authenticated editor", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; args: Array<Record<string, unknown>> }> = [];
  globalThis.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)); calls.push(body); return Response.json({ status: "success", value: body.path.endsWith(":list") ? { page: [], isDone: true, continueCursor: "" } : null }); };
  try {
    const result = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions?source=trust&sort=amount&order=asc`), env, session);
    assert.equal(result?.status, 200);
    assert.equal(calls[0].args[0].source, "trust");
    assert.equal(calls[0].args[0].sortKey, "amount");
    const payload = { companyName: "Updated company", amount: 45, date: "2026-10-01", currency: "eur", direction: "in", expectedRevision: 2, updatedBy: "spoofed" };
    const edited = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions/abc`, { method: "PATCH", headers: { Origin: origin }, body: JSON.stringify(payload) }), env, session);
    assert.equal(edited?.status, 200);
    assert.equal(calls[1].args[0].updatedBy, "Ali");
    assert.equal(calls[1].args[0].currency, "EUR");
    assert.equal(calls[1].args[0].expectedRevision, 2);
    const invalid = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions/abc`, { method: "PATCH", headers: { Origin: origin }, body: JSON.stringify({ ...payload, date: "2026-02-30" }) }), env, session);
    assert.equal(invalid?.status, 400);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});
