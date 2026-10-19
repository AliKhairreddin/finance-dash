import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { mediaSpendDates } from "../shared/mediaSpend";
import { calculateMediaFundingBalance, roundMediaFundingMoney } from "../shared/mediaFunding";
import { productionEnvironment, productionServiceEnvironment, productionUrl } from "./deploy-production";

// Production only. Rebuild derived balances from saved Convex data, without fetching upstream history.
// --force deliberately reconciles all saved history even when the current aggregates are ready.
const local = Object.assign({}, ...[".env", ".env.local"].map(file => existsSync(file) ? parse(readFileSync(file)) : {}));
const env = productionServiceEnvironment(productionEnvironment({ ...local, ...process.env }));
const serviceToken = env.CONVEX_SERVICE_TOKEN!;
const convex = new ConvexHttpClient(productionUrl);
const status = await convex.query(api.mediaFunding.billingRebuildStatus, { serviceToken });
if (status.pendingProviders > 0 || process.argv.includes("--force")) {
  const updatedAt = new Date().toISOString();
  const range = await convex.mutation(api.mediaFunding.prepareBillingRebuild, { serviceToken, updatedAt });
  const dates = range.rebuildFrom && range.rebuildTo ? mediaSpendDates(range.rebuildFrom, range.rebuildTo) : [];
  console.log(JSON.stringify({ event: "media_funding_billing_rebuild_started", days: dates.length, providers: range.billingRevisions?.length ?? 0 }));
  for (const [index, date] of dates.entries()) {
    await convex.mutation(api.mediaFunding.rebuildDate, { serviceToken, date, updatedAt });
    if ((index + 1) % 10 === 0 || index + 1 === dates.length) console.log(JSON.stringify({ event: "media_funding_billing_rebuild_progress", completedDays: index + 1, days: dates.length }));
  }
  for (const { providerId, revision } of range.billingRevisions ?? []) {
    await convex.mutation(api.mediaFunding.completeBillingRebuild, { serviceToken, providerId, revision, updatedAt });
  }
}
const after = await convex.query(api.mediaFunding.billingRebuildStatus, { serviceToken });
if (after.pendingProviders > 0) throw new Error("Provider balance recalculation is incomplete. Rerun media-funding:reconcile to finish saved-data reconciliation.");
const overview = await convex.query(api.mediaFunding.listOverview, { serviceToken });
for (const provider of overview.providers) {
  const spend = provider.billingSpend;
  if (!spend || provider.billingRebuildPending) throw new Error("Provider billing totals are not ready");
  if (Math.abs(roundMediaFundingMoney(spend.card + spend.credit_line + spend.unclassified) - provider.spend) > 0.02) {
    throw new Error(`Billing classifications do not reconcile to account spend for provider ${provider.id}`);
  }
  const expected = provider.bankFundingPaused || provider.excludedFundingCount > 0 || spend.unclassifiedRows > 0
    ? null : calculateMediaFundingBalance({ openingBalance: provider.openingBalance, netFunding: provider.netFunding, adjustments: provider.adjustments, spend: spend.credit_line });
  if (provider.estimatedBalance !== expected) throw new Error(`Credit-line balance verification failed for provider ${provider.id}`);
}
console.log(JSON.stringify({ event: "media_funding_billing_verified", deployment: productionUrl, providers: overview.providers.length,
  unclassifiedProviders: overview.providers.filter(provider => (provider.billingSpend?.unclassifiedRows ?? 0) > 0).length }));
