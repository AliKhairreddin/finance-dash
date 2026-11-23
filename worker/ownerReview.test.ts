import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import type { DashboardSession } from "../shared/types";
import { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../convex/_generated/api";
import { internalAction } from "../convex/_generated/server";
import schema from "../convex/schema";
import { buildManagementReport } from "../shared/managementReport";
import { syntheticManagementReportSheets } from "../shared/testFixtures/managementReport";
import { canPublishPeriod, owners, ownerForLogin, reviewStatus } from "../shared/ownerReview";
import { dashboardHomePage, dashboardPageAllowed, ownerReviewAccess } from "../shared/dashboardAccess";
import { handleOwnerReview, sendOwnerReviewEmail } from "./ownerReview";

const auth = { serviceToken: "owner-review-test-token" };
process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken;
const period = "2026-05-31";
const ownerValue = v.union(v.literal("Amin"), v.literal("Sanjin"), v.literal("Ben"));
const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/ownerReviews.ts": () => import("../convex/ownerReviews"),
  "../convex/ownerReviewMail.ts": async () => ({ deliver: internalAction({
    args: { id: v.id("ownerReviews"), owner: ownerValue, attempt: v.number() }, returns: v.null(), handler: async () => null
  }) })
};

test("publication pins the import, redacts unrelated data, requires three distinct approvals, and preserves revision history", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const t = convexTest(schema, modules);
  const { dashboard, bankEntries } = buildManagementReport(syntheticManagementReportSheets(), { asOf: period, importedAt: "2026-06-01" });
  assert.equal(canPublishPeriod(dashboard, period), true);
  async function addImport(importId: string, importedAt: string) {
    await t.run(async ctx => {
      await ctx.db.insert("managementReportImports", { importId, importedAt, contentHash: importId, parserVersion: "4", attemptId: importId, leaseExpiresAt: "", sourceName: "test", reportingThrough: period, status: "complete", sheetSummaries: [], sourceRowCount: 0, bankEntryCount: bankEntries.length, factCount: 0, dashboard: JSON.parse(JSON.stringify(dashboard)) });
      for (const b of bankEntries) await ctx.db.insert("managementReportBankEntries", { importId, entryId: b.entryId, date: b.date, bankName: b.bankName, segment: b.segment, amountUsd: b.amountUsd, sourceRow: b.sourceRow, payload: JSON.parse(JSON.stringify(b)) });
    });
  }
  await addImport("first", "2026-06-01");
  const publish = { ...auth, importId: "first", period, actor: "Finance", expectedRevision: 0 };
  await assert.rejects(t.mutation(api.ownerReviews.publish, publish), /email/);
  const addresses = { Amin: "amin@example.com", Sanjin: "sanjin@example.com", Ben: "ben@example.com" };
  await t.mutation(api.ownerReviews.saveContacts, { ...auth, addresses });
  await assert.rejects(t.mutation(api.ownerReviews.publish, { ...publish, period: "2026-10-31" }));
  const id = await t.mutation(api.ownerReviews.publish, publish);
  assert.equal(await t.mutation(api.ownerReviews.publish, publish), id);
  const first = await t.query(api.ownerReviews.report, { ...auth, id, owner: "Amin" });
  assert.equal(first.report.balance, 200);
  assert.equal(first.report.units.find((u: { id: string }) => u.id === "acp")?.metrics[0].value, 30);
  assert.equal(first.review.mail, undefined);
  assert.doesNotMatch(JSON.stringify(first), /Ishan|@example|SECRET_REFERENCE/);
  const ledger = await t.query(api.ownerReviews.transactions, { ...auth, id, cursor: null });
  assert.equal(ledger.rows.length, 2);
  assert.doesNotMatch(JSON.stringify(ledger), /POST_CLOSE|SECRET_|reference|userName/);
  for (const owner of owners) {
    await t.mutation(api.ownerReviews.decide, { ...auth, id, owner, state: "approved", comment: "" });
    const { review } = await t.query(api.ownerReviews.report, { ...auth, id, owner });
    assert.equal(reviewStatus(review.decisions), owner === "Ben" ? "Signed off" : "Awaiting approval");
  }
  await t.mutation(api.ownerReviews.decide, { ...auth, id, owner: "Ben", state: "approved", comment: "" });
  await assert.rejects(t.mutation(api.ownerReviews.decide, { ...auth, id, owner: "Ben", state: "changes", comment: "Edit" }));
  await addImport("revised", "2026-06-02");
  const revised = await t.mutation(api.ownerReviews.publish, { ...publish, importId: "revised", expectedRevision: 1 });
  await assert.rejects(t.mutation(api.ownerReviews.decide, { ...auth, id, owner: "Amin", state: "approved", comment: "" }), /newer/);
  await assert.rejects(t.mutation(api.ownerReviews.decide, { ...auth, id: revised, owner: "Ben", state: "changes", comment: " " }));
  await t.mutation(api.ownerReviews.decide, { ...auth, id: revised, owner: "Sanjin", state: "changes", comment: "Please reconcile subscriptions." });
  const finance = await t.query(api.ownerReviews.list, { ...auth, finance: true, cursor: null });
  assert.equal(finance.rows[0].decisions.length, 1);
  assert.equal(reviewStatus(finance.rows[0].decisions), "Changes requested");
  assert.equal(finance.rows[1].decisions.length, 3);
  const mail = { id: revised, owner: "Amin" as const, attempt: 1 };
  assert.equal((await t.mutation(internal.ownerReviews.claimMail, mail))?.email, addresses.Amin);
  assert.equal(await t.mutation(internal.ownerReviews.claimMail, mail), null);
  await t.mutation(internal.ownerReviews.finishMail, { ...mail, state: "failed", error: "Unavailable" });
  await t.mutation(api.ownerReviews.retryEmail, { ...auth, id: revised, owner: "Amin" });
  assert.equal(await t.mutation(internal.ownerReviews.claimMail, mail), null);
  assert.equal((await t.mutation(internal.ownerReviews.claimMail, { ...mail, attempt: 2 }))?.email, addresses.Amin);
});

