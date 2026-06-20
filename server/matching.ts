import type { Provider, Transaction } from "../shared/types";

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function scoreProvider(transaction: Transaction, provider: Provider): { confidence: number; reason: string } {
  const haystack = normalizeName(
    [transaction.rawName, transaction.counterparty, transaction.description].join(" ")
  );
  const aliases = [provider.name, ...provider.aliases].map(normalizeName).filter(Boolean);

  for (const alias of aliases) {
    if (!alias) continue;
    if (haystack === alias) {
      return { confidence: 0.99, reason: `Exact alias: ${alias}` };
    }
    if (haystack.includes(alias)) {
      return { confidence: Math.min(0.95, 0.62 + alias.length / 60), reason: `Contains alias: ${alias}` };
    }
  }

  const providerTokens = new Set(normalizeName(provider.name).split(" ").filter((token) => token.length > 2));
  const txTokens = new Set(haystack.split(" ").filter((token) => token.length > 2));
  const overlap = [...providerTokens].filter((token) => txTokens.has(token));
  if (providerTokens.size > 0 && overlap.length > 0) {
    return {
      confidence: Math.min(0.78, overlap.length / providerTokens.size),
      reason: `Name token overlap: ${overlap.join(", ")}`
    };
  }

  return { confidence: 0, reason: "No alias match" };
}

export function enrichTransactions(transactions: Transaction[], providers: Provider[]): Transaction[] {
  return transactions.map((transaction) => {
    if (transaction.matchedProviderId) {
      return { ...transaction, confidence: transaction.confidence ?? 1, matchReason: transaction.matchReason ?? "Manual match" };
    }

    const ranked = providers
      .map((provider) => ({ provider, ...scoreProvider(transaction, provider) }))
      .filter((candidate) => candidate.confidence >= 0.45)
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];
    if (!best) {
      return { ...transaction, confidence: 0, matchReason: "Needs review" };
    }

    return {
      ...transaction,
      matchedProviderId: best.confidence >= 0.86 ? best.provider.id : undefined,
      confidence: best.confidence,
      matchReason: best.reason
    };
  });
}

export function learnAliases(provider: Provider, bankNames: string[]): Provider {
  const existing = new Set([normalizeName(provider.name), ...provider.aliases.map(normalizeName)]);
  const nextAliases = [...provider.aliases];

  for (const bankName of bankNames) {
    const alias = bankName.trim().replace(/\s+/g, " ");
    const normalized = normalizeName(alias);
    if (!alias || !normalized || existing.has(normalized)) continue;
    existing.add(normalized);
    nextAliases.push(alias);
  }

  return nextAliases.length === provider.aliases.length
    ? provider
    : {
        ...provider,
        aliases: nextAliases
      };
}
