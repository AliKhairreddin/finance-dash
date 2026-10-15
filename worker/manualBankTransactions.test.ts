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
  assert.equal(financeOperatorCanAccess(new Request(`${origin}/api/manual-bank-transactions`, { method: "POST" })), true);
  assert.equal(financeOperatorCanAccess(new Request(`${origin}/api/manual-bank-transactions/abc`, { method: "DELETE" })), true);
});

test("dashboard adds and deletes use authenticated actors, validated fields, and same-origin protection", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; args: Array<Record<string, unknown>> }> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    return Response.json({ status: "success", value: body.path.endsWith(":createFromDashboard") ? { id: "abc", duplicate: false } : null });
  };
  const create = { source: "kraken", companyName: "Example company", amount: 1250, currency: "usdc", direction: "out", date: "2026-10-15", requestId: "97b12036-41f5-4bf5-a2d8-8c19178843d0", createdBy: "spoofed" };
  const request = (method: string, body: unknown, requestOrigin = origin) => new Request(`${origin}/api/manual-bank-transactions${method === "DELETE" ? "/abc" : ""}`, { method, headers: { Origin: requestOrigin }, body: JSON.stringify(body) });
  try {
    for (const method of ["POST", "DELETE"]) {
      assert.equal((await handleManualBankApi(request(method, {}), env, null))?.status, 403);
      assert.equal((await handleManualBankApi(request(method, {}), env, { username: "Reader", role: "transaction-reviewer" }))?.status, 403);
      assert.equal((await handleManualBankApi(request(method, {}, "https://other.example"), env, session))?.status, 403);
      assert.equal((await handleManualBankApi(request(method, {}, ""), env, session))?.status, 403);
    }
    for (const invalid of [{ ...create, source: "wise" }, { ...create, amount: -1 }, { ...create, requestId: "" }, { ...create, date: "2026-02-30" }, null]) {
      assert.equal((await handleManualBankApi(request("POST", invalid), env, session))?.status, 400);
    }
    assert.equal((await handleManualBankApi(request("DELETE", { expectedRevision: 0 }), env, session))?.status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await handleManualBankApi(request("POST", create), env, { username: "Meet", role: "finance-operator" }))?.status, 201);
    assert.equal(calls[0].path, "manualBankTransactions:createFromDashboard");
    assert.equal(calls[0].args[0].createdBy, "Meet");
    assert.equal(calls[0].args[0].currency, "USDC");
    assert.equal(calls[0].args[0].requestId, create.requestId);
    assert.equal((await handleManualBankApi(request("DELETE", { expectedRevision: 2, deletedBy: "spoofed" }), env, session))?.status, 200);
    assert.equal(calls[1].path, "manualBankTransactions:remove");
    assert.equal(calls[1].args[0].deletedBy, "Ali");
    assert.equal(calls[1].args[0].expectedRevision, 2);
    assert.equal(calls[1].args[0].id, "abc");
  } finally { globalThis.fetch = originalFetch; }
});

test("stale deletion returns a conflict, while retried dashboard creation returns the existing entry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json(body.path.endsWith(":remove")
      ? { status: "error", errorMessage: "This transaction was edited by someone else. Refresh and reopen it before deleting." }
      : { status: "success", value: { id: "abc", duplicate: true } });
  };
  try {
    const removed = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions/abc`, { method: "DELETE", headers: { Origin: origin }, body: JSON.stringify({ expectedRevision: 1 }) }), env, session);
    assert.equal(removed?.status, 409);
    const retried = await handleManualBankApi(new Request(`${origin}/api/manual-bank-transactions`, { method: "POST", headers: { Origin: origin }, body: JSON.stringify({ source: "trust", companyName: "Example", amount: 50, currency: "USDC", direction: "out", date: "2026-10-15", requestId: "97b12036-41f5-4bf5-a2d8-8c19178843d0" }) }), env, session);
    assert.equal(retried?.status, 200);
    assert.deepEqual(await retried?.json(), { id: "abc", duplicate: true });
  } finally { globalThis.fetch = originalFetch; }
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
