import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mediaSpendDates } from "../shared/mediaSpend";
import { mediaFundingDefaultEffectiveFrom, type MediaFundingBillingType } from "../shared/mediaFunding";
import { centralSheetHistoryConflict, matchCentralSheetAccount, type CentralSheetProvider, type CentralSheetCatalogAccount } from "../shared/centralSheetImport";
import { productionEnvironment, productionServiceEnvironment, productionUrl } from "./deploy-production";

// Explicit, reviewed import only. No upstream reporting requests and no inferred opening dates/fees.
// npx tsx scripts/import-central-sheet.ts .local/reviewed-central-sheet.json [--apply]
const input = process.argv[2];
assert(input && !input.startsWith("--"), "Supply a reviewed JSON plan");
const definitions: CentralSheetProvider[] = JSON.parse(readFileSync(input, "utf8"));
assert(Array.isArray(definitions) && definitions.length > 0 && definitions.length <= 100);
assert.equal(new Set(definitions.map(item => item.supplierName)).size, definitions.length, "Duplicate supplier in plan");
for (const definition of definitions) {
  assert(definition.supplierName.trim() && typeof definition.allowCreateSupplier === "boolean" && Array.isArray(definition.accounts));
  for (const account of definition.accounts) {
    assert(typeof account.name === "string" && (!account.accountId || typeof account.accountId === "string"));
    assert(account.billingType === undefined || account.billingType === "card" || account.billingType === "credit_line");
  }
}
const local = Object.assign({}, ...[".env", ".env.local"].map(file => existsSync(file) ? parse(readFileSync(file)) : {}));
const env = productionServiceEnvironment(productionEnvironment({ ...local, ...process.env }));
const serviceToken = env.CONVEX_SERVICE_TOKEN!;
const convex = new ConvexHttpClient(productionUrl);
const [before, suppliers, sync] = await Promise.all([
  convex.query(api.mediaFunding.listOverview, { serviceToken }),
  convex.query(api.mediaFunding.listSupplierCompanies, { serviceToken }),
  convex.query(api.mediaSpend.getSyncState, { serviceToken })
]);
assert(sync?.coveredFrom && sync.coveredThrough, "Saved spend coverage is required");
mkdirSync(".local", { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const backupPath = `.local/central-sheet-before-${stamp}.json`;
writeFileSync(backupPath, JSON.stringify({ before, suppliers, sync, definitions }), { mode: 0o600 });
const catalog: CentralSheetCatalogAccount[] = before.assignments.filter(item => item.scope === "ad_account" && item.accountId).map(item => ({ ...item, accountId: item.accountId! }));
const cachePath = ".local/central-sheet-saved-accounts.json";
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : null;
if (cache?.lastSuccessAt === sync.lastSuccessAt && cache?.through === sync.coveredThrough && cache?.from === sync.coveredFrom) {
  catalog.push(...cache.accounts);
} else {
  const dates = mediaSpendDates(sync.coveredFrom, sync.coveredThrough);
  const accounts = new Map<string, CentralSheetCatalogAccount>();
  for (let offset = 0; offset < dates.length; offset += 4) {
    const days = await Promise.all(dates.slice(offset, offset + 4).map(date => convex.query(api.mediaSpend.listDate, { serviceToken, date, includeZeroSpend: true })));
    for (const day of days) for (const row of day.rows) {
      accounts.set(`${row.platform}:${row.accountId}:${row.accountName}`, {
        platform: row.platform, accountId: row.accountId, accountName: row.accountName,
        businessManagerId: row.businessManagerId, businessManagerName: row.businessManagerName
      });
    }
    if (offset % 20 === 0) console.log(JSON.stringify({ event: "saved_history_read", days: Math.min(offset + 4, dates.length), total: dates.length }));
  }
  catalog.push(...accounts.values());
  writeFileSync(cachePath, JSON.stringify({ lastSuccessAt: sync.lastSuccessAt, from: sync.coveredFrom, through: sync.coveredThrough, accounts: [...accounts.values()] }), { mode: 0o600 });
}

type Match = { supplierName: string; target: CentralSheetCatalogAccount; billingType?: MediaFundingBillingType };
const proposed = new Map<string, Match[]>();
const pending: { supplier: string; account: string; reason: string }[] = [];
const providerIds = new Map<string, Id<"mediaFundingProviders">>();
for (const definition of definitions) {
  const companies = suppliers.filter(item => item.name === definition.supplierName);
  assert(companies.length <= 1, `Ambiguous supplier: ${definition.supplierName}`);
  assert(companies.length === 1 || definition.allowCreateSupplier, `Unresolved supplier: ${definition.supplierName}`);
  const provider = before.providers.find(item => item.companyProviderId === companies[0]?.id);
  if (provider) providerIds.set(definition.supplierName, provider.id);
  if (provider && definition.providerBillingType) {
    for (const assignment of before.assignments.filter(item => item.providerId === provider.id && item.scope === "ad_account" && item.accountId)) {
      const target = { ...assignment, accountId: assignment.accountId! };
      const key = `${target.platform}:${target.accountId}`;
      const proposals = proposed.get(key) ?? [];
      proposals.push({ supplierName: definition.supplierName, target, billingType: definition.providerBillingType });
      proposed.set(key, proposals);
    }
  }

  for (const account of definition.accounts) {
    const match = matchCentralSheetAccount(account, catalog);
    if (match.status !== "matched") {
      pending.push({ supplier: definition.supplierName, account: account.name, reason: match.status });
      continue;
    }
    const key = `${match.target.platform}:${match.target.accountId}`;
    const proposals = proposed.get(key) ?? [];
    proposals.push({ supplierName: definition.supplierName, target: match.target, billingType: account.billingType });
    proposed.set(key, proposals);
  }
}
const matches: Match[] = [];
for (const proposals of proposed.values()) {
  const match = proposals[0];
  const choices = new Set(proposals.map(item => item.billingType).filter(Boolean));
  const names = new Set(proposals.map(item => item.supplierName));
  const history = before.assignments.filter(item => item.platform === match.target.platform && item.accountId === match.target.accountId);
  const billingType = choices.size === 1 ? [...choices][0] : undefined;
  if (names.size > 1 || choices.size > 1 || centralSheetHistoryConflict(history, providerIds.get(match.supplierName), billingType)
    || before.assignments.some(item => item.scope === "business_manager" && item.platform === match.target.platform && item.businessManagerId === match.target.businessManagerId)) {
    pending.push({ supplier: match.supplierName, account: match.target.accountName ?? match.target.accountId, reason: "provider/billing conflict" });
  } else matches.push({ ...match, billingType });
}
const hasHistory = (match: Match) => before.assignments.some(item => item.platform === match.target.platform && item.accountId === match.target.accountId);
const summary = definitions.map(definition => {
  const assigned = matches.filter(item => item.supplierName === definition.supplierName);
  return { supplier: definition.supplierName, createProvider: !providerIds.has(definition.supplierName),
    newAssignments: assigned.filter(item => !hasHistory(item)).length,
    classifications: assigned.filter(item => item.billingType && (!hasHistory(item) || before.assignments.some(a => a.platform === item.target.platform && a.accountId === item.target.accountId && !a.billingType))).length,
    pendingRows: pending.filter(item => item.supplier === definition.supplierName).length };
});
writeFileSync(".local/central-sheet-import-plan.json", JSON.stringify({ summary, matches, pending }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ event: "central_sheet_plan", deployment: productionUrl, summary, pendingRows: pending.length, backupPath }));
if (!process.argv.includes("--apply")) process.exit(0);

const results = { createdProviders: [] as string[], newAssignments: 0, classifiedAccounts: 0, references: 0 };
for (const definition of definitions) {
  let providerId = providerIds.get(definition.supplierName);
  if (!providerId) {
    const company = suppliers.find(item => item.name === definition.supplierName);
    providerId = await convex.mutation(api.mediaFunding.createProvider, { serviceToken, companyProviderId: company?.id ?? "",
      ...(!company ? { newSupplierName: definition.supplierName } : {}), balanceVerified: false,
      defaultFeePercent: 0, openingBalance: 0, openingBalanceDate: mediaFundingDefaultEffectiveFrom, createdAt: new Date().toISOString() });
    providerIds.set(definition.supplierName, providerId);
    results.createdProviders.push(definition.supplierName);
  }
  const current = (await convex.query(api.mediaFunding.listOverview, { serviceToken })).providers.find(item => item.id === providerId)!;
  if (JSON.stringify(current.sourceReference) !== JSON.stringify(definition.reference)) {
    await convex.mutation(api.mediaFunding.saveSourceReference, { serviceToken, providerId, expectedUpdatedAt: current.updatedAt, reference: definition.reference, updatedAt: new Date().toISOString() });
  }
  results.references++;
  const selected = matches.filter(item => item.supplierName === definition.supplierName);
  const historical = selected.filter(item => hasHistory(item) && item.billingType
    && before.assignments.some(a => a.platform === item.target.platform && a.accountId === item.target.accountId && !a.billingType));
  for (let offset = 0; offset < historical.length; offset += 100) {
    const batch = historical.slice(offset, offset + 100);
    await convex.mutation(api.mediaFunding.classifyAssignmentHistory, { serviceToken, providerId,
      accounts: batch.map(item => ({ platform: item.target.platform, accountId: item.target.accountId, billingType: item.billingType! })), updatedAt: new Date().toISOString() });
    results.classifiedAccounts += batch.length;
  }
  const added = selected.filter(item => !hasHistory(item));
  for (let offset = 0; offset < added.length; offset += 100) {
    const batch = added.slice(offset, offset + 100);
    await convex.mutation(api.mediaFunding.assignTargets, { serviceToken, providerId, onlyUnassigned: true, effectiveFrom: mediaFundingDefaultEffectiveFrom,
      targets: batch.map(item => ({ scope: "ad_account" as const, ...item.target, ...(item.billingType ? { billingType: item.billingType } : {}) })), updatedAt: new Date().toISOString() });
    results.newAssignments += batch.length;
    results.classifiedAccounts += batch.filter(item => item.billingType).length;
  }
  console.log(JSON.stringify({ event: "central_sheet_provider_applied", supplier: definition.supplierName }));
}
const reconciliation = spawnSync("npm", ["run", "media-funding:reconcile"], { env, stdio: "inherit" });
assert.equal(reconciliation.status, 0, "Assignments saved; derived balance reconciliation must be completed");
const after = await convex.query(api.mediaFunding.listOverview, { serviceToken });
for (const provider of before.providers) {
  const actual = after.providers.find(item => item.id === provider.id)!;
  for (const key of ["openingBalance", "openingBalanceDate", "defaultFeePercent", "grossFunding", "fees", "netFunding", "adjustments", "bankFundingPaused"] as const) {
    assert.equal(actual[key], provider[key], `Existing ${key} changed for ${provider.name}`);
  }
}
assert.deepEqual(after.entries, before.entries, "Adjustments changed");
for (const original of before.assignments) {
  const current = after.assignments.find(item => item.id === original.id)!;
  assert(current, "Existing assignment deleted");
  for (const key of ["providerId", "effectiveFrom", "effectiveTo", "targetKey"] as const) assert.equal(current[key], original[key], "Assignment history changed");
}
for (const match of matches) {
  const assignment = after.assignments.find(item => item.platform === match.target.platform && item.accountId === match.target.accountId && item.providerId === providerIds.get(match.supplierName));
  assert(assignment, "Imported assignment missing");
  if (match.billingType) assert.equal(assignment.billingType, match.billingType);
}
assert(after.providers.filter(item => !item.balanceVerified).every(item => item.estimatedBalance === null));
writeFileSync(`.local/central-sheet-after-${stamp}.json`, JSON.stringify({ after, results, pending }), { mode: 0o600 });
console.log(JSON.stringify({ event: "central_sheet_verified", ...results, remainingUnclassified: after.assignments.filter(item => !item.billingType).length, pendingRows: pending.length }));
