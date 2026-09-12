import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { syncWiseActivity } from "./handler";
import { zohoWiseAccounts } from "../shared/zohoWise";

test("Wise live sync refreshes balances every run, feeds daily, and never commits partial feed coverage", async (t) => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  let lastSyncedAt: string | null = null;
  let oauthCalls = 0;
  let failSecondAccount = false;
  let balanceWrites = 0;
  let transactionWrites = 0;
  let completed = 0;
  const profileNames: Record<string, string> = { "65909506": "Digital Nudge OÜ", "31035977": "LOVEMEDO B.V." };
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v2/profiles") return Response.json(Object.entries(profileNames).map(([id, businessName]) => ({ id: Number(id), type: "BUSINESS", businessName })));
    if (url.pathname.endsWith("/balances")) {
      const profile = url.pathname.split("/")[3];
      return Response.json(zohoWiseAccounts.filter((a) => a.profileId === profile).map((a) => ({ id: Number(a.balanceId), currency: a.currency,
        amount: { value: 100, currency: a.currency }, modificationTime: "2026-09-12T12:00:00Z" })));
    }
    if (url.pathname.endsWith("/token")) { oauthCalls++; return Response.json({ access_token: "access", api_domain: "https://www.zohoapis.eu" }); }
    const org = url.searchParams.get("organization_id");
    if (url.pathname.endsWith("/bankaccounts")) return Response.json({ code: 0, page_context: { has_more_page: false },
      bankaccounts: zohoWiseAccounts.filter((a) => a.organizationId === org).map((a) => ({ account_id: a.zohoAccountId,
        account_type: "bank", is_active: true, currency_code: a.currency, feeds_last_refresh_date: "2026-09-12", refresh_status: "completed", consent_info: { is_consent_expired: false } })) });
    if (url.pathname.endsWith("/statements")) {
      const account = zohoWiseAccounts.find((a) => url.pathname.includes(a.zohoAccountId))!;
      if (failSecondAccount && account === zohoWiseAccounts[1]) return Response.json({ code: 14 });
      return Response.json({ code: 0, page_context: { page: 1, has_more_page: false }, bankstatements: [{
        statement_id: "100", account_id: account.zohoAccountId, date: "2026-09-04", amount: 10, debit_or_credit: "credit",
        description: "Purchase", payee: "Merchant", reference_number: "", status: "uncategorized", is_feed: true
      }] });
    }
    throw new Error(`Unexpected provider path ${url.pathname}`);
  });
  t.mock.method(ConvexHttpClient.prototype, "query", async (fn: Parameters<ConvexHttpClient["query"]>[0]) => {
    assert.equal(getFunctionName(fn), "banking:getSyncState");
    return lastSyncedAt ? { lastSyncedAt, coveredRanges: [] } : null;
  });
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (fn: Parameters<ConvexHttpClient["mutation"]>[0], args: Record<string, unknown>) => {
    const name = getFunctionName(fn);
    if (name === "bankSync:claimLease") return { claimed: true, fence: 1 };
    if (name === "banking:upsertSyncedActivityBatch") {
      if ((args.transactions as unknown[]).length) transactionWrites++;
      else balanceWrites++;
      return { insertedTransactions: (args.transactions as unknown[]).length, updatedTransactions: 0 };
    }
    if (name === "banking:completeSync") { completed++; lastSyncedAt = new Date(now).toISOString(); }
    return null;
  });
  const env = { CONVEX_URL: "https://example.convex.cloud", CONVEX_SERVICE_TOKEN: "test", WISE_API_TOKEN: "test",
    WISE_PROFILE_IDS: "65909506,31035977", WISE_CONNECTION_ID: "primary", WISE_ENVIRONMENT: "production",
    ZOHO_CLIENT_ID: "client", ZOHO_CLIENT_SECRET: "secret", ZOHO_REFRESH_TOKEN: "refresh" } as WorkerEnv;
  assert.equal(await syncWiseActivity(env), true);
  assert.equal(await syncWiseActivity(env), true);
  assert.equal(oauthCalls, 1); assert.equal(balanceWrites, 2); assert.equal(completed, 1);
  const savedWrites = transactionWrites;
  failSecondAccount = true;
  await assert.rejects(syncWiseActivity(env, { fromDate: "2026-09-04", toDate: "2026-09-11" }), /Zoho API rejected/);
  assert.equal(transactionWrites, savedWrites); assert.equal(completed, 1);
});
