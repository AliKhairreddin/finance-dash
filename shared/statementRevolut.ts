export function revolutOwnerCompany(beneficiaries: readonly string[]): "lovemedo" | "digital-nudge" | undefined {
  const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const names = [...new Set(beneficiaries.filter(Boolean).map(normalize))];
  if (!names.length) return undefined;
  if (names.every(n => ["lovemedo", "lovemedobv"].includes(n))) return "lovemedo";
  if (names.every(n => ["digitalnudge", "digitalnudgeou"].includes(n))) return "digital-nudge";
  return undefined;
}
