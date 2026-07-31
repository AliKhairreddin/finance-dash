import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { bankConnectionKey } from "../shared/bankConnectionIdentity";
import type { BankTransactionSource } from "../shared/types";

config({ path: ".env.local" });
config();

const convexUrl = process.env.CONVEX_URL?.trim();
const serviceToken = process.env.CONVEX_SERVICE_TOKEN?.trim();
if (!convexUrl || !serviceToken) {
  throw new Error("CONVEX_URL and CONVEX_SERVICE_TOKEN are required");
}

const convex = new ConvexHttpClient(convexUrl);
const maximumIterations = 100_000;
let iterations = 0;

function countIteration(): void {
  iterations += 1;
  if (iterations > maximumIterations) throw new Error("Bank ledger cutover exceeded its iteration limit");
}

let migratedTransactions = 0;
let discardedOrphanedTeamAssignments = 0;
while (true) {
  countIteration();
  let result;
  try {
    result = await convex.mutation(api.dashboard.migrateLegacyLedgerBatch, {
      serviceToken,
      limit: 100
    });
  } catch (error) {
    const code = error instanceof ConvexError
      && typeof error.data === "object"
      && error.data !== null
      && "code" in error.data
      ? String(error.data.code)
      : undefined;
    if (
      code !== "ORPHANED_LEGACY_TEAM_ASSIGNMENT"
      || process.env.BANK_LEDGER_ORPHAN_ASSIGNMENT_DISPOSITION !== "discard-orphaned-team-assignment"
    ) throw error;
    countIteration();
    const disposition = await convex.mutation(api.dashboard.disposeOrphanedLegacyTeamAssignments, {
      serviceToken,
      disposition: "discard-orphaned-team-assignment" as const,
      limit: 100
    });
    if (disposition.disposed === 0) {
      throw new Error("Legacy orphaned team-assignment disposition did not advance");
    }
    discardedOrphanedTeamAssignments += disposition.disposed;
    continue;
  }
  if (result.orphanedTeamAssignments !== 0) {
    throw new Error(`Bank ledger cutover found ${result.orphanedTeamAssignments} unresolved team assignments`);
  }
  migratedTransactions += result.processedTransactions;
  if (result.isDone) break;
}

const sources: BankTransactionSource[] = ["wise", "revolut", "slash", "amex"];
const discoveredConnections = await Promise.all(sources.map(async (source) => {
  const connectionKey = await bankConnectionKey(process.env, source);
  return connectionKey ? { source, connectionKey } : null;
}));
const connections = discoveredConnections.filter((connection): connection is {
  source: BankTransactionSource;
  connectionKey: string;
} => connection !== null);
let rekeyedTransactions = 0;
for (const { source, connectionKey } of connections) {
  let cursor: string | null = null;
  while (true) {
    countIteration();
    const result: {
      processed: number;
      marked: number;
      rekeyed: number;
      isDone: boolean;
      continueCursor: string | null;
    } = await convex.mutation(api.banking.markLegacyBankIdentityBatch, {
      serviceToken,
      source,
      connectionKey,
      cursor,
      limit: 200
    });
    rekeyedTransactions += result.rekeyed;
    if (result.isDone) break;
    if (!result.continueCursor || result.continueCursor === cursor) {
      throw new Error(`${source} identity migration did not advance its cursor`);
    }
    cursor = result.continueCursor;
  }
}

const identityStatus = await convex.query(api.banking.getBankLedgerCutoverStatus, { serviceToken });
const acceptedLegacyIdentities: Array<{
  source: BankTransactionSource;
  count: number;
  earliestDate: string | null;
  latestDate: string | null;
}> = [];
if (identityStatus.unresolvedLegacyIdentitySources.length > 0) {
  if (process.env.BANK_LEDGER_LEGACY_DISPOSITION !== "accept-surrogate-identities") {
    throw new Error(
      `Bank ledger cutover found unresolved historical identities for ${identityStatus.unresolvedLegacyIdentitySources.join(", ")}. `
      + "After taking a verified backup, rerun with BANK_LEDGER_LEGACY_DISPOSITION=accept-surrogate-identities to explicitly retain their injective surrogate IDs."
    );
  }
  for (const source of identityStatus.unresolvedLegacyIdentitySources) {
    const connection = connections.find((item) => item.source === source);
    if (!connection) throw new Error(`${source} has unresolved identities but no configured connection`);
    let count = 0;
    let earliestDate: string | null = null;
    let latestDate: string | null = null;
    while (true) {
      countIteration();
      const result = await convex.mutation(api.banking.acceptLegacyBankIdentityBatch, {
        serviceToken,
        source,
        connectionKey: connection.connectionKey,
        disposition: "accept-surrogate-identities",
        limit: 200
      });
      count += result.accepted;
      if (result.earliestDate && (!earliestDate || result.earliestDate < earliestDate)) {
        earliestDate = result.earliestDate;
      }
      if (result.latestDate && (!latestDate || result.latestDate > latestDate)) {
        latestDate = result.latestDate;
      }
      if (!result.hasMore) break;
      if (result.accepted === 0) throw new Error(`${source} legacy identity disposition did not advance`);
    }
    acceptedLegacyIdentities.push({ source, count, earliestDate, latestDate });
  }
}

let backfilledTransactions = 0;
while (true) {
  countIteration();
  const result = await convex.mutation(api.banking.backfillProfitFactsBatch, {
    serviceToken,
    limit: 200
  });
  backfilledTransactions += result.processed;
  if (!result.hasMore) break;
}

await convex.mutation(api.banking.finalizeBankLedgerCutover, { serviceToken, connections });
const status = await convex.query(api.banking.getBankLedgerCutoverStatus, { serviceToken });
if (!status.ready) throw new Error("Bank ledger cutover did not reach ready state");

console.log(JSON.stringify({
  event: "bank_ledger_cutover_complete",
  migratedTransactions,
  discardedOrphanedTeamAssignments,
  rekeyedTransactions,
  acceptedLegacyIdentities,
  backfilledTransactions,
  identityMigrations: status.completedIdentityMigrations
}));
