import type {
  AccountBalance,
  Transaction,
  WiseEntity,
  WiseStatementImport
} from "./types";

export type WiseEntityView = "all" | WiseEntity;

export const wiseEntityViews: WiseEntityView[] = ["all", "dn", "lmd"];
export const maximumWiseStatementImportHistory = 200;

export const wiseEntities: Array<{
  id: WiseEntity;
  label: string;
  shortLabel: string;
}> = [
  { id: "dn", label: "Digital Nudge", shortLabel: "DN" },
  { id: "lmd", label: "Love Me Do", shortLabel: "LMD" }
];

const wiseEntityLabels: Record<WiseEntity, string> = {
  dn: "Digital Nudge",
  lmd: "Love Me Do"
};

const wiseEntityShortLabels: Record<WiseEntity, string> = {
  dn: "DN",
  lmd: "LMD"
};

function normalizedWiseName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function wiseEntityFromAccountName(accountName: string): WiseEntity | undefined {
  const normalized = normalizedWiseName(accountName);
  if (normalized.includes("digital nudge")) return "dn";
  if (normalized.includes("love me do") || normalized.includes("lovemedo")) return "lmd";
  return undefined;
}

export function requireWiseEntityFromAccountName(accountName: string): WiseEntity {
  const entity = wiseEntityFromAccountName(accountName);
  if (!entity) {
    throw new Error(`Wise account "${accountName}" is not recognized as Digital Nudge or Love Me Do`);
  }
  return entity;
}

export function wiseEntityLabel(entity: WiseEntity): string {
  return wiseEntityLabels[entity];
}

export function wiseEntityShortLabel(entity: WiseEntity): string {
  return wiseEntityShortLabels[entity];
}

function accountBalanceId(accountId: string): string | undefined {
  return accountId.match(/^wise-\d+-(\d+)$/)?.[1];
}

export interface VerifiedWiseStatementAccount {
  accountId: string;
  accountName: string;
  wiseEntity: WiseEntity;
}

export interface WiseStatementAccountCoverage {
  accountName?: string;
  balanceId: string;
  currency: string;
  wiseEntity: WiseEntity;
  periodStart?: string;
  periodEnd?: string;
  importedAt?: string;
}

export function wiseStatementAccountCoverage(
  accounts: readonly AccountBalance[],
  imports: readonly WiseStatementImport[],
  expectedEntity: WiseEntityView
): WiseStatementAccountCoverage[] {
  const coverageSources = new Map<string, {
    account?: AccountBalance;
    imports: WiseStatementImport[];
  }>();
  for (const account of accounts) {
    if (account.source !== "wise" || !account.wiseEntity) continue;
    const balanceId = accountBalanceId(account.id);
    if (!balanceId) continue;
    coverageSources.set(balanceId, { account, imports: [] });
  }
  for (const statementImport of imports) {
    if (!statementImport.wiseEntity) continue;
    const source = coverageSources.get(statementImport.balanceId);
    if (source) source.imports.push(statementImport);
    else coverageSources.set(statementImport.balanceId, { imports: [statementImport] });
  }

  return [...coverageSources.entries()]
    .flatMap(([balanceId, source]): WiseStatementAccountCoverage[] => {
      const latestImport = source.imports.reduce<WiseStatementImport | undefined>(
        (latest, statementImport) => !latest || statementImport.importedAt > latest.importedAt
          ? statementImport
          : latest,
        undefined
      );
      const wiseEntity = source.account?.wiseEntity ?? latestImport?.wiseEntity;
      if (!wiseEntity || (expectedEntity !== "all" && wiseEntity !== expectedEntity)) return [];
      const currency = source.account?.currency ?? latestImport?.currency;
      if (!currency) return [];
      const accountName = source.account?.name ?? latestImport?.accountName;
      const periodStart = source.imports.reduce<string | undefined>(
        (earliest, statementImport) => !earliest || statementImport.periodStart < earliest
          ? statementImport.periodStart
          : earliest,
        undefined
      );
      const periodEnd = source.imports.reduce<string | undefined>(
        (latest, statementImport) => !latest || statementImport.periodEnd > latest
          ? statementImport.periodEnd
          : latest,
        undefined
      );

      return [{
        balanceId,
        currency,
        wiseEntity,
        ...(accountName ? { accountName } : {}),
        ...(periodStart ? { periodStart } : {}),
        ...(periodEnd ? { periodEnd } : {}),
        ...(latestImport ? { importedAt: latestImport.importedAt } : {})
      }];
    })
    .sort((left, right) => {
      const entityOrder = wiseEntityViews.indexOf(left.wiseEntity) - wiseEntityViews.indexOf(right.wiseEntity);
      return entityOrder
        || left.currency.localeCompare(right.currency)
        || (left.accountName ?? "").localeCompare(right.accountName ?? "");
    });
}

export function verifyWiseStatementAccount(
  metadata: {
    balanceId: string;
    currency: string;
    fileName: string;
  },
  accounts: readonly AccountBalance[],
  expectedEntity: WiseEntityView
): VerifiedWiseStatementAccount {
  const matches = accounts.filter(
    (account) => account.source === "wise" && accountBalanceId(account.id) === metadata.balanceId
  );
  if (matches.length === 0) {
    throw new Error(
      `${metadata.fileName} cannot be verified. Keep the original Wise filename so balance ${metadata.balanceId} can be matched to a live Wise account.`
    );
  }
  if (matches.length > 1) {
    throw new Error(`${metadata.fileName} matches more than one live Wise balance`);
  }

  const account = matches[0];
  if (!account.wiseEntity) {
    throw new Error(`${metadata.fileName} matched a Wise balance without entity metadata`);
  }
  const wiseEntity = account.wiseEntity;
  if (expectedEntity !== "all" && wiseEntity !== expectedEntity) {
    throw new Error(
      `${metadata.fileName} belongs to ${wiseEntityShortLabel(wiseEntity)}, not ${wiseEntityShortLabel(expectedEntity)}`
    );
  }
  if (account.currency.toUpperCase() !== metadata.currency.toUpperCase()) {
    throw new Error(
      `${metadata.fileName} is ${metadata.currency}, but Wise balance ${metadata.balanceId} is ${account.currency}`
    );
  }

  return { accountId: account.id, accountName: account.name, wiseEntity };
}

export function migrateLegacyWiseTransactions(transactions: readonly Transaction[]): Transaction[] {
  return transactions.map((transaction) => {
    if (transaction.source !== "wise" || transaction.wiseEntity) return transaction;
    return {
      ...transaction,
      wiseEntity: wiseEntityFromAccountName(transaction.accountName) ?? "dn"
    };
  });
}

export function migrateLegacyWiseStatementImports(
  imports: readonly WiseStatementImport[]
): WiseStatementImport[] {
  return imports
    .map((statementImport) => {
      if (statementImport.wiseEntity) return statementImport;
      return {
        ...statementImport,
        wiseEntity: statementImport.accountName
          ? wiseEntityFromAccountName(statementImport.accountName) ?? "dn"
          : "dn"
      };
    })
    .sort((left, right) => right.importedAt.localeCompare(left.importedAt))
    .slice(0, maximumWiseStatementImportHistory);
}