test("owner access and decisions use the authenticated login across configured aliases", async t => {
  assert.equal(dashboardHomePage("owner"), "owner");
  assert.equal(dashboardPageAllowed("owner", "banks"), false);
  assert.equal(dashboardPageAllowed("finance-operator", "management"), true);
  assert.equal(ownerReviewAccess(new Request("https://finance.example/api/dashboard")), false);
  const env = { CONVEX_URL: "https://fixture.convex.cloud", CONVEX_SERVICE_TOKEN: auth.serviceToken };
  const route = (name: string, data: unknown) => new Request("https://finance.example/api/monthly-review/" + name, { method: "POST", body: JSON.stringify(data) });
  const calls: { owner: string }[] = [];
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (_fn: unknown, input: { owner: string }) => { calls.push(input); return null; });
  for (const username of ["Amin", "Sani", "Sanjin", "Beno", "Ben"]) {
    const session = { role: "owner" as const, username };
    assert.equal((await handleOwnerReview(route("decision", { id: "test", owner: "Ishan", state: "approved" }), env, session)).status, 200);
    assert.equal(calls.at(-1)?.owner, ownerForLogin(username));
    assert.equal((await handleOwnerReview(route("publish", {}), env, session)).status, 403);
  }
  assert.equal((await handleOwnerReview(route("decision", {}), env, { role: "administrator", username: "Ali" })).status, 403);
});

test("only Ali and Ali M can preview Amin’s published data, with owner-level reads and no review writes", async t => {
  const env = { CONVEX_URL: "https://fixture.convex.cloud", CONVEX_SERVICE_TOKEN: auth.serviceToken };
  const request = (action: string, preview = "Amin", method = "GET") =>
    new Request("https://finance.example/api/monthly-review/" + action + "?id=version&preview=" + preview, { method });
  const reads = t.mock.method(ConvexHttpClient.prototype, "query", async (_fn: unknown, args: Record<string, unknown>) => args);
  const writes = t.mock.method(ConvexHttpClient.prototype, "mutation", async () => null);
  for (const username of ["Ali", " Ali  M "]) {
    const session = { role: "administrator" as const, username };
    assert.equal(dashboardPageAllowed(session.role, "amin-preview", username), true);
    assert.equal((await (await handleOwnerReview(request("list"), env, session)).json()).finance, false);
    assert.equal((await (await handleOwnerReview(request("report"), env, session)).json()).owner, "Amin");
    assert.equal((await handleOwnerReview(request("transactions"), env, session)).status, 200);
    for (const action of ["decision", "publish", "contacts", "retry-email"]) {
      assert.equal((await handleOwnerReview(request(action, "Amin", "POST"), env, session)).status, 403);
    }
    assert.equal((await handleOwnerReview(request("contacts"), env, session)).status, 403);
    assert.equal((await handleOwnerReview(request("report", "Ben"), env, session)).status, 403);
  }
  for (const session of [
    { role: "administrator", username: "Alaa" }, { role: "administrator", username: "Ali M2" },
    { role: "finance-operator", username: "Ali" }, { role: "owner", username: "Ben" }
  ] satisfies DashboardSession[]) {
    assert.equal(dashboardPageAllowed(session.role, "amin-preview", session.username), false);
    assert.equal((await handleOwnerReview(request("report"), env, session)).status, 403);
  }
  assert.equal(reads.mock.callCount(), 6);
  assert.equal(writes.mock.callCount(), 0);
});

test("review emails link to the precise signed-in version and require the processor credential", async () => {
  let mail: { text: string; to: string } | null = null;
  const env = { CONVEX_URL: "", CONVEX_SERVICE_TOKEN: auth.serviceToken, OWNER_REVIEW_EMAIL: { send: async (input: { text: string; to: string }) => { mail = input; return { messageId: "accepted" }; } } };
  const request = (token: string) => new Request("https://finance.example/api/internal/owner-review/email", { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify({ owner: "Ben", id: "review01", email: "ben@example.com", period, revision: 2 }) });
  assert.equal((await sendOwnerReviewEmail(request("wrong"), env)).status, 401);
  assert.equal(mail, null);
  assert.equal((await sendOwnerReviewEmail(request(auth.serviceToken), env)).status, 200);
  assert.match(JSON.stringify(mail), /page=owner&review=review01/);
  assert.match(JSON.stringify(mail), /May 2026 \(version 2\)/);
});
