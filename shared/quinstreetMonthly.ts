import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { currentMonthAccrualPeriod } from "./income";
import type { RevenuePartner, RevenueRun } from "./types";
import type { RevenuePeriod } from "./revenue";

export interface QuinStreetMonthlyRow {
  partnerId: string; partnerName: string; periodStart: string; periodEnd: string;
  timezone: string; revenue: number | null; currency: string; fetchedAt?: string; error?: string; running: boolean;
}
export async function readQuinStreetMonthly(client: ConvexHttpClient, serviceToken: string, partners: RevenuePartner[], now = new Date()): Promise<QuinStreetMonthlyRow[]> {
  return (await Promise.all(partners.filter(p => p.enabled && p.source === "quinstreet").map(async partner => {
    const period = currentMonthAccrualPeriod(now, partner.billingTimezone);
    if (!period) return [];
    const periodEnd = period.accruedThrough;
    const key = `quinstreet-mtd:${partner.id}:${period.periodStart}:${periodEnd}`;
    const [report, status] = await Promise.all([
      client.query(api.integrationSync.quinStreetReport, { serviceToken, partnerId: partner.id, periodStart: period.periodStart, periodEnd }),
      client.query(api.integrationSync.status, { serviceToken, key })
    ]);
    return [{ partnerId: partner.id, partnerName: partner.name, periodStart: period.periodStart, periodEnd,
      timezone: partner.billingTimezone, revenue: report?.revenue ?? null, currency: partner.currency,
      fetchedAt: report?.fetchedAt, error: status?.error, running: status?.running ?? false }];
  }))).flat();
}
export async function syncQuinStreetMonthly(client: ConvexHttpClient, serviceToken: string, partners: RevenuePartner[],
  fetchRevenue: (partner: RevenuePartner, period: RevenuePeriod) => Promise<RevenueRun>, now = new Date(), reconcile = false): Promise<QuinStreetMonthlyRow[]> {
  const saved = await readQuinStreetMonthly(client, serviceToken, partners, now);
  for (const row of saved) {
    if (row.revenue !== null && !reconcile) continue;
    const partner = partners.find(p => p.id === row.partnerId)!;
    const key = `quinstreet-mtd:${partner.id}:${row.periodStart}:${row.periodEnd}`;
    const leaseId = crypto.randomUUID();
    const lease = await client.mutation(api.integrationSync.begin, { serviceToken, key, leaseId });
    if (!lease.acquired) continue;
    try {
      const run = await fetchRevenue(partner, { preset: "custom", periodStart: row.periodStart, periodEnd: row.periodEnd, timezone: row.timezone });
      if (run.status === "failed" || !Number.isFinite(run.revenue) || run.currency !== row.currency
        || run.periodStart !== row.periodStart || run.periodEnd !== row.periodEnd) throw new Error(run.error || "Incomplete QuinStreet report");
      await client.mutation(api.integrationSync.saveQuinStreetReport, { serviceToken, leaseId, report: {
        partnerId: row.partnerId, partnerName: row.partnerName, periodStart: row.periodStart, periodEnd: row.periodEnd,
        timezone: row.timezone, revenue: run.revenue, currency: run.currency, fetchedAt: new Date().toISOString()
      } });
      await client.mutation(api.integrationSync.finish, { serviceToken, key, leaseId });
    } catch (error) {
      await client.mutation(api.integrationSync.finish, { serviceToken, key, leaseId,
        error: error instanceof Error ? error.message : "QuinStreet report failed" }).catch(() => undefined);
    }
  }
  return readQuinStreetMonthly(client, serviceToken, partners, now);
}
