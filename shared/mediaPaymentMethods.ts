import type { MediaSpendRow } from "./mediaSpend";

export const mediaPaymentMethods = ["needs_review", "provider_funded", "own_card", "meta_credit_line"] as const;
export type MediaPaymentMethod = typeof mediaPaymentMethods[number];
export const mediaPaymentMethodLabels: Record<MediaPaymentMethod, string> = {
  needs_review: "Needs review",
  provider_funded: "Provider funded",
  own_card: "Our card",
  meta_credit_line: "Meta credit line"
};
export interface SetMediaPaymentMethodsPayload {
  targets: { platform: string; accountId: string }[];
  method: MediaPaymentMethod;
  reference?: string;
  effectiveFrom: string;
}
export interface MediaAccountPaymentMethod {
  id: string;
  providerId?: string;
  platform: string;
  accountId: string;
  method: MediaPaymentMethod;
  reference?: string;
  effectiveFrom: string;
  effectiveTo?: string;
}
export interface MediaClassifiedSpend {
  provider_funded: number;
  own_card: number;
  meta_credit_line: number;
}
export function emptyMediaClassifiedSpend(): MediaClassifiedSpend {
  return { provider_funded: 0, own_card: 0, meta_credit_line: 0 };
}
export function resolveMediaPaymentMethod(
  methods: readonly MediaAccountPaymentMethod[],
  row: Pick<MediaSpendRow, "platform" | "accountId" | "date">
): MediaAccountPaymentMethod | undefined {
  return methods.filter((item) => item.platform === row.platform && item.accountId === row.accountId
    && item.effectiveFrom <= row.date && (!item.effectiveTo || item.effectiveTo >= row.date))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}
