export const canonicalCreatedAt = "2026-07-01T00:00:00.000Z";

export const cognitiveTeamId = "team-cognitive-pixel";
export const wagnerTeamId = "team-wagner";
export const sanjinTeamId = "team-sanjin";
export const benTeamId = "team-ben";
export const ishanTeamId = "team-ishan";
export const aminTeamId = "team-amin";
export const wagnerTeamName = "Wagner";
export const wagnerTeamAliasIds = ["team-wgnr"];
export const wagnerTeamAliasNames = ["WGNR"];

function normalizedBusinessName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function canonicalTeamId(teamId: string): string {
  return wagnerTeamAliasIds.includes(teamId) ? wagnerTeamId : teamId;
}

export function canonicalTeamName(name: string): string {
  const normalized = normalizedBusinessName(name);
  return normalized === "wgnr" || normalized === "wagner" ? wagnerTeamName : name;
}
