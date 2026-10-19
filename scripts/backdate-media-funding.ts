import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { mediaFundingDefaultEffectiveFrom } from "../shared/mediaFunding";
import { productionEnvironment, productionServiceEnvironment, productionUrl } from "./deploy-production";

// Explicit maintenance only; never run automatically during deployment.
const local = Object.assign({}, ...[".env", ".env.local"].map(file => existsSync(file) ? parse(readFileSync(file)) : {}));
const env = productionServiceEnvironment(productionEnvironment({ ...local, ...process.env }));
const serviceToken = env.CONVEX_SERVICE_TOKEN!;
const convex = new ConvexHttpClient(productionUrl);
const before = await convex.query(api.mediaFunding.listOverview, { serviceToken });
const current = before.assignments.filter(item => !item.effectiveTo);
console.log(JSON.stringify({ event: "media_funding_backdate_plan", deployment: productionUrl,
  effectiveFrom: mediaFundingDefaultEffectiveFrom, accounts: current.length, historyRows: before.assignments.length }));

if (process.argv.includes("--apply")) {
  mkdirSync(".local", { recursive: true });
  const timestamp = new Date().toISOString();
  const backup = `.local/media-funding-before-backdate-${timestamp.replaceAll(":", "-")}.json`;
  writeFileSync(backup, JSON.stringify(before), { mode: 0o600 });
  console.log(JSON.stringify({ event: "media_funding_assignment_backup", path: backup }));
  const result = await convex.mutation(api.mediaFunding.backdateAssignmentHistory, {
    serviceToken, effectiveFrom: mediaFundingDefaultEffectiveFrom, updatedAt: timestamp,
    expectedAssignments: before.assignments.map(({ id, updatedAt }) => ({ id, updatedAt }))
  });
  console.log(JSON.stringify({ event: "media_funding_assignments_backdated", updatedAssignments: result.updatedAssignments, consolidatedRows: result.consolidatedRows }));
  const reconciliation = spawnSync("npm", ["run", "media-funding:reconcile"], { env, stdio: "inherit" });
  if (reconciliation.error || reconciliation.status !== 0) throw new Error("Backdating saved, but balance reconciliation is pending; rerun media-funding:reconcile");
  const after = await convex.query(api.mediaFunding.listOverview, { serviceToken });
  const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(byId(after.bankFunding), byId(before.bankFunding), "Bank funding changed during backdating");
  assert.deepEqual(byId(after.entries), byId(before.entries), "Adjustments changed during backdating");
  assert.deepEqual(byId(after.paymentMethods), byId(before.paymentMethods), "Independent payment methods changed");
  const funding = (providers: typeof before.providers) => byId(providers).map(p => ({
    id: p.id, companyProviderId: p.companyProviderId, openingBalance: p.openingBalance, openingBalanceDate: p.openingBalanceDate,
    defaultFeePercent: p.defaultFeePercent, grossFunding: p.grossFunding, fees: p.fees, netFunding: p.netFunding, adjustments: p.adjustments
  }));
  assert.deepEqual(funding(after.providers), funding(before.providers), "Funding or opening balances changed");
  const ownership = (assignments: typeof before.assignments) => byId(assignments).map(a => ({ id: a.id, providerId: a.providerId, targetKey: a.targetKey, billingType: a.billingType }));
  assert.deepEqual(ownership(after.assignments), ownership(current), "Account ownership or billing choices changed");
  assert(after.assignments.every(a => a.effectiveFrom === mediaFundingDefaultEffectiveFrom && !a.effectiveTo), "Not every assignment starts on the requested date");
  writeFileSync(".local/media-funding-after-backdate.json", JSON.stringify(after), { mode: 0o600 });
  console.log(JSON.stringify({ event: "media_funding_backdate_verified", accounts: after.assignments.length,
    unclassified: after.assignments.filter(a => !a.billingType).length, effectiveFrom: mediaFundingDefaultEffectiveFrom }));
}
