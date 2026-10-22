export const topUpCurrencies = ["USD", "EUR", "GBP", "AED", "LBP"] as const;
export const topUpMinimumExpectedThreeDaysSpend = 1000;
export type TopUpStatus = "pending" | "approved" | "paid";
export interface TopUpInput {
  submissionId: string; entity: "dn" | "lmd"; priority: "Normal" | "Urgent";
  companyName: string; providerId?: string; commission: string; team: string; member: string;
  amount: number; currency: string; openBalance: number; lastThreeDaysSpend: number; expectedThreeDaysSpend: number;
  paymentMethod: string; wiseLink: string; notes: string; bmNames: string[]; accountNames: string[];
}
export interface TopUpRequest extends TopUpInput {
  _id: string; number: number; documentId: string; fileName: string; contentType: string;
  status: TopUpStatus; version: number; createdAt: string; updatedAt: string;
  originalAmount: number; approvedBy?: string; paidBy?: string; deletedAt?: string; deletedBy?: string;
  events: { at: string; actor: string; action: string; amount: number }[];
  notificationError?: string; draftStatus: string; draftError?: string; draftId?: string;
  paymentDetails?: TopUpPaymentDetails;
}
export interface TopUpPaymentDetails { payerEntity: "dn" | "lmd" | ""; beneficiary: string; iban: string; bic: string; reference: string; amount: number | null; currency: string; notes: string }
export function validateTopUpInput(value: unknown): TopUpInput {
  if (!value || typeof value !== "object") throw new Error("Complete the request details");
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    if (typeof v[key] !== "string" || (v[key] as string).length > max || (required && !(v[key] as string).trim())) throw new Error(`Enter a valid ${key}`);
    return (v[key] as string).trim();
  };
  const money = (key: string, signed = false) => {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1_000_000_000 || (!signed && n < 0) || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001) throw new Error(`Enter a valid ${key} with at most two decimals`);
    return n;
  };
  const names = (key: string) => {
    const a = v[key];
    if (!Array.isArray(a) || a.length > 20 || a.some(s => typeof s !== "string" || s.length > 160)) throw new Error(`Enter valid ${key}`);
    return a.map(s => s.trim()).filter(Boolean);
  };
  const submissionId = text("submissionId", 36, true);
  if (!/^[a-f0-9-]{36}$/i.test(submissionId)) throw new Error("Invalid submission ID");
  if (v.entity !== "dn" && v.entity !== "lmd") throw new Error("Select Send From");
  if (v.priority !== "Normal" && v.priority !== "Urgent") throw new Error("Select a valid priority");
  const currency = text("currency", 3, true);
  if (!topUpCurrencies.includes(currency as typeof topUpCurrencies[number])) throw new Error("Select a currency");
  const paymentMethod = text("paymentMethod", 30);
  if (!["", "Wise", "Bank Transfer", "Card", "Crypto"].includes(paymentMethod)) throw new Error("Select a payment method");
  const wiseLink = text("wiseLink", 1000);
  if (wiseLink) { const url = new URL(wiseLink); if (url.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)?wise\.com$/i.test(url.hostname) || url.username || url.password) throw new Error("Enter an HTTPS Wise link"); }
  const amount = money("amount"); if (amount <= 0) throw new Error("Top-up amount must be greater than zero");
  const expectedThreeDaysSpend = money("expectedThreeDaysSpend");
  if (expectedThreeDaysSpend < topUpMinimumExpectedThreeDaysSpend) throw new Error(`Expected next three days spend must be at least ${topUpMinimumExpectedThreeDaysSpend.toLocaleString("en-US")} USD`);
  return { submissionId, entity: v.entity, priority: v.priority, companyName: text("companyName", 200, true),
    ...(v.providerId ? { providerId: text("providerId", 200, true) } : {}), commission: text("commission", 100, true), team: text("team", 120, true), member: text("member", 120, true),
    amount, currency, openBalance: money("openBalance", true), lastThreeDaysSpend: money("lastThreeDaysSpend"), expectedThreeDaysSpend, paymentMethod, wiseLink, notes: text("notes", 4000), bmNames: names("bmNames"), accountNames: names("accountNames") };
}
export function topUpTransition(status: TopUpStatus, action: "approve" | "adjust" | "paid", draftStatus: string): TopUpStatus {
  if (action === "paid" && status === "approved" && !["creating", "uncertain"].includes(draftStatus)) return "paid";
  if (action === "approve" && status === "pending") return "approved";
  if (action === "adjust" && status === "pending") return "pending";
  throw new Error("This request has changed. Refresh before acting.");
}
export function topUpMessage(r: TopUpRequest, invoiceUrl: string, approver: string): string {
  const money = (n: number, c = r.currency) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c}`;
  if (r.deletedAt) return [`🗑️ Deleted Topup Request #${r.number}`, "", `🏢 Company: ${r.companyName} | 👥 ${r.team} → ${r.member}`, `💰 Amount: ${money(r.amount)}`, `📊 Previous status: ${r.status[0].toUpperCase() + r.status.slice(1)}`, `Deleted by: ${r.deletedBy}`, `📅 ${new Date(r.deletedAt).toLocaleString("en-US", { timeZone: "America/Toronto" })}`, ...(r.draftId ? [`⚠️ Revolut draft ${r.draftId} remains in Revolut. Review it there.`] : []), "Recoverable from Deleted requests in Finance Dash."].join("\n");
  return [`💸 ${r.events?.at(-1)?.action === "restored" ? "Restored Topup Request" : r.status === "pending" ? "New Topup Request" : r.status === "approved" ? "Approved Topup Request" : "Paid Topup Request"} #${r.number}`, "",
    `${r.priority === "Urgent" ? "🔴 URGENT" : "🟢 NORMAL"} | 🏦 ${r.entity === "dn" ? "Digital Nudge OU" : "LoveMeDo BV"}`, "",
    `🏢 Company: ${r.companyName} | 👥 ${r.team} → ${r.member}`, "", `💰 Amount: ${money(r.amount)}`, `💳 Open Balance: ${money(r.openBalance)}`,
    "", `📉 Last 3 days spend: ${money(r.lastThreeDaysSpend, "USD")}`, "", `📈 Expected next 3 days spend: ${money(r.expectedThreeDaysSpend, "USD")}`, "",
    `🏦 Payment: ${r.paymentMethod || "Not specified"}`, `Commission: ${r.commission}`, "", `📎 View Invoice: ${invoiceUrl}`, "",
    `📅 ${new Date(r.createdAt).toLocaleString("en-US", { timeZone: "America/Toronto" })}`, `📊 Status: ${r.status[0].toUpperCase() + r.status.slice(1)}`, approver].join("\n");
}
