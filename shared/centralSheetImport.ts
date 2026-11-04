import type { MediaFundingAssignment, MediaFundingBillingType, MediaFundingSourceReference } from "./mediaFunding";

export interface CentralSheetAccount {
  name: string;
  accountId?: string;
  platform?: string;
  billingType?: MediaFundingBillingType;
}
export interface CentralSheetProvider {
  supplierName: string;
  allowCreateSupplier: boolean;
  providerBillingType?: MediaFundingBillingType;
  reference: MediaFundingSourceReference;
  accounts: CentralSheetAccount[];
}
export interface CentralSheetCatalogAccount {
  platform: string;
  accountId: string;
  accountName?: string;
  businessManagerId: string;
  businessManagerName?: string;
}

export function normalizedCentralSheetName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*([-|/])\s*/g, "$1");
}

/** Exact IDs or unique names only; punctuation and account numbering remain significant. */
export function matchCentralSheetAccount(account: CentralSheetAccount, catalog: readonly CentralSheetCatalogAccount[]):
  { status: "matched"; target: CentralSheetCatalogAccount } | { status: "missing" | "ambiguous" } {
  const matches = new Map<string, CentralSheetCatalogAccount>();
  for (const candidate of catalog) {
    if (account.platform && candidate.platform !== account.platform) continue;
    if (account.accountId ? candidate.accountId !== account.accountId
      : !account.name.trim() || normalizedCentralSheetName(candidate.accountName ?? "") !== normalizedCentralSheetName(account.name)) continue;
    matches.set(`${candidate.platform}:${candidate.accountId}`, candidate);
  }
  return matches.size === 1 ? { status: "matched", target: [...matches.values()][0] }
    : { status: matches.size ? "ambiguous" : "missing" };
}

export function centralSheetHistoryConflict(history: readonly MediaFundingAssignment[], providerId: string | undefined, billingType: MediaFundingBillingType | undefined): boolean {
  return history.some(item => item.providerId !== providerId || (billingType !== undefined && item.billingType !== undefined && item.billingType !== billingType));
}
