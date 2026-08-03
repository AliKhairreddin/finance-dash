import {
  createBankAnalyticsAccumulator,
  type BankAnalyticsAccumulatorOptions,
  type BankAnalyticsAccumulatorState
} from "./analytics";
import type { BankAnalyticsSnapshot, Transaction } from "./types";

export const bankAnalyticsJobPageBudget = 10;
export const bankAnalyticsJobPageSize = 200;
export const bankAnalyticsSnapshotByteLimit = 250_000;

export interface BankAnalyticsJobIdentity {
  version: string;
  initialState: BankAnalyticsAccumulatorState;
}

export interface BankAnalyticsMonthRevision {
  month: string;
  revision: number;
}

export interface BankAnalyticsBuildPage {
  transactions: Transaction[];
  continueCursor: string | null;
  isDone: boolean;
}

export type BankAnalyticsBuildResult =
  | {
      status: "building";
      cursor: string;
      accumulator: BankAnalyticsAccumulatorState;
      pagesProcessed: number;
    }
  | {
      status: "complete";
      snapshot: BankAnalyticsSnapshot;
      pagesProcessed: number;
    };

type BankAnalyticsDirectoryOptions = Omit<BankAnalyticsAccumulatorOptions, "state">;

function assertLedgerRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Analytics ledger revision must be a non-negative integer");
  }
  return value;
}

function analyticsMonths(fromDate: string, toDate: string): string[] {
  const months: string[] = [];
  let cursor = new Date(`${fromDate.slice(0, 7)}-01T00:00:00.000Z`);
  const finalMonth = toDate.slice(0, 7);
  while (true) {
    const month = cursor.toISOString().slice(0, 7);
    months.push(month);
    if (month === finalMonth) return months;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    if (months.length > 24) throw new Error("Analytics period exceeds 24 months");
  }
}

function monthRevisionFingerprint(
  revisions: readonly BankAnalyticsMonthRevision[],
  options: BankAnalyticsDirectoryOptions
): string {
  const expectedMonths = analyticsMonths(options.fromDate, options.toDate);
  if (
    revisions.length !== expectedMonths.length
    || revisions.some(({ month }, index) => month !== expectedMonths[index])
  ) {
    throw new Error("Analytics month revisions do not match the requested period");
  }
  return revisions
    .map(({ month, revision }) => `${month}:${assertLedgerRevision(revision)}`)
    .join(",");
}

export function assertBankAnalyticsSnapshotSize(value: unknown): void {
  let bytes: number;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new Error("Analytics snapshot must be JSON serializable");
  }
  if (bytes > bankAnalyticsSnapshotByteLimit) {
    throw new Error(`Analytics snapshot exceeds ${bankAnalyticsSnapshotByteLimit} bytes`);
  }
}

export function createBankAnalyticsJobIdentity(
  monthRevisions: readonly BankAnalyticsMonthRevision[],
  options: BankAnalyticsDirectoryOptions
): BankAnalyticsJobIdentity {
  const initialState = createBankAnalyticsAccumulator(options).serialize();
  return {
    version: `bank-analytics-v4:${monthRevisionFingerprint(monthRevisions, options)}:${initialState.configurationFingerprint}`,
    initialState
  };
}

export async function buildBankAnalyticsPageBudget(
  options: BankAnalyticsDirectoryOptions & {
    state: BankAnalyticsAccumulatorState;
    cursor: string | null;
    readPage: (cursor: string | null) => Promise<BankAnalyticsBuildPage>;
  }
): Promise<BankAnalyticsBuildResult> {
  const accumulator = createBankAnalyticsAccumulator(options);
  let cursor = options.cursor;
  const seenCursors = new Set(cursor ? [cursor] : []);

  for (let pagesProcessed = 1; pagesProcessed <= bankAnalyticsJobPageBudget; pagesProcessed += 1) {
    const page = await options.readPage(cursor);
    accumulator.addPage(page.transactions);
    if (page.isDone) {
      if (page.continueCursor !== null) {
        throw new Error("A completed Analytics page cannot include a continuation cursor");
      }
      return {
        status: "complete",
        snapshot: accumulator.finish(),
        pagesProcessed
      };
    }
    if (!page.continueCursor) {
      throw new Error("An incomplete Analytics page must include a continuation cursor");
    }
    if (seenCursors.has(page.continueCursor)) {
      throw new Error("Analytics pagination returned a repeated cursor");
    }
    seenCursors.add(page.continueCursor);
    cursor = page.continueCursor;
  }

  if (!cursor) throw new Error("Analytics pagination did not make forward progress");
  return {
    status: "building",
    cursor,
    accumulator: accumulator.serialize(),
    pagesProcessed: bankAnalyticsJobPageBudget
  };
}
