import type { MediaSpendRow } from "./mediaSpend";

export const mediaFundingCurrency = "USD" as const;
export const mediaFundingBankCategory = "Ad account funding" as const;

export type MediaFundingAssignmentScope = "business_manager" | "ad_account";
export type MediaFundingEntryType = "adjustment";

export interface MediaFundingProvider {
  id: string;
  companyProviderId: string;
  name: string;
  defaultFeePercent: number;
  currency: string;
  openingBalance: number;
  openingBalanceDate: string;
  grossFunding: number;
  fees: number;
  netFunding: number;
  adjustments: number;
  spend: number;
  estimatedBalance: number;
  assignmentCount: number;
  bankFundingCount: number;
  excludedFundingCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFundingEntry {
  id: string;
  providerId: string;
  type: MediaFundingEntryType;
  date: string;
  netAmount: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFundingBankFunding {
  id: string;
  providerId: string;
  companyProviderId: string;
  source: "wise" | "revolut" | "slash" | "amex";
  accountName: string;
  date: string;
  counterparty: string;
  description: string;
  grossAmount: number;
  feePercent: number;
  feeAmount: number;
  netAmount: number;
  currency: string;
}

export interface MediaFundingAssignment {
  id: string;
  providerId: string;
  scope: MediaFundingAssignmentScope;
  targetKey: string;
  businessManagerKey: string;
  platform: string;
  businessManagerId: string;
  businessManagerName?: string;
  accountId?: string;
  accountName?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFundingSummary {
  providers: number;
  grossFunding: number;
  fees: number;
  netFunding: number;
  spend: number;
  estimatedBalance: number;
}

export interface MediaFundingApiResponse {
  version: 1;
  currency: string;
  coveredThrough?: string;
  providers: MediaFundingProvider[];
  bankFunding: MediaFundingBankFunding[];
  entries: MediaFundingEntry[];
  assignments: MediaFundingAssignment[];
  summary: MediaFundingSummary;
}

export interface CreateMediaFundingProviderPayload {
  companyProviderId: string;
  defaultFeePercent: number;
  openingBalance: number;
  openingBalanceDate: string;
}

export type UpdateMediaFundingProviderPayload = CreateMediaFundingProviderPayload;

export interface CreateMediaFundingEntryPayload {
  providerId: string;
  type: "adjustment";
  date: string;
  adjustmentAmount: number;
  note: string;
}

export interface MediaFundingAssignmentTarget {
  scope: MediaFundingAssignmentScope;
  platform: string;
  businessManagerId: string;
  businessManagerName?: string;
  accountId?: string;
  accountName?: string;
}

export interface AssignMediaFundingTargetsPayload {
  providerId: string;
  effectiveFrom: string;
  targets: MediaFundingAssignmentTarget[];
}

export interface MediaFundingMutationResult {
  rebuildFrom?: string;
  rebuildTo?: string;
}

export function roundMediaFundingMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateMediaFundingCredit(
  grossAmount: number,
  feePercent: number
): { feeAmount: number; netAmount: number } {
  const feeAmount = roundMediaFundingMoney(grossAmount * feePercent / 100);
  return {
    feeAmount,
    netAmount: roundMediaFundingMoney(grossAmount - feeAmount)
  };
}

export function calculateMediaFundingBankTransactionCredit(
  transaction: {
    amount: number;
    category: string;
    currency: string;
    date: string;
    direction: string;
    matchedProviderId?: string;
    status: string;
  },
  provider: {
    companyProviderId: string;
    currency: string;
    defaultFeePercent: number;
    openingBalanceDate: string;
  }
): { status: "included"; feeAmount: number; netAmount: number } | { status: "currency_mismatch" } | null {
  if (
    transaction.amount <= 0
    || transaction.category !== mediaFundingBankCategory
    || transaction.direction !== "out"
    || (transaction.status !== "posted" && transaction.status !== "settled")
    || transaction.matchedProviderId !== provider.companyProviderId
    || transaction.date <= provider.openingBalanceDate
  ) {
    return null;
  }
  if (transaction.currency !== provider.currency) return { status: "currency_mismatch" };
  return { status: "included", ...calculateMediaFundingCredit(transaction.amount, provider.defaultFeePercent) };
}

export function calculateMediaFundingBalance(values: {
  openingBalance: number;
  netFunding: number;
  adjustments: number;
  spend: number;
}): number {
  return roundMediaFundingMoney(
    values.openingBalance + values.netFunding + values.adjustments - values.spend
  );
}

function encodedMediaFundingKey(parts: readonly string[]): string {
  return parts.map(encodeURIComponent).join(":");
}

export function mediaFundingBusinessManagerKey(
  platform: string,
  businessManagerId: string
): string {
  return encodedMediaFundingKey([platform, businessManagerId]);
}

export function mediaFundingAccountKey(platform: string, accountId: string): string {
  return encodedMediaFundingKey([platform, accountId]);
}

export function mediaFundingTargetKey(target: MediaFundingAssignmentTarget): string {
  return target.scope === "business_manager"
    ? `business_manager:${mediaFundingBusinessManagerKey(target.platform, target.businessManagerId)}`
    : `ad_account:${mediaFundingAccountKey(target.platform, target.accountId ?? "")}`;
}

export function mediaFundingAssignmentIsActive(
  assignment: Pick<MediaFundingAssignment, "effectiveFrom" | "effectiveTo">,
  date: string
): boolean {
  return assignment.effectiveFrom <= date && (!assignment.effectiveTo || assignment.effectiveTo >= date);
}

function latestActiveAssignment(
  assignments: readonly MediaFundingAssignment[],
  targetKey: string,
  date: string
): MediaFundingAssignment | undefined {
  return assignments
    .filter((assignment) => assignment.targetKey === targetKey && mediaFundingAssignmentIsActive(assignment, date))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
}

export function resolveMediaFundingAssignment(
  assignments: readonly MediaFundingAssignment[],
  row: Pick<MediaSpendRow, "accountId" | "businessManagerId" | "date" | "platform">
): MediaFundingAssignment | undefined {
  const accountAssignment = latestActiveAssignment(
    assignments,
    `ad_account:${mediaFundingAccountKey(row.platform, row.accountId)}`,
    row.date
  );
  if (accountAssignment) return accountAssignment;
  return latestActiveAssignment(
    assignments,
    `business_manager:${mediaFundingBusinessManagerKey(row.platform, row.businessManagerId)}`,
    row.date
  );
}
