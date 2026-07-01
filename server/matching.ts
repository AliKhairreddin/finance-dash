import type { Provider, Team, Transaction } from "../shared/types";

export const semanticMatchThreshold = 0.86;
const canonicalCreatedAt = "2026-07-01T00:00:00.000Z";

type ProviderDraft = Omit<Provider, "source" | "createdAt">;

const canonicalProviderDrafts: ProviderDraft[] = [
  {
    id: "provider-ad-account-p2w",
    name: "P2W",
    type: "provider",
    category: "Ad account provider",
    aliases: ["p2w", "point to web", "point2web", "point 2 web"]
  },
  {
    id: "provider-ad-account-rezono",
    name: "Rezono",
    type: "provider",
    category: "Ad account provider",
    aliases: ["rezono", "rezono ads", "rezono account"]
  },
  {
    id: "provider-ad-account-position2",
    name: "Position2",
    type: "provider",
    category: "Ad account provider",
    aliases: ["position2", "position 2", "position two"]
  },
  {
    id: "platform-meta-facebook-ads",
    name: "Meta / Facebook Ads",
    type: "platform",
    category: "Ad platform",
    aliases: ["facebook", "facebook ads", "facebk", "meta ads", "meta platforms", "fb ads", "fb me ads", "facebook direct"]
  },
  {
    id: "platform-tiktok-ads",
    name: "TikTok Ads",
    type: "platform",
    category: "Ad platform",
    aliases: ["tiktok", "tik tok", "tiktok ads", "bytedance", "tt ads"]
  },
  {
    id: "platform-bigo-ads",
    name: "Bigo Ads",
    type: "platform",
    category: "Ad platform",
    aliases: ["bigo", "bigo ads", "bigo live"]
  },
  {
    id: "platform-snapchat-ads",
    name: "Snapchat Ads",
    type: "platform",
    category: "Ad platform",
    aliases: ["snapchat", "snap ads", "snap inc", "snap ads manager"]
  },
  {
    id: "platform-google-youtube-ads",
    name: "Google / YouTube Ads",
    type: "platform",
    category: "Ad platform",
    aliases: ["google ads", "youtube ads", "adwords", "google payment center", "google mojo", "google ads manager"]
  },
  {
    id: "subscription-cursor",
    name: "Cursor",
    type: "provider",
    category: "Subscription",
    aliases: ["cursor", "cursor ai", "anysphere"]
  },
  {
    id: "subscription-namecheap",
    name: "Namecheap",
    type: "provider",
    category: "Subscription",
    aliases: ["namecheap", "name cheap"]
  },
  {
    id: "subscription-cloudflare",
    name: "Cloudflare",
    type: "provider",
    category: "Subscription",
    aliases: ["cloudflare"]
  },
  {
    id: "subscription-openai",
    name: "OpenAI",
    type: "provider",
    category: "Subscription",
    aliases: ["openai", "chatgpt", "chat gpt"]
  },
  {
    id: "subscription-github",
    name: "GitHub",
    type: "provider",
    category: "Subscription",
    aliases: ["github", "git hub"]
  },
  {
    id: "subscription-vercel",
    name: "Vercel",
    type: "provider",
    category: "Subscription",
    aliases: ["vercel"]
  },
  {
    id: "internal-wise-fees",
    name: "Wise Fees",
    type: "internal",
    category: "Bank fees",
    aliases: ["wise fee", "wise fees", "transfer fee"]
  }
];

export const canonicalProviders: Provider[] = canonicalProviderDrafts.map((provider) => ({
  ...provider,
  source: "manual",
  createdAt: canonicalCreatedAt
}));

export const canonicalTeams: Team[] = [
  {
    id: "team-acp",
    name: "ACP",
    createdAt: canonicalCreatedAt
  }
];

