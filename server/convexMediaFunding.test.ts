import assert from "node:assert/strict";
import test from "node:test";
import { backdateAssignmentHistory, billingRebuildStatus, prepareBillingRebuild, completeBillingRebuild, assignTargets, createProvider, updateProvider, listSupplierCompanies, deleteAssignment, listOverview, listSpendAssignments, rebuildDate, setBankFundingPaused, setPaymentMethods } from "../convex/mediaFunding";
import { emptyMediaFundingBillingSpend, resolveMediaFundingAssignment } from "../shared/mediaFunding";

import { mediaSpendDates } from "../shared/mediaSpend";
import { database, call } from "./convexTestDb";
const date = "2026-09-14", serviceToken = "funding-test", updatedAt = "2026-09-24T00:00:00Z";
function seed() {
  return {
    mediaFundingProviders: [{ _id: "meta", companyProviderId: "company", currency: "USD", openingBalance: 0, openingBalanceDate: "2026-01-01", defaultFeePercent: 0, createdAt: updatedAt, updatedAt }],
    dashboardState: [{ _id: "dashboard", key: "default", providers: [{ id: "company", type: "supplier", name: "Meta" }] }],
    mediaFundingProviderTotals: [{ _id: "totals", providerId: "meta", spend: 0, adjustments: 0, billingSpend: emptyMediaFundingBillingSpend(), billingRevision: 0, updatedAt }],
    mediaSpendSyncState: [{ _id: "sync", key: "lemonmax", coveredThrough: date }],
    mediaFundingAssignments: ["1", "2"].map((accountId) => ({ _id: `assignment-${accountId}`, scope: "ad_account", providerId: "meta", platform: "Facebook", targetKey: `ad_account:Facebook:${accountId}`, businessManagerKey: "Facebook:bm", businessManagerId: "bm", accountId, accountName: `LMD02_${accountId}`, effectiveFrom: date, createdAt: updatedAt, updatedAt })),
    mediaSpendDaily: [{ _id: "spend", key: "row3", platform: "Facebook", accountId: "3", accountName: "LMD02_3", businessManagerId: "bm", date, spend: 25, currency: "USD" }],
    bankTransactions: [{ _id: "bank", id: "payment", matchedProviderId: "company", category: "Ad account funding", amount: 100, currency: "USD", date, direction: "out", status: "posted", source: "slash", accountName: "Card", counterparty: "Facebook", description: "FACEBK other ad account" }]
  };
}

async function finishRebuild(ctx: ReturnType<typeof database>, range: { rebuildFrom?: string; rebuildTo?: string; billingRevisions?: { providerId: string; revision: number }[] }) {
  if (range.rebuildFrom && range.rebuildTo) for (const day of mediaSpendDates(range.rebuildFrom, range.rebuildTo)) {
    await call(rebuildDate, ctx, { serviceToken, date: day, updatedAt });
  }
  for (const revision of range.billingRevisions ?? []) await call(completeBillingRebuild, ctx, { serviceToken, ...revision, updatedAt });
}

