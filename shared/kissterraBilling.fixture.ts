import type { Invoice, Provider, RevenueAccrual, TuneRevenuePartner, RevenueRun } from "./types";

export function kissterraFixture() {
  const period = { periodStart: "2026-10-26", periodEnd: "2026-11-01" };
  const now = new Date("2026-11-02T07:00:00Z");
  const provider: Provider = { id: "kissterra-customer", name: "Kissterra Technologies Ltd", type: "client", tags: [], aliases: [], source: "merit", meritCustomerId: "customer-id", defaultMeritTaxId: "zero-tax", createdAt: now.toISOString() };
  const names = [["1777", "Inch Media"], ["2036", "Inch Media (DCPL)"], ["2205", "Inch Media [Native]"], ["2230", "Inch Media - External"]];
  const partners: TuneRevenuePartner[] = names.map(([id, name]) => ({
    id: id === "1777" ? "revenue-kissterra" : `revenue-kissterra-${id}`,
    name: `Kissterra — ${name} (Account ID: ${id})`, source: "tune", affiliateId: id,
    providerId: provider.id, currency: "USD", timezone: "UTC", networkTimezone: "UTC",
    networkIdEnv: "KISSTERRA_TUNE_NETWORK_ID", apiKeyEnv: `KEY_${id}`, revenueCategory: "Partner network revenue",
    billingCadence: "weekly", billingTimezone: "Asia/Beirut", invoiceDueDays: 7,
    autoDraft: true, enabled: true, createdAt: now.toISOString()
  }));
  const amounts = [258845, 179.93, 0, 0];
  const runs: RevenueRun[] = partners.map((p, i) => ({ id: `revenue-${p.id}-${period.periodStart}-${period.periodEnd}`, partnerId: p.id, partnerName: p.name, providerId: p.providerId,
    revenueCategory: p.revenueCategory, source: p.source, currency: p.currency, timezone: p.timezone, revenue: amounts[i], status: "pulled", ...period, createdAt: now.toISOString() }));
  const seed: Invoice = { id: "existing-invoice", documentType: "sales_invoice", origin: "merit", customerName: "Other customer", amount: 10, currency: "USD", status: "open", meritDeliveryStatus: "saved", invoiceNumber: "2026/1438", issueDate: "2026-10-26", dueDate: "2026-11-02", source: "merit", externalId: "existing-merit", description: "Existing invoice", revenueRunIds: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const state = { providers: [provider], revenueRuns: structuredClone(runs), revenueAccruals: [] as RevenueAccrual[], invoices: [seed], teams: [] };
  return { period, now, provider, partners, runs, state };
}
