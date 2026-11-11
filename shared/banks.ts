import type { DataSource } from "./types";

export type BankSource = Extract<DataSource, "wise" | "revolut" | "slash" | "amex" | "mercury" | "flex">;

export const bankSources: Array<{ id: BankSource; label: string }> = [
  { id: "wise", label: "Wise" },
  { id: "revolut", label: "Revolut" },
  { id: "slash", label: "Slash" },
  { id: "amex", label: "Amex" },
  { id: "mercury", label: "Mercury" },
  { id: "flex", label: "Flex" }
];

const bankSourceIds = new Set<BankSource>(bankSources.map((source) => source.id));

export function isBankSource(source: DataSource): source is BankSource {
  return bankSourceIds.has(source as BankSource);
}

export function bankSourceLabel(source: DataSource): string {
  return bankSources.find((item) => item.id === source)?.label ?? source.charAt(0).toUpperCase() + source.slice(1);
}

export function isBankSourceFilter(value: string): boolean {
  return value === "all" || value.split(",").every(source => bankSourceIds.has(source as BankSource));
}

export function selectedBankSources(value: string): BankSource[] {
  if (!isBankSourceFilter(value)) throw new Error("Transaction source is invalid");
  return value === "all" ? [] : bankSources.filter(source => value.split(",").includes(source.id)).map(source => source.id);
}

export function bankSourceMatches(filter: string, source: DataSource): boolean {
  return filter === "all" || filter.split(",").includes(source);
}
