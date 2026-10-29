export type MerchantSuggestion = {
  canonicalName: string;
  website: string;
  category: string;
  address: string;
  addressType: "registered" | "headquarters" | "billing" | "unknown";
  country: string;
  logoSource: string;
  description: string;
  sources: string[];
  confidence: number;
  conflicts: string[];
};
export const merchantKey = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const categoryDescriptions: Record<string, string> = {
  car_insurance: "Vehicle insurance services",
  insurance: "Insurance services",
  domains: "Domain registration and renewal",
  hosting: "Web hosting services",
  advertising: "Digital advertising services",
  software: "Software subscription services",
  accounting: "Accounting and bookkeeping services",
  telecommunications: "Telecommunications services",
};
export function validateMerchantSuggestion(
  raw: unknown,
  sourceUrls: string[],
): MerchantSuggestion {
  if (!raw || typeof raw !== "object")
    throw new Error("Research returned no company profile");
  const value = raw as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const s = value[key];
    if (typeof s !== "string" || s.length > max)
      throw new Error(`Invalid researched ${key}`);
    return s.trim();
  };
  const sources = Array.isArray(value.sources)
    ? value.sources
        .filter(
          (s): s is string => typeof s === "string" && sourceUrls.includes(s),
        )
        .slice(0, 10)
    : [];
  if (!sources.length) throw new Error("Research needs a retrieved source");
  const website = text("website", 1000),
    logoSource = text("logoSource", 1000);
  for (const url of [website, logoSource, ...sources].filter(Boolean))
    if (!/^https:\/\/[^\s]+$/.test(url))
      throw new Error("Research URL must use HTTPS");
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new Error("Invalid confidence");
  const category = text("category", 100);
  return {
    canonicalName: text("canonicalName", 250),
    website,
    category,
    address: text("address", 1000),
    country: text("country", 100),
    logoSource,
    description:
      text("description", 500) || categoryDescriptions[category] || "",
    sources,
    confidence,
    addressType: ["registered", "headquarters", "billing", "unknown"].includes(
      String(value.addressType),
    )
      ? (value.addressType as MerchantSuggestion["addressType"])
      : "unknown",
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts
          .filter((c): c is string => typeof c === "string")
          .slice(0, 10)
          .map((c) => c.slice(0, 500))
      : [],
  };
}
