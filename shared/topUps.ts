export const topUpCurrencies = ["USD", "EUR", "GBP", "AED", "LBP"] as const;
export const topUpPaymentMethods = ["Revolut", "Bank Transfer", "Card", "Crypto"] as const;
export const cryptoRequestCurrencies = ["USDC", "USDT", "BTC"] as const;
export const isCryptoTopUp = (currency: string) => /^[A-Z][A-Z0-9]{1,11}$/.test(currency) && !topUpCurrencies.some(c => c === currency);
export const topUpAmountDecimals = (currency: string) => currency === "USDC" || currency === "USDT" ? 6 : isCryptoTopUp(currency) ? 8 : 2;
export function validateTopUpAmount(amount: unknown, currency: string): number {
  const decimals = topUpAmountDecimals(currency);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > 1e9 || amount !== Number(amount.toFixed(decimals))) throw new Error(`Enter a positive amount with at most ${decimals} decimals`);
  return amount;
}
export const formatTopUpAmount = (amount: number, currency: string) => `${amount.toLocaleString("en-US", { maximumFractionDigits: topUpAmountDecimals(currency) })} ${currency}`;
export const topUpMinimumExpectedThreeDaysSpend = 1000;
export type TopUpStatus = "pending" | "approved" | "paid";
export interface TopUpInput {
  submissionId: string; entity?: "dn" | "lmd"; priority: "Normal" | "Urgent";
  companyName: string; providerId?: string; commission?: string; team: string; member: string;
  amount: number; currency: string; openBalance?: number; lastThreeDaysSpend?: number; expectedThreeDaysSpend?: number;
  walletAddress?: string; network?: string;
  paymentMethod: string; wiseLink: string; notes: string; bmNames: string[]; accountNames: string[];
}
export interface TopUpRequest extends TopUpInput {
  _id: string; number: number; documentId?: string; fileName?: string; contentType?: string;
  status: TopUpStatus; version: number; createdAt: string; updatedAt: string;
  originalAmount: number; approvedBy?: string; paidBy?: string; deletedAt?: string; deletedBy?: string;
  events: { at: string; actor: string; action: string; amount: number }[];
  notificationError?: string; draftStatus: string; draftError?: string; draftWarning?: string; draftId?: string;
  paymentDetails?: TopUpPaymentDetails;
}
export interface TopUpPaymentDetails { payerEntity: "dn" | "lmd" | ""; beneficiary: string; iban: string; bic: string; bankCountry?: string; accountNumber?: string; routingNumber?: string; reference: string; amount: number | null; currency: string; notes: string }
export function validateTopUpInput(value: unknown): TopUpInput {
  if (!value || typeof value !== "object") throw new Error("Complete the request details");
  const v = value as Record<string, unknown>;
  const labels: Record<string, string> = { companyName: "company or recipient", member: "requester name", walletAddress: "wallet address", network: "network", expectedThreeDaysSpend: "expected next three days spend", lastThreeDaysSpend: "last three days spend", openBalance: "open balance", submissionId: "submission ID", wiseLink: "Wise link" };
  const text = (key: string, max: number, required = false) => {
    if (typeof v[key] !== "string" || (v[key] as string).length > max || (required && !(v[key] as string).trim())) throw new Error(`Enter a valid ${labels[key] ?? key}`);
    return (v[key] as string).trim();
  };
  const money = (key: string, signed = false) => {
    const n = v[key];
    if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1_000_000_000 || (!signed && n < 0) || Math.abs(n * 100 - Math.round(n * 100)) > 0.0001) throw new Error(`Enter a valid ${labels[key] ?? key} with at most two decimals`);
    return n;
  };
  const names = (key: string) => {
    const a = v[key];
    if (!Array.isArray(a) || a.length > 20 || a.some(s => typeof s !== "string" || s.length > 160)) throw new Error(`Enter valid ${key}`);
    return a.map(s => s.trim()).filter(Boolean);
  };
  const submissionId = text("submissionId", 36, true);
  if (!/^[a-f0-9-]{36}$/i.test(submissionId)) throw new Error("Invalid submission ID");
  if (v.priority !== "Normal" && v.priority !== "Urgent") throw new Error("Select a valid priority");
  const currency = text("currency", 12, true);
  const crypto = isCryptoTopUp(currency);
  if (!crypto && !topUpCurrencies.some(c => c === currency)) throw new Error("Select a currency");
  if (!crypto && v.entity !== "dn" && v.entity !== "lmd") throw new Error("Select Send From");
  const paymentMethod = text("paymentMethod", 30);
  if (paymentMethod !== "" && !topUpPaymentMethods.some(method => method === paymentMethod)) throw new Error("Select a payment method: Revolut, Bank Transfer, Card or Crypto");
  const wiseLink = text("wiseLink", 1000);
  if (wiseLink) { const url = new URL(wiseLink); if (url.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)?wise\.com$/i.test(url.hostname) || url.username || url.password) throw new Error("Enter an HTTPS Wise link"); }
  const amount = validateTopUpAmount(v.amount, currency);
  let scenario: Pick<TopUpInput, "entity" | "commission" | "openBalance" | "lastThreeDaysSpend" | "expectedThreeDaysSpend" | "walletAddress" | "network">;
  if (crypto) {
    if (paymentMethod !== "Crypto") throw new Error("Select Crypto as the payment method for a crypto request");
    const walletAddress = text("walletAddress", 200, true), network = text("network", 80);
    if (/\s/.test(walletAddress)) throw new Error("Wallet address must not contain spaces");
    scenario = { walletAddress, network };
  } else {
    const expectedThreeDaysSpend = money("expectedThreeDaysSpend");
    if (expectedThreeDaysSpend < topUpMinimumExpectedThreeDaysSpend) throw new Error(`Expected next three days spend must be at least ${topUpMinimumExpectedThreeDaysSpend.toLocaleString("en-US")} USD`);
    scenario = { entity: v.entity as "dn" | "lmd", commission: text("commission", 100, true), openBalance: money("openBalance", true), lastThreeDaysSpend: money("lastThreeDaysSpend"), expectedThreeDaysSpend };
  }
  return { submissionId, priority: v.priority, companyName: text("companyName", 200, true),
    ...(!crypto && v.providerId ? { providerId: text("providerId", 200, true) } : {}), ...scenario, team: text("team", 120, true), member: text("member", 120, true),
    amount, currency, paymentMethod, wiseLink, notes: text("notes", 4000), bmNames: names("bmNames"), accountNames: names("accountNames") };
}
export function topUpTransition(status: TopUpStatus, action: "approve" | "adjust" | "paid", draftStatus: string): TopUpStatus {
  if (action === "paid" && status === "approved" && !["creating", "uncertain"].includes(draftStatus)) return "paid";
  if (action === "approve" && status === "pending") return "approved";
  if (action === "adjust" && status === "pending") return "pending";
  throw new Error("This request has changed. Refresh before acting.");
}
export function topUpMessage(r: TopUpRequest, invoiceUrl: string, approver: string): string {
  const money = (n: number, c = r.currency) => formatTopUpAmount(n, c);
  if (isCryptoTopUp(r.currency)) return [`🛒 ${r.events?.at(-1)?.action === "restored" ? "Restored" : r.status === "pending" ? "New" : r.status === "approved" ? "Approved" : "Paid"} Purchase Request #${r.number}`, "",
    `${r.priority === "Urgent" ? "🔴 URGENT" : "🟢 NORMAL"}`, "",
    `🏢 Recipient: ${r.companyName}`, `👥 ${r.team} → ${r.member}`, "", `💰 Amount: ${money(r.amount)}`, ...(r.network ? [`🌐 Network: ${r.network}`] : []), `👛 Wallet: ${r.walletAddress}`, "",
    ...(r.documentId ? [`📎 View Invoice: ${invoiceUrl}`, ""] : []), ...(r.notes ? [`📝 Notes: ${r.notes}`, ""] : []),
    `📅 ${new Date(r.createdAt).toLocaleString("en-US", { timeZone: "America/Toronto" })}`, `📊 Status: ${r.status[0].toUpperCase() + r.status.slice(1)}`, approver].join("\n");
  return [`💸 ${r.events?.at(-1)?.action === "restored" ? "Restored Topup Request" : r.status === "pending" ? "New Topup Request" : r.status === "approved" ? "Approved Topup Request" : "Paid Topup Request"} #${r.number}`, "",
    `${r.priority === "Urgent" ? "🔴 URGENT" : "🟢 NORMAL"} | 🏦 ${r.entity === "dn" ? "Digital Nudge OU" : "LoveMeDo BV"}`, "",
    `🏢 Company: ${r.companyName} | 👥 ${r.team} → ${r.member}`, "", `💰 Amount: ${money(r.amount)}`, `💳 Open Balance: ${r.openBalance === undefined ? "—" : money(r.openBalance)}`,
    "", `📉 Last 3 days spend: ${r.lastThreeDaysSpend === undefined ? "—" : money(r.lastThreeDaysSpend, "USD")}`, "", `📈 Expected next 3 days spend: ${r.expectedThreeDaysSpend === undefined ? "—" : money(r.expectedThreeDaysSpend, "USD")}`, "",
    `🏦 Payment: ${r.paymentMethod || "Not specified"}`, `Commission: ${r.commission}`, "", `📎 View Invoice: ${invoiceUrl}`, "",
    `📅 ${new Date(r.createdAt).toLocaleString("en-US", { timeZone: "America/Toronto" })}`, `📊 Status: ${r.status[0].toUpperCase() + r.status.slice(1)}`, approver].join("\n");
}
