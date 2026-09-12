import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchZohoWiseActivity, rejectZohoWiseCsvOverlap, zohoWiseAccounts, zohoWiseTransaction } from "./zohoWise";
import type { ImportWiseStatementPayload } from "./types";

const account = zohoWiseAccounts[0];
const credentials = { ZOHO_CLIENT_ID: "client", ZOHO_CLIENT_SECRET: "private-secret", ZOHO_REFRESH_TOKEN: "private-refresh" };
const now = Date.parse("2026-09-12T12:00:00Z");
const row = (overrides = {}) => ({ statement_id: "101", account_id: account.zohoAccountId, date: "2026-09-04",
  amount: 100, debit_or_credit: "credit", description: "Sent money to Acme (fee: 1.13 USD)",
  reference_number: "", payee: "Acme", status: "uncategorized", is_feed: true, is_excluded_by_system: false, ...overrides });
const bank = (overrides = {}) => ({ account_id: account.zohoAccountId, account_type: "bank", is_active: true,
  currency_code: "USD", feeds_last_refresh_date: "2026-09-12", refresh_status: "completed", consent_info: { is_consent_expired: false }, ...overrides });
const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
function mock(pages: unknown[], banks = [bank()]): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token")) return reply({ access_token: "access", api_domain: "https://www.zohoapis.eu" });
    if (url.pathname.endsWith("/bankaccounts")) return reply({ code: 0, bankaccounts: banks, page_context: { has_more_page: false } });
    const page = Number(url.searchParams.get("page"));
    return reply(pages[page - 1]);
  };
}
function page(rows: unknown[], page = 1, more = false) {
  return { code: 0, bankstatements: rows, page_context: { page, has_more_page: more } };
}

test("Zoho deposits/withdrawals preserve separate fees without adding described fees again", () => {
  const payment = zohoWiseTransaction(row(), account);
  const fee = zohoWiseTransaction(row({ statement_id: "102", amount: 1.13, description: "Wise Charges for: TRANSFER-123", payee: "" }), account);
  const receipt = zohoWiseTransaction(row({ statement_id: "103", amount: 200, debit_or_credit: "debit", payee: "", description: "Received money from Customer with reference xxxxx123" }), account);
  assert.equal(payment.amount, 100); assert.equal(payment.direction, "out");
  assert.equal(fee.category, "Bank fees"); assert.equal(fee.counterparty, "Wise");
  assert.equal(receipt.direction, "in"); assert.equal(receipt.counterparty, "Customer");
  assert.equal(Math.round((receipt.amount - payment.amount - fee.amount) * 100), 9887);
  assert.equal(payment.cardLastFour, undefined); assert.equal(payment.cardHolderName, undefined);
});

test("stable IDs survive corrections and distinguish two real identical payments and accounts", () => {
  const original = zohoWiseTransaction(row(), account);
  assert.equal(original.id, zohoWiseTransaction(row({ description: "Corrected payee", amount: 110 }), account).id);
  assert.notEqual(original.id, zohoWiseTransaction(row({ statement_id: "102" }), account).id);
  assert.notEqual(original.id, zohoWiseTransaction(row(), { ...account, balanceId: "999" }).id);
  assert.equal(zohoWiseTransaction(row({ status: "deleted", is_excluded_by_system: true }), account).status, "voided");
  assert.throws(() => zohoWiseTransaction(row({ account_id: "other" }), account), /another account/);
  assert.throws(() => zohoWiseTransaction(row({ debit_or_credit: "unexpected" }), account), /direction/);
});

test("all pages are read; pre-cutover rows are excluded and late arrivals are retained", async () => {
  const result = await fetchZohoWiseActivity(credentials, { now, accounts: [account], fetcher: mock([
    page([row({ statement_id: "1", date: "2026-09-11" })], 1, true),
    page([row({ statement_id: "2", date: "2026-09-04" }), row({ statement_id: "3", date: "2026-09-03" })], 2)
  ]) });
  assert.equal(result.transactions.length, 2); assert.equal(result.pagesFetched, 2);
  assert.equal(result.throughDate, "2026-09-11");
});

test("incomplete pagination, duplicate pages, stale feeds and wrong account mapping fail closed", async () => {
  for (const pages of [[page([row()], 1, true), page([row()], 2)], [page([row()], 1, true), page([], 2, true)]]) {
    await assert.rejects(fetchZohoWiseActivity(credentials, { now, accounts: [account], fetcher: mock(pages) }));
  }
  for (const banks of [[bank({ feeds_last_refresh_date: "2026-09-07" })], [bank({ currency_code: "EUR" })], [bank(), bank({ account_id: "other" })]]) {
    await assert.rejects(fetchZohoWiseActivity(credentials, { now, accounts: [account], fetcher: mock([page([row()])], banks) }));
  }
});

test("provider errors never expose OAuth secrets", async () => {
  await assert.rejects(fetchZohoWiseActivity(credentials, { now, accounts: [account], fetcher: async () => reply({ error: credentials.ZOHO_CLIENT_SECRET }) }),
    (error: Error) => !error.message.includes(credentials.ZOHO_CLIENT_SECRET) && /Zoho API rejected/.test(error.message));
});

test("verified historical gap is repaired while the CSV-covered cutover receipt and its fee are excluded", async () => {
  const repaired = await fetchZohoWiseActivity(credentials, { now, accounts: [account], fetcher: mock([page([
    row({ statement_id: "1364064000000064500", date: "2026-08-31" }),
    row({ statement_id: "999", date: "2026-08-31" })
  ])]) });
  assert.equal(repaired.transactions.length, 1);
  const lmd = zohoWiseAccounts.find((a) => a.entity === "lmd" && a.balanceId === "37067485")!;
  const result = await fetchZohoWiseActivity(credentials, { now, accounts: [lmd], fetcher: mock([page([
    row({ account_id: lmd.zohoAccountId, statement_id: "1365687000000063094", amount: 91300, debit_or_credit: "debit" }),
    row({ account_id: lmd.zohoAccountId, statement_id: "1365687000000063093", amount: 2.39 }),
    row({ account_id: lmd.zohoAccountId, statement_id: "999" })
  ])], [bank({ account_id: lmd.zohoAccountId, currency_code: "EUR" })]) });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].amount, 100);
});

test("CSV cutover prevents a second identity for the same post-cutover transactions", () => {
  for (const wiseEntity of ["dn", "lmd"] as const) {
    assert.throws(() => rejectZohoWiseCsvOverlap({ wiseEntity, periodEnd: "2026-09-04" } as ImportWiseStatementPayload), /cannot overlap/);
    assert.doesNotThrow(() => rejectZohoWiseCsvOverlap({ wiseEntity, periodEnd: "2026-09-03" } as ImportWiseStatementPayload));
  }
});
