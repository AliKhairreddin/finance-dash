import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { requireBankConnectionKey } from "../shared/bankConnectionIdentity";
import type {
  ImportWiseStatementPayload,
  ImportWiseStatementSummary,
  WiseEntity,
  WiseStatementImport
} from "../shared/types";
import { verifyWiseStatementAccount } from "../shared/wiseEntities";
import {
  normalizeImportedWiseTransactions,
  parseWiseStatementCsv,
  prepareWiseStatementImport,
  validateWiseStatementImportPayload
} from "../shared/wiseStatements";

config({ path: ".env.local" });
config();

const confirmationPhrase = "IMPORT_WISE_STATEMENTS";
const maximumBatchSize = 200;
const convexUrl = process.env.CONVEX_URL?.trim();
const serviceToken = process.env.CONVEX_SERVICE_TOKEN?.trim();
if (!convexUrl || !serviceToken) {
  throw new Error("CONVEX_URL and CONVEX_SERVICE_TOKEN are required");
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const directories: Array<{ entity: WiseEntity; directory: string }> = [
  { entity: "dn", directory: argument("dn") ?? "" },
  { entity: "lmd", directory: argument("lmd") ?? "" }
];
if (directories.some(({ directory }) => !directory)) {
  throw new Error("Both --dn=/path/to/folder and --lmd=/path/to/folder are required");
}

const connectionKey = await requireBankConnectionKey(process.env, "wise");
const convex = new ConvexHttpClient(convexUrl);
const metadata = await convex.query(api.banking.getActivityMetadata, {
  serviceToken,
  connections: [{ source: "wise", connectionKey }]
});
const state = await convex.query(api.dashboard.getState, { serviceToken });
if (!state) throw new Error("Dashboard state is missing");
let importHistory = state.wiseStatementImports;

async function csvFiles(directory: string): Promise<string[]> {
  const absoluteDirectory = path.resolve(directory);
  if (!(await stat(absoluteDirectory)).isDirectory()) {
    throw new Error(`${absoluteDirectory} is not a directory`);
  }
  return (await readdir(absoluteDirectory))
    .filter((fileName) => fileName.toLowerCase().endsWith(".csv"))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => path.join(absoluteDirectory, fileName));
}

const payloads: ImportWiseStatementPayload[] = [];
for (const { entity, directory } of directories) {
  const files = await csvFiles(directory);
  if (files.length === 0) throw new Error(`${path.resolve(directory)} does not contain CSV files`);
  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const parsedStatements = parseWiseStatementCsv(await readFile(filePath, "utf8"), fileName);
    for (const parsed of parsedStatements) {
      const payload = prepareWiseStatementImport(
        parsed,
        verifyWiseStatementAccount(parsed.metadata, metadata.accounts, entity)
      );
      validateWiseStatementImportPayload(payload, importHistory);
      payloads.push(payload);
    }
  }
}

const preview = {
  mode: "preview",
  files: payloads.length,
  transactions: payloads.reduce((total, payload) => total + payload.transactions.length, 0),
  periods: [...new Set(payloads.map((payload) => `${payload.periodStart}..${payload.periodEnd}`))],
  balances: payloads.map((payload) => ({
    entity: payload.wiseEntity,
    account: payload.accountName,
    balanceId: payload.balanceId,
    currency: payload.currency,
    transactions: payload.transactions.length,
    file: payload.fileName
  }))
};
if (argument("confirm") !== confirmationPhrase) {
  console.log(JSON.stringify({
    ...preview,
    next: `Re-run with --confirm=${confirmationPhrase}`
  }, null, 2));
  process.exit(0);
}

const summaries: Array<ImportWiseStatementSummary & {
  entity: WiseEntity;
  currency: string;
  fileName: string;
}> = [];
for (const payload of payloads) {
  validateWiseStatementImportPayload(payload, importHistory);
  const transactions = normalizeImportedWiseTransactions(payload);
  let inserted = 0;
  let updated = 0;
  const syncedAt = new Date().toISOString();
  for (let index = 0; index < transactions.length; index += maximumBatchSize) {
    const result = await convex.mutation(api.banking.upsertActivityBatch, {
      serviceToken,
      source: "wise",
      connectionKey,
      replaceAccounts: false,
      accounts: [],
      transactions: transactions.slice(index, index + maximumBatchSize).map((transaction) => ({
        ...transaction,
        source: "wise" as const
      })),
      syncedAt
    });
    inserted += result.insertedTransactions;
    updated += result.updatedTransactions;
  }
  const importedAt = new Date().toISOString();
  const importRecord: WiseStatementImport = {
    id: `wise-import-${payload.balanceId}-${payload.currency}-${payload.periodStart}-${payload.periodEnd}`,
    balanceId: payload.balanceId,
    wiseEntity: payload.wiseEntity,
    accountName: payload.accountName,
    currency: payload.currency,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    fileName: payload.fileName,
    transactionCount: transactions.length,
    importedAt
  };
  await convex.mutation(api.dashboard.recordWiseStatementImport, { serviceToken, importRecord });
  importHistory = [importRecord, ...importHistory.filter((item) => item.id !== importRecord.id)];
  summaries.push({
    entity: payload.wiseEntity,
    currency: payload.currency,
    fileName: payload.fileName,
    processedTransactions: transactions.length,
    newTransactions: inserted,
    duplicateTransactions: updated
  });
}

console.log(JSON.stringify({
  mode: "imported",
  statements: summaries,
  totals: summaries.reduce((totals, summary) => ({
    processedTransactions: totals.processedTransactions + summary.processedTransactions,
    newTransactions: totals.newTransactions + summary.newTransactions,
    duplicateTransactions: totals.duplicateTransactions + summary.duplicateTransactions
  }), { processedTransactions: 0, newTransactions: 0, duplicateTransactions: 0 })
}, null, 2));
