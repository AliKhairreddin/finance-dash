import { mediaFundingAccountKey, mediaFundingAssignmentIsActive, mediaFundingTargetKey, resolveMediaFundingAssignment, type MediaFundingAssignment, type MediaFundingAssignmentTarget } from "./mediaFunding";
import type { MediaSpendRow } from "./mediaSpend";

const genericWords = new Set(["account", "accounts", "ad", "ads", "auto", "home", "health", "meta", "facebook", "usd", "est", "test", "campaign"]);

// Keep the complete name structure; only numbering, casing and separators vary.
export function mediaFundingNamePattern(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const pattern = name.normalize("NFKC").toLowerCase().replace(/\d+/g, " # ").replace(/[^a-z#]+/g, " ").trim().replace(/\s+/g, " ");
  const words = pattern.split(" ");
  if (words.filter((word) => word !== "#" && !genericWords.has(word)).join("").length < 3) return undefined;
  return pattern;
}

export type AutomaticFundingAssignment = {
  providerId: string;
  pattern: string;
  target: MediaFundingAssignmentTarget;
  effectiveFrom: string;
  effectiveTo?: string;
  extendAssignmentId?: string;
};

export function inferMediaFundingAssignments(
  rows: readonly MediaSpendRow[],
  assignments: readonly MediaFundingAssignment[],
  date: string,
  exclusions: readonly { targetKey: string; effectiveFrom: string; effectiveTo?: string }[] = []
): AutomaticFundingAssignment[] {
  const manual = assignments.filter((assignment) => !assignment.autoPattern);
  const evidence = new Map<string, Map<string, Set<string>>>();
  function learn(platform: string, name: string | undefined, accountId: string, providerId: string): void {
    const pattern = mediaFundingNamePattern(name);
    if (!pattern) return;
    const key = `${platform}:${pattern}`;
    const providers = evidence.get(key) ?? new Map<string, Set<string>>();
    const accounts = providers.get(providerId) ?? new Set<string>();
    accounts.add(accountId);
    providers.set(providerId, accounts);
    evidence.set(key, providers);
  }
  for (const assignment of manual) {
    if (assignment.scope === "ad_account" && assignment.accountId) {
      learn(assignment.platform, assignment.accountName, assignment.accountId, assignment.providerId);
    }
  }
  // Current names also provide evidence for renamed accounts and manually assigned BMs.
  for (const row of rows) {
    const assignment = resolveMediaFundingAssignment(manual, row);
    if (assignment) learn(row.platform, row.accountName, row.accountId, assignment.providerId);
  }
  const candidates = new Map<string, MediaSpendRow[]>();
  for (const row of rows) {
    const key = mediaFundingAccountKey(row.platform, row.accountId);
    const group = candidates.get(key) ?? [];
    group.push(row);
    candidates.set(key, group);
  }
  const result: AutomaticFundingAssignment[] = [];
  for (const accountRows of candidates.values()) {
    if (accountRows.some((row) => resolveMediaFundingAssignment(assignments, row))) continue;
    const patterns = new Set(accountRows.map((row) => mediaFundingNamePattern(row.accountName)));
    if (patterns.size !== 1 || patterns.has(undefined)) continue;
    const row = accountRows[0];
    const pattern = [...patterns][0]!;
    const providers = evidence.get(`${row.platform}:${pattern}`);
    if (!providers || providers.size !== 1) continue;
    const [providerId, examples] = [...providers][0];
    // Repeated days/workspaces of one account are not independent examples.
    if ([...examples].filter((id) => id !== row.accountId).length < 2) continue;
    const target: MediaFundingAssignmentTarget = {
      scope: "ad_account", platform: row.platform, businessManagerId: row.businessManagerId,
      ...(row.businessManagerName ? { businessManagerName: row.businessManagerName } : {}),
      accountId: row.accountId, ...(row.accountName ? { accountName: row.accountName } : {})
    };
    const targetKey = mediaFundingTargetKey(target);
    if (exclusions.some((item) => mediaFundingAssignmentIsActive(item, date) && (item.targetKey === targetKey
      || accountRows.some((r) => item.targetKey === mediaFundingTargetKey({ scope: "business_manager", platform: r.platform, businessManagerId: r.businessManagerId }))))) continue;
    const relevant = assignments.filter((assignment) => assignment.targetKey === targetKey
      || (assignment.scope === "business_manager" && accountRows.some((r) => r.platform === assignment.platform && r.businessManagerId === assignment.businessManagerId)));
    // A real provider transfer is not a naming inference. Preserve its dated boundaries.
    if (relevant.some((assignment) => !assignment.autoPattern && assignment.providerId !== providerId)) continue;
    if (relevant.some((assignment) => mediaFundingAssignmentIsActive(assignment, date))) continue;
    const next = relevant.filter((assignment) => assignment.effectiveFrom > date)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    if (next?.autoPattern === pattern && next.providerId === providerId && next.targetKey === targetKey) {
      result.push({ providerId, pattern, target, effectiveFrom: date, extendAssignmentId: next.id });
    } else {
      const effectiveTo = next ? new Date(Date.parse(`${next.effectiveFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : undefined;
      result.push({ providerId, pattern, target, effectiveFrom: date, ...(effectiveTo ? { effectiveTo } : {}) });
    }
  }
  return result;
}
