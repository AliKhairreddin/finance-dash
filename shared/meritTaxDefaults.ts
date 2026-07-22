export interface MeritInvoiceTaxSample {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: string;
  taxIds: string[];
}

export interface MeritTaxDefaultInference {
  defaultMeritTaxId?: string;
  sampledInvoiceCount: number;
  usableInvoiceCount: number;
  supportingInvoiceCount: number;
  status: "inferred" | "ambiguous" | "no-tax-history";
  votes: Record<string, number>;
}

function invoiceTaxVote(sample: MeritInvoiceTaxSample): string | undefined {
  const taxIds = [...new Set(sample.taxIds.map((taxId) => taxId.trim()).filter(Boolean))];
  return taxIds.length === 1 ? taxIds[0] : undefined;
}

export function inferMeritTaxDefault(samples: MeritInvoiceTaxSample[]): MeritTaxDefaultInference {
  const recentSamples = [...samples]
    .sort((left, right) => right.issueDate.localeCompare(left.issueDate) || right.invoiceNumber.localeCompare(left.invoiceNumber))
    .slice(0, 5);
  const votes: Record<string, number> = {};

  for (const sample of recentSamples) {
    const taxId = invoiceTaxVote(sample);
    if (taxId) votes[taxId] = (votes[taxId] ?? 0) + 1;
  }

  const ranked = Object.entries(votes).sort(([leftId, leftCount], [rightId, rightCount]) =>
    rightCount - leftCount || leftId.localeCompare(rightId)
  );
  const usableInvoiceCount = ranked.reduce((total, [, count]) => total + count, 0);
  if (usableInvoiceCount === 0) {
    return {
      sampledInvoiceCount: recentSamples.length,
      usableInvoiceCount,
      supportingInvoiceCount: 0,
      status: "no-tax-history",
      votes
    };
  }

  const [defaultMeritTaxId, supportingInvoiceCount] = ranked[0];
  const hasStrictMajority = supportingInvoiceCount * 2 > usableInvoiceCount;
  if (!hasStrictMajority) {
    return {
      sampledInvoiceCount: recentSamples.length,
      usableInvoiceCount,
      supportingInvoiceCount,
      status: "ambiguous",
      votes
    };
  }

  return {
    defaultMeritTaxId,
    sampledInvoiceCount: recentSamples.length,
    usableInvoiceCount,
    supportingInvoiceCount,
    status: "inferred",
    votes
  };
}