test("backdating consolidates equivalent history, keeps billing choices and financial sources, and rebuilds earlier spend", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.mediaFundingAssignments[0].effectiveTo = "2026-09-20";
    ctx.tables.mediaFundingAssignments.push({ ...ctx.tables.mediaFundingAssignments[0], _id: "current-1", effectiveFrom: "2026-09-21", effectiveTo: undefined, autoPattern: "lmd #" });
    ctx.tables.mediaFundingAssignments[1].billingType = "card";
    ctx.tables.mediaFundingAssignments.push({ ...ctx.tables.mediaFundingAssignments[1], _id: "current-3", targetKey: "ad_account:Facebook:3", accountId: "3", accountName: "LMD02_3", billingType: "credit_line", effectiveFrom: "2026-09-21" });
    const bank = structuredClone(ctx.tables.bankTransactions), spend = structuredClone(ctx.tables.mediaSpendDaily);
    const expected = () => ctx.tables.mediaFundingAssignments.map((item: any) => ({ id: item._id, updatedAt: item.updatedAt }));
    const args = { serviceToken, effectiveFrom: "2026-01-01", updatedAt, expectedAssignments: expected() };
    const result = await call(backdateAssignmentHistory, ctx, args);
    assert.equal(result.updatedAssignments, 3);
    assert.equal(result.consolidatedRows, 1);
    assert.equal(ctx.tables.mediaFundingAssignments.length, 3);
    assert(ctx.tables.mediaFundingAssignments.every((item: any) => item.effectiveFrom === args.effectiveFrom && !item.effectiveTo));
    const unknown = ctx.tables.mediaFundingAssignments.find((item: any) => item._id === "current-1");
    const card = ctx.tables.mediaFundingAssignments.find((item: any) => item._id === "assignment-2");
    assert(unknown && card);
    assert.equal(unknown.billingType, undefined);
    assert.equal(unknown.autoPattern, undefined);
    assert.equal(card.billingType, "card");
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, null);
    await finishRebuild(ctx, result);
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 75);
    assert.deepEqual(ctx.tables.bankTransactions, bank);
    assert.deepEqual(ctx.tables.mediaSpendDaily, spend);
    assert.deepEqual(await call(backdateAssignmentHistory, ctx, { ...args, expectedAssignments: expected() }), { updatedAssignments: 0, consolidatedRows: 0 });
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("backdating rejects stale backups, real history changes, earlier coverage and BM overlaps before writing", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    for (const scenario of ["provider", "billing", "earlier", "bm", "stale", "auth"]) {
      const ctx = database(seed());
      if (scenario === "provider" || scenario === "billing") {
        ctx.tables.mediaFundingAssignments[0].effectiveTo = "2026-09-20";
        ctx.tables.mediaFundingAssignments.push({ ...ctx.tables.mediaFundingAssignments[0], _id: "changed", effectiveFrom: "2026-09-21", effectiveTo: undefined,
          ...(scenario === "provider" ? { providerId: "other" } : { billingType: "card" }) });
      }
      if (scenario === "earlier") ctx.tables.mediaFundingAssignments[0].effectiveFrom = "2025-12-01";
      if (scenario === "bm") ctx.tables.mediaFundingAssignments.push({ ...ctx.tables.mediaFundingAssignments[0], _id: "bm-parent", scope: "business_manager", targetKey: "business_manager:Facebook:bm", effectiveFrom: "2026-09-21" });
      const snapshot = structuredClone(ctx.tables);
      const expectedAssignments = ctx.tables.mediaFundingAssignments.map((item: any) => ({ id: item._id, updatedAt: scenario === "stale" ? "old" : item.updatedAt }));
      await assert.rejects(call(backdateAssignmentHistory, ctx, { serviceToken: scenario === "auth" ? "wrong" : serviceToken, effectiveFrom: "2026-01-01", updatedAt, expectedAssignments }));
      assert.deepEqual(ctx.tables, snapshot, scenario);
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("bulk provider assignment saves individual billing types and preserves dated history and financial records", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    const bankRecords = structuredClone(ctx.tables.bankTransactions);
    const spendRecords = structuredClone(ctx.tables.mediaSpendDaily);
    await call(setPaymentMethods, ctx, { serviceToken, targets: [{ platform: "Facebook", accountId: "1" }], method: "own_card", effectiveFrom: date, updatedAt });
    const paymentMethods = structuredClone(ctx.tables.mediaAccountPaymentMethods);
    const targets = ["card", "credit_line"].map((billingType, index) => ({ scope: "ad_account", platform: "Facebook", businessManagerId: "bm", accountId: String(index + 1), billingType }));
    const args = { serviceToken, providerId: "meta", effectiveFrom: "2026-09-15", targets, updatedAt };
    await call(assignTargets, ctx, args);
    let result = await call(listSpendAssignments, ctx, { serviceToken });
    for (const target of targets) {
      const oldAssignment = resolveMediaFundingAssignment(result.assignments, { ...target, date });
      const newAssignment = resolveMediaFundingAssignment(result.assignments, { ...target, date: args.effectiveFrom });
      assert.equal(oldAssignment?.billingType, undefined);
      assert.equal(oldAssignment?.effectiveTo, date);
      assert.equal(newAssignment?.billingType, target.billingType);
    }
    // Repeating a submission must not duplicate active assignments.
    await call(assignTargets, ctx, args);
    assert.equal(ctx.tables.mediaFundingAssignments.length, 4);
    await call(assignTargets, ctx, { ...args, effectiveFrom: "2026-09-16", targets: [{ ...targets[0], billingType: "credit_line" }] });
    result = await call(listOverview, ctx, { serviceToken });
    assert.equal(resolveMediaFundingAssignment(result.assignments, { ...targets[0], date: "2026-09-15" })?.billingType, "card");
    assert.equal(resolveMediaFundingAssignment(result.assignments, { ...targets[0], date: "2026-09-16" })?.billingType, "credit_line");
    assert.equal(resolveMediaFundingAssignment(result.assignments, { ...targets[1], date: "2026-09-16" })?.billingType, "credit_line");
    assert.deepEqual(ctx.tables.bankTransactions, bankRecords);
    assert.deepEqual(ctx.tables.mediaSpendDaily, spendRecords);
    assert.deepEqual(ctx.tables.mediaAccountPaymentMethods, paymentMethods);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("business manager billing type is inherited by its accounts without inferring payment funding", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.mediaFundingAssignments = [];
    const range = await call(assignTargets, ctx, { serviceToken, providerId: "meta", effectiveFrom: date, updatedAt, targets: [{ scope: "business_manager", platform: "Facebook", businessManagerId: "bm", billingType: "credit_line" }] });
    await finishRebuild(ctx, range);
    const overview = await call(listOverview, ctx, { serviceToken });
    assert.equal(resolveMediaFundingAssignment(overview.assignments, { platform: "Facebook", businessManagerId: "bm", accountId: "3", date })?.billingType, "credit_line");
    assert.equal(overview.providers[0].spend, 25);
    assert.equal(overview.providers[0].needsReviewSpend, 0);
    assert.equal(overview.providers[0].estimatedBalance, 75);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("assignment rejects missing or invalid billing choices before writing and still requires authorization", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    const before = structuredClone(ctx.tables);
    const target = { scope: "ad_account", platform: "Facebook", businessManagerId: "bm", accountId: "1" };
    const args = { serviceToken, providerId: "meta", effectiveFrom: date, updatedAt };
    for (const billingType of [undefined, "cash", ""]) {
      await assert.rejects(call(assignTargets, ctx, { ...args, targets: [{ ...target, billingType: "card" }, { ...target, accountId: "2", billingType }] }), /Choose Card or Credit line/);
      assert.deepEqual(ctx.tables, before);
    }
    await assert.rejects(call(assignTargets, ctx, { ...args, serviceToken: "wrong", targets: [{ ...target, billingType: "card" }] }), /unauthorized/);
    assert.deepEqual(ctx.tables, before);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
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

test("payment-method history cannot classify unmarked accounts or override assignment billing types", async () => {
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
      assert.equal(provider.estimatedBalance, null);
      assert.equal(provider.needsReviewSpend, 25);
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


test("spend assignment bootstrap returns only provider identities and assignment/payment history", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    await call(setPaymentMethods, ctx, { serviceToken, targets: [{ platform: "Facebook", accountId: "1" }], method: "own_card", reference: "1234", effectiveFrom: date, updatedAt });
    const queried: string[] = [];
    const originalQuery = ctx.db.query;
    ctx.db.query = (table) => { queried.push(table); return originalQuery(table); };
    const result = await call(listSpendAssignments, ctx, { serviceToken });
    assert.deepEqual(Object.keys(result).sort(), ["assignments", "paymentMethods", "providers"]);
    assert.deepEqual(result.providers, [{ id: "meta", name: "Meta" }]);
    assert.equal(result.assignments.length, 2);
    assert.equal(result.assignments[0].accountId, "1");
    assert.equal(result.paymentMethods[0].method, "own_card");
    assert.equal(result.paymentMethods[0].reference, "1234");
    assert.equal("updatedAt" in result.paymentMethods[0], false);
    assert.equal("_creationTime" in result.assignments[0], false);
    assert.equal(queried.includes("bankTransactions"), false);
    assert.equal(queried.includes("mediaFundingProviderTotals"), false);
    await assert.rejects(call(listSpendAssignments, ctx, { serviceToken: "wrong" }));
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});


test("provider creation adds a supplier atomically and commissions feed cash-flow balance calculations", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.dashboardState[0].updatedAt = updatedAt;
    const before = structuredClone(ctx.tables.bankTransactions);
    const id = await call(createProvider, ctx, { serviceToken, companyProviderId: "", newSupplierName: "New agency", defaultFeePercent: 2, openingBalance: 0, openingBalanceDate: "2026-01-01", createdAt: updatedAt });
    const company = ctx.tables.dashboardState[0].providers.find((p: any) => p.name === "New agency");
    assert.equal(company.type, "supplier");
    assert.notEqual(ctx.tables.dashboardState[0].updatedAt, updatedAt);
    assert.deepEqual(ctx.tables.bankTransactions, before);
    const directory = await call(listSupplierCompanies, ctx, { serviceToken });
    assert.equal(directory.some((p: any) => p.id === company.id), true);
    assert.equal(directory.every((p: any) => !p.bankAccount && !p.email && !p.meritDetails), true);
    ctx.tables.bankTransactions.push({ ...before[0], _id: "new-payment", id: "new-payment", matchedProviderId: company.id, amount: 100000 });
    const totals = ctx.tables.mediaFundingProviderTotals.find(p => p.providerId === id)!;
    totals.spend = 20000; totals.billingSpend = { card: 0, credit_line: 20000, unclassified: 0, unclassifiedRows: 0 }; totals.classifiedSpend = { provider_funded: 20000, own_card: 0, meta_credit_line: 0 };
    let provider = (await call(listOverview, ctx, { serviceToken })).providers.find((p: any) => p.id === id);
    assert.equal(provider.fees, 2000);
    assert.equal(provider.netFunding, 98000);
    assert.equal(provider.estimatedBalance, 78000);
    // Commission edits reprice the included funding without modifying the bank ledger.
    await call(updateProvider, ctx, { serviceToken, providerId: id, companyProviderId: company.id, defaultFeePercent: 3, openingBalance: 0, openingBalanceDate: "2026-01-01", updatedAt });
    provider = (await call(listOverview, ctx, { serviceToken })).providers.find((p: any) => p.id === id);
    assert.equal(provider.netFunding, 97000);
    assert.equal(ctx.tables.bankTransactions[1].amount, 100000);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
test("unconverted provider funding blocks a misleading cash-flow balance", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed()); ctx.tables.bankTransactions[0].currency = "EUR";
    const overview = await call(listOverview, ctx, { serviceToken });
    assert.equal(overview.providers[0].excludedFundingCount, 1);
    assert.equal(overview.providers[0].estimatedBalance, null);
    assert.equal(overview.summary.estimatedBalance, null);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("Google, NewsBreak and TikTok account assignments deduct credit-line spend", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    for (const platform of ["Google", "NewsBreak", "TikTok"]) {
      const ctx = database(seed());
      ctx.tables.mediaFundingAssignments = [{ ...ctx.tables.mediaFundingAssignments[0], platform, billingType: "credit_line",
        targetKey: `ad_account:${platform}:1`, businessManagerKey: `${platform}:bm` }];
      ctx.tables.mediaSpendDaily[0] = { ...ctx.tables.mediaSpendDaily[0], accountId: "1", platform };
      await call(setPaymentMethods, ctx, { serviceToken, method: "provider_funded", providerId: "meta", targets: [{ platform, accountId: "1" }], effectiveFrom: date, updatedAt });
      await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
      const provider = (await call(listOverview, ctx, { serviceToken })).providers[0];
      assert.equal(provider.classifiedSpend.provider_funded, 25, platform);
      assert.equal(provider.estimatedBalance, 75, platform);
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("only credit-line spend reduces balances regardless of payment methods, with fees, adjustments and refunds preserved", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.mediaFundingProviders[0].openingBalance = 100;
    ctx.tables.mediaFundingProviders[0].defaultFeePercent = 2;
    ctx.tables.bankTransactions[0].amount = 1000;
    ctx.tables.mediaFundingEntries = [{ _id: "adjustment", providerId: "meta", type: "adjustment", date, netAmount: 50, createdAt: updatedAt, updatedAt }];
    ctx.tables.mediaSpendDaily = [
      { ...ctx.tables.mediaSpendDaily[0], _id: "line", accountId: "1", spend: 400 },
      { ...ctx.tables.mediaSpendDaily[0], _id: "card", accountId: "2", spend: 250 }
    ];
    const source = structuredClone({ spend: ctx.tables.mediaSpendDaily, bank: ctx.tables.bankTransactions, entries: ctx.tables.mediaFundingEntries });
    const range = await call(assignTargets, ctx, { serviceToken, providerId: "meta", effectiveFrom: date, updatedAt,
      targets: ["credit_line", "card"].map((billingType, i) => ({ scope: "ad_account", platform: "Facebook", businessManagerId: "bm", accountId: String(i + 1), billingType })) });
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, null);
    await finishRebuild(ctx, range);
    for (const method of ["provider_funded", "own_card", "meta_credit_line", "needs_review"]) {
      await call(setPaymentMethods, ctx, { serviceToken, targets: [{ platform: "Facebook", accountId: "1" }, { platform: "Facebook", accountId: "2" }], method, effectiveFrom: date, updatedAt });
      await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
      const provider = (await call(listOverview, ctx, { serviceToken })).providers[0];
      assert.equal(provider.spend, 650);
      assert.equal(provider.estimatedBalance, 730); // 100 + 980 + 50 - 400; card spend is excluded.
      assert.deepEqual(provider.billingSpend, { credit_line: 400, card: 250, unclassified: 0, unclassifiedRows: 0 });
      await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
      assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 730);
    }
    assert.deepEqual({ spend: ctx.tables.mediaSpendDaily, bank: ctx.tables.bankTransactions, entries: ctx.tables.mediaFundingEntries }, source);
    ctx.tables.mediaSpendDaily[0].spend = -20;
    ctx.tables.mediaSpendDaily[1].spend = -10;
    await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 1150);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("backdated billing edits preserve opening-date boundaries and prevent incomplete or older rebuilds from publishing balances", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.mediaFundingAssignments = [];
    ctx.tables.mediaSpendSyncState[0].coveredThrough = "2026-09-16";
    ctx.tables.mediaFundingProviders[0].openingBalance = 200;
    ctx.tables.mediaFundingProviders[0].openingBalanceDate = date;
    ctx.tables.mediaSpendDaily = [date, "2026-09-15", "2026-09-16"].map((day, i) => ({ ...ctx.tables.mediaSpendDaily[0], _id: `spend-${i}`, key: `day-${i}`, date: day, spend: (i + 1) * 10 }));
    const args = { serviceToken, providerId: "meta", effectiveFrom: date, updatedAt };
    const target = { scope: "ad_account", platform: "Facebook", businessManagerId: "bm", accountId: "3" };
    await finishRebuild(ctx, await call(assignTargets, ctx, { ...args, targets: [{ ...target, billingType: "credit_line" }] }));
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 150); // Opening date's spend and funding are excluded.
    const first = await call(assignTargets, ctx, { ...args, effectiveFrom: "2026-09-15", targets: [{ ...target, billingType: "card" }] });
    await call(rebuildDate, ctx, { serviceToken, date: "2026-09-15", updatedAt });
    let overview = await call(listOverview, ctx, { serviceToken });
    assert.equal(overview.providers[0].billingRebuildPending, true);
    assert.equal(overview.providers[0].estimatedBalance, null);
    await assert.rejects(call(completeBillingRebuild, ctx, { serviceToken, ...first.billingRevisions[0], updatedAt }), /incomplete/);
    const second = await call(assignTargets, ctx, { ...args, effectiveFrom: "2026-09-16", targets: [{ ...target, billingType: "credit_line" }] });
    assert.equal(second.rebuildFrom, "2026-09-15"); // Includes the unfinished earlier change.
    assert.equal(await call(completeBillingRebuild, ctx, { serviceToken, ...first.billingRevisions[0], updatedAt }), false);
    await finishRebuild(ctx, second);
    overview = await call(listOverview, ctx, { serviceToken });
    assert.equal(overview.providers[0].estimatedBalance, 170);
    assert.deepEqual(overview.providers[0].billingSpend, { credit_line: 30, card: 20, unclassified: 0, unclassifiedRows: 0 });
    await call(updateProvider, ctx, { serviceToken, providerId: "meta", companyProviderId: "company", defaultFeePercent: 0, openingBalance: 200, openingBalanceDate: "2026-09-15", updatedAt });
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 170);
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].spend, 30);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("reassigning credit-line spend updates both providers and changing it to card removes the deduction", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.dashboardState[0].updatedAt = updatedAt;
    const second = await call(createProvider, ctx, { serviceToken, companyProviderId: "", newSupplierName: "Second agency", defaultFeePercent: 0, openingBalance: 200, openingBalanceDate: "2026-01-01", createdAt: updatedAt });
    const target = { scope: "ad_account", platform: "Facebook", businessManagerId: "bm", accountId: "3", billingType: "credit_line" };
    const args = { serviceToken, providerId: "meta", targets: [target], effectiveFrom: date, updatedAt };
    await finishRebuild(ctx, await call(assignTargets, ctx, args));
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers.find((p: any) => p.id === "meta").estimatedBalance, 75);
    const moved = await call(assignTargets, ctx, { ...args, providerId: second });
    assert.deepEqual(new Set(moved.billingRevisions.map((r: any) => r.providerId)), new Set(["meta", second]));
    await finishRebuild(ctx, moved);
    let providers = (await call(listOverview, ctx, { serviceToken })).providers;
    assert.equal(providers.find((p: any) => p.id === "meta").estimatedBalance, 100);
    assert.equal(providers.find((p: any) => p.id === second).estimatedBalance, 175);
    await finishRebuild(ctx, await call(assignTargets, ctx, { ...args, providerId: second, targets: [{ ...target, billingType: "card" }] }));
    providers = (await call(listOverview, ctx, { serviceToken })).providers;
    assert.equal(providers.find((p: any) => p.id === second).estimatedBalance, 200);
    const assignment = ctx.tables.mediaFundingAssignments.find(a => a.providerId === second)!;
    await finishRebuild(ctx, await call(deleteAssignment, ctx, { serviceToken, assignmentId: assignment._id }));
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers.find((p: any) => p.id === second).spend, 0);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("saved-history reconciliation replaces old payment-based deductions without changing source financial records", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.mediaFundingAssignments[0].billingType = "card";
    ctx.tables.mediaSpendDaily[0].accountId = "1";
    delete ctx.tables.mediaFundingProviderTotals[0].billingSpend;
    ctx.tables.mediaFundingProviderTotals[0].spend = 25;
    ctx.tables.mediaFundingProviderTotals[0].classifiedSpend = { provider_funded: 25, own_card: 0, meta_credit_line: 0 };
    ctx.tables.mediaFundingSpendDaily = [{ _id: "old-day", key: `meta:${date}:USD`, providerId: "meta", date, currency: "USD", spend: 25, classifiedSpend: { provider_funded: 25, own_card: 0, meta_credit_line: 0 }, accountCount: 1, businessManagerCount: 1, updatedAt }];
    const raw = structuredClone({ bank: ctx.tables.bankTransactions, spend: ctx.tables.mediaSpendDaily, assignments: ctx.tables.mediaFundingAssignments });
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].billingRebuildPending, true);
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, null);
    assert.equal((await call(billingRebuildStatus, ctx, { serviceToken })).pendingProviders, 1);
    await finishRebuild(ctx, await call(prepareBillingRebuild, ctx, { serviceToken, updatedAt }));
    assert.equal((await call(billingRebuildStatus, ctx, { serviceToken })).pendingProviders, 0);
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 100);
    await finishRebuild(ctx, await call(prepareBillingRebuild, ctx, { serviceToken, updatedAt }));
    assert.equal((await call(listOverview, ctx, { serviceToken })).providers[0].estimatedBalance, 100);
    assert.deepEqual({ bank: ctx.tables.bankTransactions, spend: ctx.tables.mediaSpendDaily, assignments: ctx.tables.mediaFundingAssignments }, raw);
    await assert.rejects(call(prepareBillingRebuild, ctx, { serviceToken: "wrong", updatedAt }), /unauthorized/);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("offsetting unclassified charges and refunds still block a misleading numeric balance", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  try {
    const ctx = database(seed());
    ctx.tables.mediaSpendDaily = [
      { ...ctx.tables.mediaSpendDaily[0], _id: "charge", key: "charge", accountId: "1", spend: 25 },
      { ...ctx.tables.mediaSpendDaily[0], _id: "refund", key: "refund", accountId: "2", spend: -25 }
    ];
    await call(rebuildDate, ctx, { serviceToken, date, updatedAt });
    const provider = (await call(listOverview, ctx, { serviceToken })).providers[0];
    assert.equal(provider.needsReviewSpend, 0);
    assert.equal(provider.billingSpend.unclassifiedRows, 2);
    assert.equal(provider.estimatedBalance, null);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
