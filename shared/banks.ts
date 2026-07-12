import type { DataSource } from "./types";

export type BankSource = Extract<DataSource, "wise" | "revolut" | "slash" | "amex">;

export const bankSources: Array<{ id: BankSource; label: string }> = [
  { id: "wise", label: "Wise" },
  { id: "revolut", label: "Revolut" },
  { id: "slash", label: "Slash" },
  { id: "amex", label: "Amex" }
];

const bankSourceIds = new Set<BankSource>(bankSources.map((source) => source.id));

export function isBankSource(source: DataSource): source is BankSource {
  return bankSourceIds.has(source as BankSource);
}

export function bankSourceLabel(source: DataSource): string {
  return bankSources.find((item) => item.id === source)?.label ?? source.charAt(0).toUpperCase() + source.slice(1);
}
