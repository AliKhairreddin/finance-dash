import { financeOperatingDate } from "./operatingDate";

export const manualBankSources = [{ id: "kraken", label: "Kraken" }, { id: "trust", label: "Trust" }] as const;
export type ManualBankSource = typeof manualBankSources[number]["id"];
export const manualBankSortKeys = ["date", "companyName", "amount", "currency", "direction", "createdBy"] as const;
export type ManualBankSortKey = typeof manualBankSortKeys[number];
export interface ManualBankFields {
  companyName: string;
  amount: number;
  currency: string;
  direction: "in" | "out";
  date: string;
}
export interface ManualBankTransaction extends ManualBankFields {
  _id: string;
  source: ManualBankSource;
  createdBy: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ManualBankPage {
  page: ManualBankTransaction[];
  continueCursor: string;
  isDone: boolean;
}

export function isManualBankSource(value: unknown): value is ManualBankSource {
  return value === "kraken" || value === "trust";
}

export function validateManualBankFields(input: ManualBankFields): ManualBankFields {
  const companyName = typeof input.companyName === "string" ? input.companyName.trim().replace(/\s+/gu, " ") : "";
  if (!companyName || companyName.length > 200 || /[\u0000-\u001f]/u.test(companyName)) throw new Error("Enter a company name of 1–200 characters.");
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000_000_000) throw new Error("Amount must be greater than zero and no more than 1 trillion.");
  const [coefficient, exponent = "0"] = String(input.amount).split("e");
  if ((coefficient.split(".")[1]?.length ?? 0) - Number(exponent) > 8) throw new Error("Amount supports up to eight decimal places.");
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9]{2,9}$/u.test(currency)) throw new Error("Enter a currency or asset code, such as USD, EUR, BTC, or USDT.");
  if (input.direction !== "in" && input.direction !== "out") throw new Error("Direction must be in or out.");
  if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) throw new Error("Enter a valid transaction date.");
  return { companyName, amount: input.amount, currency, direction: input.direction, date: input.date };
}

export function parseManualBankCommand(args: string, sentAt: number): ManualBankFields {
  const match = args.trim().match(/^(.+?)\s+((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?)$/u);
  if (!match) throw new Error("Use /kraken <company name> <amount> or /trust <company name> <amount>. Example: /kraken Acme Ltd 1250. Payments default to USDC and out; no date is needed.");
  if (!Number.isSafeInteger(sentAt) || sentAt <= 0 || !Number.isFinite(new Date(sentAt * 1000).getTime())) throw new Error("The Telegram message date is missing or invalid. Send a new command.");
  return validateManualBankFields({ companyName: match[1], amount: Number(match[2].replaceAll(",", "")), currency: "USDC", direction: "out", date: financeOperatingDate(sentAt * 1000) });
}
