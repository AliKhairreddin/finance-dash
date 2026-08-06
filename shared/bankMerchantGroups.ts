import type { CurrencyTotals, Provider, Transaction } from "./types";

export type BankMerchantProvider = Pick<Provider, "id" | "name" | "legalName" | "aliases">;

export interface BankCardGroup {
  key: string;
  label: string;
  cardLastFour?: string;
  source: Transaction["source"];
  accountName: string;
  transactions: Transaction[];
  transactionCount: number;
  firstDate: string;
  lastDate: string;
  spend: CurrencyTotals;
  credits: CurrencyTotals;
  cashback: CurrencyTotals;
}

export interface BankMerchantGroup {
  key: string;
  name: string;
  aliases: string[];
  transactions: Transaction[];
  transactionCount: number;
  accountNames: string[];
  sources: Transaction["source"][];
  cardGroups: BankCardGroup[];
  firstDate: string;
  lastDate: string;
  spend: CurrencyTotals;
  credits: CurrencyTotals;
  net: CurrencyTotals;
  cashback: CurrencyTotals;
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
    key: "family:tiktok",
    name: "TikTok",
    pattern: /\b(?:tiktok|tik tok|bytedance|byte dance)\b/
  },
  {
    key: "family:newsbreak",
    name: "NewsBreak",
    pattern: /\b(?:newsbreak|news break)\b/
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

export function normalizeBankMerchantText(value: string): string {
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

function providerAliasDirectory(providers: readonly BankMerchantProvider[]): AliasEntry[] {
  return providers.flatMap((provider) => {
    const aliases = [provider.name, provider.legalName, ...provider.aliases]
      .map((value) => normalizeBankMerchantText(value ?? ""))
      .filter((value) => value.length >= 3)
      .sort((left, right) => right.length - left.length);
    return aliases.length === 0
      ? []
      : [{ key: `provider:${provider.id}`, name: provider.name, aliases: [...new Set(aliases)] }];
  }).sort((left, right) => (right.aliases[0]?.length ?? 0) - (left.aliases[0]?.length ?? 0));
}

function merchantFamilyIdentity(descriptors: readonly string[]): MerchantIdentity | undefined {
  const descriptorSearch = descriptors.join(" ");
  const family = merchantFamilies.find((candidate) => candidate.pattern.test(descriptorSearch));
  return family ? { key: family.key, name: family.name } : undefined;
}

function merchantIdentity(
  transaction: Transaction,
  providersById: ReadonlyMap<string, BankMerchantProvider>,
  providerAliases: readonly AliasEntry[]
): MerchantIdentity {
  const labels = merchantLabels(transaction);
  const descriptors = labels.map(normalizeBankMerchantText).filter(Boolean);
  const family = merchantFamilyIdentity(descriptors);
  if (family) return family;

  const matchedProvider = transaction.matchedProviderId
    ? providersById.get(transaction.matchedProviderId)
    : undefined;
  if (matchedProvider) {
    const providerFamily = merchantFamilyIdentity([
      matchedProvider.name,
      matchedProvider.legalName ?? "",
      ...matchedProvider.aliases
    ].map(normalizeBankMerchantText));
    if (providerFamily) return providerFamily;
    return { key: `provider:${matchedProvider.id}`, name: matchedProvider.name };
  }

  const aliasedProvider = providerAliases.find((provider) =>
    provider.aliases.some((alias) => descriptors.some((descriptor) => containsAlias(descriptor, alias)))
  );
  if (aliasedProvider) {
    const providerFamily = merchantFamilyIdentity([
      normalizeBankMerchantText(aliasedProvider.name),
      ...aliasedProvider.aliases
    ]);
    if (providerFamily) return providerFamily;
    return { key: aliasedProvider.key, name: aliasedProvider.name };
  }

  const preferredLabel = compactText(transaction.merchantName)
    || compactText(transaction.counterparty)
    || compactText(transaction.rawName)
    || compactText(transaction.description)
    || "Unknown merchant";
  const suppliedKey = normalizeBankMerchantText(transaction.merchantKey ?? "").replace(/\s+/g, "");
  const normalizedKey = suppliedKey || normalizeBankMerchantText(preferredLabel) || "unknown-merchant";
  return {
    key: `merchant:${normalizedKey.slice(0, 160)}`,
    name: readableMerchantName(preferredLabel).slice(0, 160)
  };
}

function addCurrency(total: CurrencyTotals, currency: string, amount: number): void {
  total[currency] = Math.round(((total[currency] ?? 0) + amount) * 100) / 100;
}

function settledBankTransaction(transaction: Transaction): boolean {
  return (
    (transaction.status === "posted" || transaction.status === "settled")
    && Number.isFinite(transaction.amount)
    && transaction.amount >= 0
  );
}

function normalizedCardLastFour(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

export function transactionCardLastFour(transaction: Transaction): string | undefined {
  const explicit = normalizedCardLastFour(transaction.cardLastFour);
  if (explicit) return explicit;
  const values = [transaction.accountName, transaction.description, transaction.rawName, transaction.counterparty];
  for (const value of values) {
    const masked = value.match(/(?:[xX*\u2022\u00b7]{2,}|ending(?:\s+in)?|last\s*4|card)\s*[:#-]?\s*(\d{4})\b/i);
    if (masked?.[1]) return masked[1];
    const branded = value.match(/\b(?:visa|mastercard|master\s*card|amex|american\s+express)\b[^0-9]{0,18}(\d{4})\b/i);
    if (branded?.[1]) return branded[1];
  }
  return undefined;
}

export function groupBankTransactionsByCard(transactions: readonly Transaction[]): BankCardGroup[] {
  const groups = new Map<string, BankCardGroup>();
  for (const transaction of transactions) {
    if (!settledBankTransaction(transaction)) continue;
    const cardLastFour = transactionCardLastFour(transaction);
    const accountIdentity = transaction.accountId?.trim() || transaction.accountName;
    const key = `${transaction.source}:${accountIdentity}:${cardLastFour ?? "account"}`;
    const existing = groups.get(key);
    const group: BankCardGroup = existing ?? {
      key,
      label: cardLastFour ? `Card ending ${cardLastFour}` : transaction.accountName,
      ...(cardLastFour ? { cardLastFour } : {}),
      source: transaction.source,
      accountName: transaction.accountName,
      transactions: [],
      transactionCount: 0,
      firstDate: transaction.date,
      lastDate: transaction.date,
      spend: {},
      credits: {},
      cashback: {}
    };
    group.transactions.push(transaction);
    group.transactionCount += 1;
    if (transaction.date < group.firstDate) group.firstDate = transaction.date;
    if (transaction.date > group.lastDate) group.lastDate = transaction.date;
    const currency = transaction.currency.trim().toUpperCase();
    if (transaction.direction === "out") addCurrency(group.spend, currency, transaction.amount);
    else addCurrency(group.credits, currency, transaction.amount);
    if (transaction.cashback && transaction.cashback.amount > 0) {
      addCurrency(group.cashback, currency, transaction.cashback.amount);
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      transactions: group.transactions.sort((left, right) =>
        left.date.localeCompare(right.date) || left.id.localeCompare(right.id)
      )
    }))
    .sort((left, right) => right.transactionCount - left.transactionCount || left.label.localeCompare(right.label));
}

export function groupBankTransactions(
  transactions: readonly Transaction[],
  providers: readonly BankMerchantProvider[] = []
): BankMerchantGroup[] {
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const providerAliases = providerAliasDirectory(providers);
  const groups = new Map<string, BankMerchantGroup>();

  for (const transaction of transactions) {
    if (!settledBankTransaction(transaction)) continue;

    const identity = merchantIdentity(transaction, providersById, providerAliases);
    const label = merchantLabels(transaction)[0] ?? identity.name;
    const existing = groups.get(identity.key);
    const group: BankMerchantGroup = existing ?? {
      ...identity,
      aliases: [],
      transactions: [],
      transactionCount: 0,
      accountNames: [],
      sources: [],
      cardGroups: [],
      firstDate: transaction.date,
      lastDate: transaction.date,
      spend: {},
      credits: {},
      net: {},
      cashback: {}
    };

    if (!group.aliases.some((alias) => normalizeBankMerchantText(alias) === normalizeBankMerchantText(label))) {
      group.aliases.push(label);
    }
    if (!group.accountNames.includes(transaction.accountName)) group.accountNames.push(transaction.accountName);
    if (!group.sources.includes(transaction.source)) group.sources.push(transaction.source);
    group.transactions.push(transaction);
    group.transactionCount += 1;
    if (transaction.date < group.firstDate) group.firstDate = transaction.date;
    if (transaction.date > group.lastDate) group.lastDate = transaction.date;
    const currency = transaction.currency.trim().toUpperCase();
    if (transaction.direction === "out") addCurrency(group.spend, currency, transaction.amount);
    else addCurrency(group.credits, currency, transaction.amount);
    addCurrency(group.net, currency, transaction.direction === "in" ? transaction.amount : -transaction.amount);
    if (transaction.cashback && transaction.cashback.amount > 0) {
      addCurrency(group.cashback, currency, transaction.cashback.amount);
    }
    groups.set(identity.key, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      aliases: group.aliases.sort((left, right) => left.localeCompare(right)),
      accountNames: group.accountNames.sort((left, right) => left.localeCompare(right)),
      sources: group.sources.sort((left, right) => left.localeCompare(right)),
      transactions: group.transactions.sort((left, right) =>
        left.date.localeCompare(right.date) || left.id.localeCompare(right.id)
      ),
      cardGroups: groupBankTransactionsByCard(group.transactions)
    }))
    .sort((left, right) => right.transactionCount - left.transactionCount || left.name.localeCompare(right.name));
}

export function bankGroupAmountTotal(totals: CurrencyTotals): number {
  return Object.values(totals).reduce((sum, amount) => sum + amount, 0);
}

export function bankCardCashbackRate(group: Pick<BankCardGroup, "cashback" | "spend">): number {
  const spend = bankGroupAmountTotal(group.spend);
  return spend > 0 ? bankGroupAmountTotal(group.cashback) / spend : 0;
}

const socialMediaGroupKeys = new Set([
  "family:meta",
  "family:tiktok",
  "family:newsbreak"
]);

export function isSocialMediaGroup(group: Pick<BankMerchantGroup, "key" | "name">): boolean {
  if (socialMediaGroupKeys.has(group.key)) return true;
  const normalizedName = normalizeBankMerchantText(group.name).replace(/\s+/g, "");
  return normalizedName === "meta" || normalizedName === "tiktok" || normalizedName === "newsbreak";
}
