import type { AccountBalance, MercuryEntity } from "./types";

export const mercuryEntities = [
  { id: "mojo", label: "Mojo Labs LLC", legalName: "Mojo Labs LLC" },
  { id: "coveragebird", label: "CoverageBird", legalName: "CoverageBird LLC" },
  { id: "coveragepro", label: "CoverageBird Pro", legalName: "CoveragePro LLC" }
] as const;
export type MercuryEntityView = "all" | MercuryEntity;
export const mercuryEntityViews: MercuryEntityView[] = ["all", ...mercuryEntities.map(entity => entity.id)];
export const mercuryTokenNames = ["MERCURY_API_TOKEN", "MERCURY_COVERAGEBIRD_API_TOKEN", "MERCURY_COVERAGEPRO_API_TOKEN"] as const;
export function mercuryEntityLabel(entity: MercuryEntity): string {
  return mercuryEntities.find(item => item.id === entity)!.label;
}
export function mercuryEntityFromLegalName(name: string): MercuryEntity {
  const entity = mercuryEntities.find(item => item.legalName.toLowerCase() === name.trim().toLowerCase());
  if (!entity) throw new Error("Mercury account has an unrecognized legal business name");
  return entity.id;
}
export function mercuryConnections(env: Partial<Record<typeof mercuryTokenNames[number], string>>) {
  return mercuryEntities.map((entity, index) => {
    const apiToken = env[mercuryTokenNames[index]]?.trim();
    if (!apiToken) throw new Error(`${mercuryTokenNames[index]} is not configured`);
    return { entity: entity.id, apiToken };
  });
}

export function assertSavedMercuryBalances(accounts: readonly (AccountBalance & { syncedAt: string })[], now = Date.now()): void {
  const mercury = accounts.filter(account => account.source === "mercury");
  if (mercury.some(account => !account.mercuryEntity)) throw new Error("Mercury account ownership has not been verified");
  for (const entity of mercuryEntities) {
    const balances = mercury.filter(account => account.mercuryEntity === entity.id && account.status === "live");
    if (!balances.length) throw new Error(`${entity.label} Mercury balances have not synced yet`);
    if (balances.some(account => !Number.isFinite(Date.parse(account.syncedAt)) || now - Date.parse(account.syncedAt) > 30 * 60_000)) {
      throw new Error(`${entity.label} Mercury balances are stale`);
    }
  }
}
