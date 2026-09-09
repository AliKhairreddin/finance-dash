import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { createBankAnalyticsAccumulator } from "../shared/analytics";
import { createBankAnalyticsJobIdentity } from "../shared/analyticsJob";
import { createAuthSessionToken } from "./auth";
import worker from "./handler";

test("missing Wise history does not enqueue backfills or hide a completed stored-period calculation", async (t) => {
  const range = { fromDate: "2026-09-08", toDate: "2026-09-08" };
  const directory = { providers: [], teams: [] };
  const revisions = [{ month: "2026-09", revision: 1 }];
  const identity = createBankAnalyticsJobIdentity(revisions, { ...range, ...directory });
  const coverage = [{ source: "wise", missingRanges: [range] }, { source: "revolut", missingRanges: [] }];
  const accumulator = createBankAnalyticsAccumulator({ ...range, ...directory });
  accumulator.addPage([{ id: "receipt", source: "revolut", amount: 123, currency: "USD", direction: "in", status: "posted", date: range.fromDate, accountName: "Operating", counterparty: "Client", rawName: "Client", description: "Receipt", category: "Revenue" }]);
  const snapshot = accumulator.finish();
  t.mock.method(ConvexHttpClient.prototype, "query", async (fn: Parameters<typeof getFunctionName>[0]) => {
    switch (getFunctionName(fn)) {
      case "banking:getActivityCoverage": return coverage;
      case "dashboard:getAnalyticsDirectory": return directory;
      case "banking:getAnalyticsPeriodRevision": return revisions;
      case "analytics:getJob": return { version: identity.version, status: "complete", snapshot };
      default: throw new Error(`Unexpected query ${getFunctionName(fn)}`);
    }
  });
  t.mock.method(ConvexHttpClient.prototype, "mutation", async () => { throw new Error("No mutation should be needed"); });
  const secret = "audit-test-session-secret";
  const token = await createAuthSessionToken(secret, "finance.example", "audit");
  const response = await worker.fetch(new Request(`https://finance.example/api/analytics?${new URLSearchParams(range)}`, { headers: { cookie: `__Host-finance_session=${token}` } }), {
    CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "test", WISE_CONNECTION_ID: "primary", REVOLUT_CONNECTION_ID: "primary",
    AUTH_SESSION_SECRET: secret, TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Audit: "12345" }), TELEGRAM_BOT_TOKEN: "test", TELEGRAM_OTP_STATE: { getByName: () => ({}) }
  } as never);
  assert.equal(response.status, 200);
  const result = await response.json() as typeof snapshot & { coverage: unknown };
  assert.equal(result.summary.moneyIn.USD, 123);
  assert.deepEqual(result.coverage, coverage);
});
