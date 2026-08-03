import type { CurrencyTotals, Provider, Transaction } from "./types";

export type SlashMerchantProvider = Pick<Provider, "id" | "name" | "legalName" | "aliases">;

export interface SlashMerchantGroup {
  key: string;
  name: string;
  aliases: string[];
  transactions: Transaction[];
  transactionCount: number;
  accountNames: string[];
  firstDate: string;
  lastDate: string;
  spend: CurrencyTotals;
  credits: CurrencyTotals;
  net: CurrencyTotals;
}

type MerchantIdentity = {
  key: string;
  name: string;
};

type AliasEntry = MerchantIdentity & {
  aliases: string[];
};

const merchantFamilies: ReadonlyArray<{
  key: string;
  name: string;
  pattern: RegExp;
}> = [
  {
    key: "family:meta",
    name: "Meta",
    pattern: /\b(?:meta(?: platforms)?|facebook|facebk|fb ads?|instagram|oculus|whatsapp)\b/
  },
  {
    key: "family:google",
    name: "Google",
    pattern: /\b(?:google|googleads|youtube|alphabet)\b/
  },
  {
    key: "family:microsoft",
    name: "Microsoft",
    pattern: /\b(?:microsoft|msft|azure)\b/
  },
  {
    key: "family:amazon-web-services",
    name: "Amazon Web Services",
    pattern: /\b(?:amazon web services|aws)\b/
  },
  {
    key: "family:amazon",
    name: "Amazon",
    pattern: /\b(?:amazon|amzn)\b/
  },
  {
    key: "family:apple",
    name: "Apple",
    pattern: /\b(?:apple(?: com bill)?)\b/
  },
  {
    key: "family:openai",
    name: "OpenAI",
    pattern: /\b(?:openai|chatgpt)\b/
  },
  {
    key: "family:linkedin",
    name: "LinkedIn",
    pattern: /\blinkedin\b/
  },
  {
    key: "family:adobe",
    name: "Adobe",
    pattern: /\badobe\b/
  },
  {
    key: "family:shopify",
    name: "Shopify",
    pattern: /\bshopify\b/
  },
  {
    key: "family:cloudflare",
    name: "Cloudflare",
    pattern: /\bcloudflare\b/
  }
];

function compactText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeSlashMerchantText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function merchantLabels(transaction: Transaction): string[] {
  const values = [
    transaction.merchantName,
    transaction.counterparty,
    transaction.rawName,
    transaction.description
  ].map(compactText).filter(Boolean);
  return [...new Set(values)];
}

