import assert from "node:assert/strict";
import test from "node:test";
import { deleteAssignment, listOverview, rebuildDate, setBankFundingPaused, setPaymentMethods } from "../convex/mediaFunding";

type RecordRow = Record<string, any>;
function database(seed: Record<string, RecordRow[]>) {
  const tables = structuredClone(seed);
  let serial = 0;
  const find = (id: string) => Object.values(tables).flat().find((row) => row._id === id);
  return { tables, db: {
    query(table: string) {
      let rows = tables[table] ?? [];
      const index = {
        eq(key: string, value: unknown) { rows = rows.filter((r) => r[key] === value); return index; },
        lte(key: string, value: any) { rows = rows.filter((r) => r[key] <= value); return index; }
      };
      const query = {
        withIndex(_name: string, filter?: (i: typeof index) => unknown) { filter?.(index); return query; },
        order(_direction: string) { return query; },
        async take(count: number) { return structuredClone(rows.slice(0, count)); },
        async unique() { assert(rows.length <= 1); return structuredClone(rows[0] ?? null); },
        async first() { return structuredClone(rows[0] ?? null); }
      };
      return query;
    },
    async get(id: string) { return structuredClone(find(id) ?? null); },
    async insert(table: string, row: RecordRow) { const _id = `insert-${++serial}`; (tables[table] ??= []).push({ ...row, _id, _creationTime: 0 }); return _id; },
    async patch(id: string, row: RecordRow) { Object.assign(find(id)!, row); },
    async replace(id: string, row: RecordRow) { const current = find(id)!; for (const key of Object.keys(current)) if (!key.startsWith("_")) delete current[key]; Object.assign(current, row); },
    async delete(id: string) { for (const table of Object.keys(tables)) tables[table] = tables[table].filter((row) => row._id !== id); }
  } };
}
function call(fn: object, ctx: unknown, args: unknown): Promise<any> {
  return Reflect.get(fn, "_handler")(ctx, args);
}
const date = "2026-09-14", serviceToken = "funding-test", updatedAt = "2026-09-24T00:00:00Z";
function seed() {
  return {
    mediaFundingProviders: [{ _id: "meta", companyProviderId: "company", currency: "USD", openingBalance: 0, openingBalanceDate: "2026-01-01", defaultFeePercent: 0, createdAt: updatedAt, updatedAt }],
    dashboardState: [{ _id: "dashboard", key: "default", providers: [{ id: "company", type: "supplier", name: "Meta" }] }],
    mediaFundingProviderTotals: [{ _id: "totals", providerId: "meta", spend: 0, adjustments: 0, updatedAt }],
    mediaSpendSyncState: [{ _id: "sync", key: "lemonmax", coveredThrough: date }],
    mediaFundingAssignments: ["1", "2"].map((accountId) => ({ _id: `assignment-${accountId}`, scope: "ad_account", providerId: "meta", platform: "Facebook", targetKey: `ad_account:Facebook:${accountId}`, businessManagerKey: "Facebook:bm", businessManagerId: "bm", accountId, accountName: `LMD02_${accountId}`, effectiveFrom: date, createdAt: updatedAt, updatedAt })),
    mediaSpendDaily: [{ _id: "spend", key: "row3", platform: "Facebook", accountId: "3", accountName: "LMD02_3", businessManagerId: "bm", date, spend: 25, currency: "USD" }],
    bankTransactions: [{ _id: "bank", id: "payment", matchedProviderId: "company", category: "Ad account funding", amount: 100, currency: "USD", date, direction: "out", status: "posted", source: "slash", accountName: "Card", counterparty: "Facebook", description: "FACEBK other ad account" }]
  };
}
test("automatic assignment is stored with its pattern, allocates spend once and respects removal", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    const first = await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
    assert.equal(first.automaticallyAssigned, 1);
    assert.equal(first.spend, 25);
    assert.equal(ctx.tables.mediaFundingProviderTotals[0].spend, 25);
    const auto = ctx.tables.mediaFundingAssignments.find((a) => a.autoPattern)!;
    assert.equal(auto.accountId, "3");
    assert.equal((await call(rebuildDate, ctx, { serviceToken, date, updatedAt })).automaticallyAssigned, 0);
    assert.equal(ctx.tables.mediaFundingProviderTotals[0].spend, 25);
    await call(deleteAssignment, ctx, { serviceToken, assignmentId: auto._id });
    assert.equal((await call(rebuildDate, ctx, { serviceToken, date, updatedAt })).automaticallyAssigned, 0);
    assert.equal(ctx.tables.mediaFundingProviderTotals[0].spend, 0);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
test("pausing bank association excludes unrelated payments without altering spend, assignments or bank records", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    const before = await call(listOverview, ctx, { serviceToken });
    assert.equal(before.bankFunding.length, 1);
    const banks = structuredClone(ctx.tables.bankTransactions), assignments = structuredClone(ctx.tables.mediaFundingAssignments);
    await call(setBankFundingPaused, ctx, { serviceToken, providerId: "meta", paused: true });
    const after = await call(listOverview, ctx, { serviceToken });
    assert.equal(after.bankFunding.length, 0);
    assert.equal(after.providers[0].netFunding, 0);
    assert.equal(after.providers[0].estimatedBalance, null);
    assert.equal(after.summary.estimatedBalance, null);
    assert.deepEqual(ctx.tables.bankTransactions, banks);
    assert.deepEqual(ctx.tables.mediaFundingAssignments, assignments);
    await call(setBankFundingPaused, ctx, { serviceToken, providerId: "meta", paused: false });
    assert.equal((await call(listOverview, ctx, { serviceToken })).bankFunding.length, 1);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("payment method is independent of account provider and only provider-funded spend reduces balances", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
    let overview = await call(listOverview, ctx, { serviceToken });
    assert.equal(overview.providers[0].needsReviewSpend, 25);
    assert.equal(overview.providers[0].estimatedBalance, null);
    const assignments = structuredClone(ctx.tables.mediaFundingAssignments);
    const targets = [{ platform: "Facebook", accountId: "3" }];
    for (const method of ["own_card", "meta_credit_line", "provider_funded", "needs_review"]) {
      await call(setPaymentMethods, ctx, { serviceToken, targets, method, effectiveFrom: date, updatedAt });
      await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
      overview = await call(listOverview, ctx, { serviceToken });
      const provider = overview.providers[0];
      assert.equal(provider.spend, 25);
      assert.equal(provider.estimatedBalance, method === "needs_review" ? null : method === "provider_funded" ? 75 : 100);
      assert.equal(provider.needsReviewSpend, method === "needs_review" ? 25 : 0);
      assert.deepEqual(provider.classifiedSpend, { provider_funded: method === "provider_funded" ? 25 : 0, own_card: method === "own_card" ? 25 : 0, meta_credit_line: method === "meta_credit_line" ? 25 : 0 });
      await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
      assert.deepEqual((await call(listOverview, ctx, { serviceToken })).providers[0], provider);
    }
    assert.deepEqual(ctx.tables.mediaFundingAssignments, assignments);
    await call(setPaymentMethods, ctx, { serviceToken, targets, method: "own_card", effectiveFrom: date, updatedAt });
    await call(setPaymentMethods, ctx, { serviceToken, targets, method: "meta_credit_line", effectiveFrom: "2026-09-15", updatedAt });
    assert.equal(ctx.tables.mediaAccountPaymentMethods.find((m) => m.method === "own_card")?.effectiveTo, date);
    await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].classifiedSpend.own_card, 25);
    await assert.rejects(call(setPaymentMethods, ctx, { serviceToken: "wrong", targets, method: "own_card", effectiveFrom: date, updatedAt }));
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
