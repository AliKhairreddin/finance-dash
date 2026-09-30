import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { managementReportParserVersion, type ManagementReportFact, type ManagementReportBankEntry } from "./managementReport";
import type { PreparedManagementWorkbook } from "./managementReportWorkbook";

const batchSize = 75;

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) result.push(values.slice(index, index + batchSize));
  return result;
}

function storedFact(fact: ManagementReportFact) {
  return { ...fact, valueDecimal: String(fact.value) };
}

function storedBankEntry(entry: ManagementReportBankEntry) {
  return {
    entryId: entry.entryId,
    date: entry.date,
    bankName: entry.bankName,
    segment: entry.segment,
    amountUsd: entry.amountUsd,
    amountUsdDecimal: String(entry.amountUsd),
    sourceRow: entry.sourceRow,
    payload: entry
  };
}

export async function storeManagementWorkbook(
  convex: Pick<ConvexHttpClient, "mutation">, importToken: string, args: PreparedManagementWorkbook
): Promise<{ importId: string; alreadyComplete: boolean }> {
  const attemptId = crypto.randomUUID();
  const begun = await convex.mutation(api.managementReport.beginImport, {
    importToken,
    importId: args.importId,
    contentHash: args.hash,
    parserVersion: managementReportParserVersion,
    attemptId,
    sourceName: args.sourceName,
    sourceUrl: args.sourceUrl,
    reportingThrough: args.reportingThrough,
    importedAt: args.importedAt,
    sheetSummaries: args.summaries
  });
  if (begun.alreadyComplete) {
    return begun;
  }

  try {
    while (true) {
      const cleanup = await convex.mutation(api.managementReport.cleanupImportBatch, {
        importToken,
        importId: begun.importId,
        attemptId,
        batchSize: 100
      });
      if (!cleanup.hasMore) break;
    }
    for (const rows of chunks(args.rows)) {
      await convex.mutation(api.managementReport.insertSourceRows, {
        importToken,
        importId: begun.importId,
        attemptId,
        rows
      });
    }
    for (const facts of chunks(args.facts.map(storedFact))) {
      await convex.mutation(api.managementReport.insertFacts, {
        importToken,
        importId: begun.importId,
        attemptId,
        facts
      });
    }
    for (const entries of chunks(args.bankEntries.map(storedBankEntry))) {
      await convex.mutation(api.managementReport.insertBankEntries, {
        importToken,
        importId: begun.importId,
        attemptId,
        entries
      });
    }
    await convex.mutation(api.managementReport.completeImport, {
      importToken,
      importId: begun.importId,
      attemptId,
      sourceRowCount: args.rows.length,
      bankEntryCount: args.bankEntries.length,
      factCount: args.facts.length,
      dashboard: args.dashboard
    });
    return begun;
  } catch (error) {
    await convex.mutation(api.managementReport.failImport, {
      importToken,
      importId: begun.importId,
      attemptId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