function readableMerchantName(value: string): string {
  const compact = compactText(value) || "Unknown merchant";
  if (compact !== compact.toUpperCase() || !/[A-Z]/.test(compact)) return compact;
  return compact.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function containsAlias(descriptor: string, alias: string): boolean {
  return descriptor === alias
    || descriptor.startsWith(`${alias} `)
    || descriptor.endsWith(` ${alias}`)
    || descriptor.includes(` ${alias} `);
}

function providerAliasDirectory(providers: readonly SlashMerchantProvider[]): AliasEntry[] {
  return providers.flatMap((provider) => {
    const aliases = [provider.name, provider.legalName, ...provider.aliases]
      .map((value) => normalizeSlashMerchantText(value ?? ""))
      .filter((value) => value.length >= 3)
      .sort((left, right) => right.length - left.length);
    return aliases.length === 0
      ? []
      : [{ key: `provider:${provider.id}`, name: provider.name, aliases: [...new Set(aliases)] }];
  }).sort((left, right) => (right.aliases[0]?.length ?? 0) - (left.aliases[0]?.length ?? 0));
}

function merchantIdentity(
  transaction: Transaction,
  providersById: ReadonlyMap<string, SlashMerchantProvider>,
  providerAliases: readonly AliasEntry[]
): MerchantIdentity {
  const labels = merchantLabels(transaction);
  const descriptors = labels.map(normalizeSlashMerchantText).filter(Boolean);
  const descriptorSearch = descriptors.join(" ");
  const family = merchantFamilies.find((candidate) => candidate.pattern.test(descriptorSearch));
  if (family) return { key: family.key, name: family.name };

  const matchedProvider = transaction.matchedProviderId
    ? providersById.get(transaction.matchedProviderId)
    : undefined;
  if (matchedProvider) {
    return { key: `provider:${matchedProvider.id}`, name: matchedProvider.name };
  }

  const aliasedProvider = providerAliases.find((provider) =>
    provider.aliases.some((alias) => descriptors.some((descriptor) => containsAlias(descriptor, alias)))
  );
  if (aliasedProvider) return { key: aliasedProvider.key, name: aliasedProvider.name };

  const preferredLabel = compactText(transaction.merchantName)
    || compactText(transaction.counterparty)
    || compactText(transaction.rawName)
    || compactText(transaction.description)
    || "Unknown merchant";
  const suppliedKey = normalizeSlashMerchantText(transaction.merchantKey ?? "").replace(/\s+/g, "");
  const normalizedKey = suppliedKey || normalizeSlashMerchantText(preferredLabel) || "unknown-merchant";
  return {
    key: `merchant:${normalizedKey.slice(0, 160)}`,
    name: readableMerchantName(preferredLabel).slice(0, 160)
  };
}

function addCurrency(total: CurrencyTotals, currency: string, amount: number): void {
  total[currency] = Math.round(((total[currency] ?? 0) + amount) * 100) / 100;
}

export function groupSlashTransactions(
  transactions: readonly Transaction[],
  providers: readonly SlashMerchantProvider[] = []
): SlashMerchantGroup[] {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const providerAliases = providerAliasDirectory(providers);
  const groups = new Map<string, SlashMerchantGroup>();

  for (const transaction of transactions) {
    if (
      transaction.source !== "slash"
      || (transaction.status !== "posted" && transaction.status !== "settled")
      || !Number.isFinite(transaction.amount)
      || transaction.amount < 0
    ) {
      continue;
    }

    const identity = merchantIdentity(transaction, providersById, providerAliases);
    const label = merchantLabels(transaction)[0] ?? identity.name;
    const existing = groups.get(identity.key);
    const group: SlashMerchantGroup = existing ?? {
      ...identity,
      aliases: [],
      transactions: [],
      transactionCount: 0,
      accountNames: [],
      firstDate: transaction.date,
      lastDate: transaction.date,
      spend: {},
      credits: {},
      net: {}
    };

    if (!group.aliases.some((alias) => normalizeSlashMerchantText(alias) === normalizeSlashMerchantText(label))) {
      group.aliases.push(label);
    }
    if (!group.accountNames.includes(transaction.accountName)) group.accountNames.push(transaction.accountName);
    group.transactions.push(transaction);
    group.transactionCount += 1;
    if (transaction.date < group.firstDate) group.firstDate = transaction.date;
    if (transaction.date > group.lastDate) group.lastDate = transaction.date;
    const currency = transaction.currency.trim().toUpperCase();
    if (transaction.direction === "out") addCurrency(group.spend, currency, transaction.amount);
    else addCurrency(group.credits, currency, transaction.amount);
    addCurrency(group.net, currency, transaction.direction === "in" ? transaction.amount : -transaction.amount);
    groups.set(identity.key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      aliases: group.aliases.sort((left, right) => left.localeCompare(right)),
      accountNames: group.accountNames.sort((left, right) => left.localeCompare(right)),
      transactions: group.transactions.sort((left, right) =>
        left.date.localeCompare(right.date) || left.id.localeCompare(right.id)
      )
    }))
    .sort((left, right) => right.transactionCount - left.transactionCount || left.name.localeCompare(right.name));
}

export function slashGroupAmountTotal(totals: CurrencyTotals): number {
  return Object.values(totals).reduce((sum, amount) => sum + amount, 0);
}