const categoryRules: Array<{ category: string; phrases: string[]; direction?: Transaction["direction"] }> = [
  {
    category: "Revenue",
    direction: "in",
    phrases: ["invoice payment", "customer payment", "client payment", "payout", "settlement", "hasoffers", "tune revenue", "affiliate revenue"]
  },
  {
    category: "Refunds and chargebacks",
    phrases: ["refund", "chargeback", "reversal", "returned payment", "dispute"]
  },
  {
    category: "Capital movement",
    phrases: ["capital injection", "shareholder", "owner contribution", "investment", "loan proceeds", "loan repayment"]
  },
  {
    category: "Ad account funding",
    direction: "out",
    phrases: ["top up", "topup", "balance funding", "ad account funding", "account funding", "prepay", "prepaid media"]
  },
  {
    category: "Ad spend",
    direction: "out",
    phrases: ["ads", "advertising", "campaign", "media buying", "ad manager", "business manager"]
  },
  {
    category: "Software subscription",
    direction: "out",
    phrases: ["subscription", "software", "saas", "cursor", "namecheap", "openai", "github", "cloudflare", "vercel", "notion", "slack", "zoom"]
  },
  {
    category: "Cloud and hosting",
    direction: "out",
    phrases: ["aws", "amazon web services", "google cloud", "digitalocean", "netlify", "hosting", "server", "domain", "dns"]
  },
  {
    category: "Food and meals",
    direction: "out",
    phrases: ["restaurant", "cafe", "coffee", "lunch", "dinner", "meal", "deliveroo", "uber eats", "doordash", "talabat", "careem food"]
  },
  {
    category: "Travel",
    direction: "out",
    phrases: ["flight", "airline", "hotel", "airbnb", "booking com", "uber", "lyft", "careem", "taxi", "train", "parking", "fuel", "emirates", "etihad"]
  },
  {
    category: "Salary and payroll",
    direction: "out",
    phrases: ["salary", "payroll", "wages", "deel", "remote com", "gusto", "papaya", "employee payment"]
  },
  {
    category: "Contractors and freelancers",
    direction: "out",
    phrases: ["contractor", "freelancer", "upwork", "fiverr", "consultant", "consulting"]
  },
  {
    category: "Taxes and government",
    direction: "out",
    phrases: ["tax", "vat", "hmrc", "irs", "government", "customs", "ministry"]
  },
  {
    category: "Office and rent",
    direction: "out",
    phrases: ["rent", "office", "coworking", "wework", "workspace"]
  },
  {
    category: "Payment processing",
    phrases: ["stripe", "paypal", "payoneer", "payment processor", "processing fee"]
  },
  {
    category: "Bank fees",
    direction: "out",
    phrases: ["fee", "fees", "charge", "commission", "swift", "wire fee", "transfer fee"]
  },
  {
    category: "Legal and accounting",
    direction: "out",
    phrases: ["legal", "lawyer", "accountant", "accounting", "bookkeeping", "quickbooks", "xero"]
  },
  {
    category: "Recruiting",
    direction: "out",
    phrases: ["recruiting", "recruitment", "linkedin jobs", "indeed", "job post"]
  },
  {
    category: "Education and training",
    direction: "out",
    phrases: ["course", "training", "workshop", "conference", "webinar", "certification"]
  },
  {
    category: "Marketing tools",
    direction: "out",
    phrases: ["semrush", "ahrefs", "hubspot", "mailchimp", "apollo", "outreach", "crm"]
  },
  {
    category: "Telecom and internet",
    direction: "out",
    phrases: ["phone", "mobile", "internet", "telecom", "du telecom", "etisalat"]
  },
  {
    category: "Equipment",
    direction: "out",
    phrases: ["apple", "dell", "lenovo", "hardware", "laptop", "monitor", "equipment"]
  },
  {
    category: "Insurance",
    direction: "out",
    phrases: ["insurance", "policy premium"]
  },
  {
    category: "Utilities",
    direction: "out",
    phrases: ["electric", "electricity", "water bill", "utility", "utilities"]
  },
  {
    category: "Security and compliance",
    direction: "out",
    phrases: ["security", "compliance", "kyc", "soc 2", "password manager", "1password"]
  },
  {
    category: "Shipping and postage",
    direction: "out",
    phrases: ["shipping", "postage", "courier", "dhl", "fedex", "ups"]
  },
  {
    category: "Internal transfer",
    phrases: ["own account", "internal transfer", "balance transfer", "between accounts"]
  }
];

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSignature(value: string): string {
  return normalizeName(value)
    .replace(/\b(?:usd|eur|gbp|aed|cad|aud|sgd|sek|nok|dkk|chf|jpy)\b/g, " ")
    .replace(/\b\d+(?:\s+\d+)*\b/g, " ")
    .replace(/\b(?:card|transaction|payment|transfer|reference|ref|id|invoice|issued|by|from|to|the|a|an)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of values) {
    const alias = value.trim().replace(/\s+/g, " ");
    const normalized = normalizeName(alias);
    if (!alias || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(alias);
  }
  return aliases;
}

function providerNames(provider: Pick<Provider, "name" | "aliases">): string[] {
  return [provider.name, ...provider.aliases].map(normalizeName).filter(Boolean);
}

function providersOverlap(left: Pick<Provider, "name" | "aliases">, right: Pick<Provider, "name" | "aliases">): boolean {
  const leftNames = new Set(providerNames(left));
  return providerNames(right).some((name) => leftNames.has(name));
}

export function mergeProviderDirectory(providers: Provider[]): Provider[] {
  const next = [...providers];

  for (const canonical of canonicalProviders) {
    const existingIndex = next.findIndex((provider) => providersOverlap(provider, canonical));
    if (existingIndex >= 0) {
      const existing = next[existingIndex];
      next[existingIndex] = {
        ...existing,
        name: canonical.name,
        type: canonical.type,
        category: canonical.category,
        aliases: uniqueAliases([...canonical.aliases, ...existing.aliases])
      };
    } else {
      next.push(canonical);
    }
  }

  return next.sort((left, right) => {
    const categoryOrder = providerCategoryOrder(left) - providerCategoryOrder(right);
    return categoryOrder || left.name.localeCompare(right.name);
  });
}

export function mergeTeamDirectory(teams: Team[]): Team[] {
  const next = [...teams];
  for (const canonical of canonicalTeams) {
    if (next.some((team) => normalizeName(team.name) === normalizeName(canonical.name))) continue;
    next.push(canonical);
  }
  return next.sort((left, right) => left.name.localeCompare(right.name));
}

function providerCategoryOrder(provider: Provider): number {
  if (provider.category === "Ad account provider") return 0;
  if (provider.category === "Ad platform") return 1;
  if (provider.category === "Subscription") return 2;
  if (provider.type === "partner") return 3;
  if (provider.type === "internal") return 5;
  return 4;
}

function transactionHaystack(transaction: Transaction): string {
  return normalizeName([transaction.rawName, transaction.counterparty, transaction.description, transaction.category].join(" "));
}

function hasPhrase(haystack: string, phrase: string): boolean {
  const normalized = normalizeName(phrase);
  return Boolean(normalized) && new RegExp(`(^| )${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($| )`).test(haystack);
}

function hardTypedReason(transaction: Transaction, provider: Provider): string | undefined {
  const haystack = transactionHaystack(transaction);
  const providerName = normalizeName(provider.name);

  if (providerName === "p2w" && ["p2w", "point to web", "point2web", "point 2 web"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Ad account provider: P2W";
  }
  if (providerName === "rezono" && ["rezono", "rezono ads"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Ad account provider: Rezono";
  }
  if (providerName === "position2" && ["position2", "position 2", "position two"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Ad account provider: Position2";
  }
  if (
    providerName === "meta facebook ads" &&
    ["facebook", "facebook ads", "facebk", "fb me ads", "fb ads", "meta ads", "meta platforms"].some((phrase) => hasPhrase(haystack, phrase))
  ) {
    return "Ad platform: Meta / Facebook";
  }
  if (
    providerName === "tiktok ads" &&
    ["tiktok", "tik tok", "tiktok ads", "bytedance", "tt ads"].some((phrase) => hasPhrase(haystack, phrase))
  ) {
    return "Ad platform: TikTok";
  }
  if (providerName === "bigo ads" && ["bigo", "bigo ads", "bigo live"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Ad platform: Bigo";
  }
  if (
    providerName === "snapchat ads" &&
    ["snapchat", "snap ads", "snap inc", "snap ads manager"].some((phrase) => hasPhrase(haystack, phrase))
  ) {
    return "Ad platform: Snapchat";
  }
  if (
    providerName === "google youtube ads" &&
    ["youtube ads", "google ads", "adwords", "google payment center", "google mojo", "google ads manager"].some((phrase) =>
      hasPhrase(haystack, phrase)
    )
  ) {
    return "Ad platform: Google / YouTube";
  }
  if (providerName === "cursor" && ["cursor", "cursor ai", "anysphere"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Subscription: Cursor";
  }
  if (providerName === "namecheap" && ["namecheap", "name cheap"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Subscription: Namecheap";
  }
  if (providerName === "cloudflare" && hasPhrase(haystack, "cloudflare")) {
    return "Subscription: Cloudflare";
  }
  if (providerName === "openai" && ["openai", "chatgpt", "chat gpt"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Subscription: OpenAI";
  }
  if (providerName === "github" && ["github", "git hub"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Subscription: GitHub";
  }
  if (providerName === "vercel" && hasPhrase(haystack, "vercel")) {
    return "Subscription: Vercel";
  }
  if (providerName === "wise fees" && ["wise fee", "wise fees", "transfer fee"].some((phrase) => hasPhrase(haystack, phrase))) {
    return "Bank fee: Wise";
  }

  return undefined;
}

function businessCategory(transaction: Transaction): { category: string; reason: string } | undefined {
  const haystack = transactionHaystack(transaction);
  for (const rule of categoryRules) {
    if (rule.direction && rule.direction !== transaction.direction) continue;
    if (rule.phrases.some((phrase) => hasPhrase(haystack, phrase))) {
      return { category: rule.category, reason: `Category rule: ${rule.category}` };
    }
  }
  return undefined;
}

export function scoreProvider(transaction: Transaction, provider: Provider): { confidence: number; reason: string } {
  const hardReason = hardTypedReason(transaction, provider);
  if (hardReason) {
    return { confidence: 0.99, reason: hardReason };
  }

  const haystack = transactionHaystack(transaction);
  const aliases = [provider.name, ...provider.aliases].map(normalizeName).filter(Boolean);
  const txTokens = new Set(haystack.split(" ").filter((token) => token.length > 1));

  for (const alias of aliases) {
    if (!alias) continue;
    if (haystack === alias) {
      return { confidence: 0.99, reason: `Exact alias: ${alias}` };
    }
    if (alias.split(" ").length === 1 && txTokens.has(alias)) {
      return { confidence: Math.min(0.9, 0.7 + alias.length / 80), reason: `Known alias: ${alias}` };
    }
    if (alias.split(" ").length > 1 && haystack.includes(alias)) {
      return { confidence: Math.min(0.95, 0.62 + alias.length / 60), reason: `Contains alias: ${alias}` };
    }
  }

  const providerTokens = new Set(normalizeName(provider.name).split(" ").filter((token) => token.length > 2));
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
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));

  return transactions.map((transaction) => {
    if (transaction.matchedProviderId) {
      const provider = providerById.get(transaction.matchedProviderId);
      return {
        ...transaction,
        category: provider?.category ?? transaction.category,
        confidence: transaction.confidence ?? 1,
        matchReason: transaction.matchReason ?? "Manual match"
      };
    }

    const ranked = providers
      .map((provider) => ({ provider, ...scoreProvider(transaction, provider) }))
      .filter((candidate) => candidate.confidence >= 0.45)
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];
    if (!best) {
      const category = businessCategory(transaction);
      if (category) {
        return { ...transaction, category: category.category, confidence: 0.74, matchReason: category.reason };
      }
      return { ...transaction, confidence: 0, matchReason: "Needs review" };
    }

    const category = businessCategory(transaction);
    return {
      ...transaction,
      matchedProviderId: best.confidence >= semanticMatchThreshold ? best.provider.id : undefined,
      category: best.confidence >= semanticMatchThreshold ? best.provider.category : category?.category ?? transaction.category,
      confidence: best.confidence >= semanticMatchThreshold ? best.confidence : category ? Math.max(0.74, best.confidence) : best.confidence,
      matchReason: best.confidence >= semanticMatchThreshold ? best.reason : category?.reason ?? best.reason
    };
  });
}

export function semanticCategorizeTransaction(transaction: Transaction, providers: Provider[]): Transaction {
  if (transaction.matchedProviderId && (transaction.confidence ?? 0) >= semanticMatchThreshold) {
    const provider = providers.find((item) => item.id === transaction.matchedProviderId);
    return provider ? { ...transaction, category: provider.category } : transaction;
  }

  const enriched = enrichTransactions([transaction], providers)[0];
  return enriched.matchedProviderId || enriched.category !== transaction.category ? enriched : transaction;
}

export function transactionAliasCandidates(transaction: Transaction): string[] {
  const fullSignature = compactSignature([transaction.counterparty, transaction.description].join(" "));
  const rawSignature = compactSignature(transaction.rawName);
  return uniqueAliases([transaction.rawName, transaction.counterparty, transaction.description, fullSignature, rawSignature]).filter(
    (alias) => normalizeName(alias).length >= 3
  );
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
