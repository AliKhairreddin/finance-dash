import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { wiseTransactionId } from "../shared/wiseTransactionIdentity";
import {
  applyMatchedInvoiceAssignmentsBatch,
  applyMerchantCategory,
  applyTeamAssignmentsBatch,
  backfillProfitFactsBatch,
  deleteSourceBatch,
  getActivityPage,
  getAnalyticsPeriodRevision,
  getClassificationBacklog,
  getInvoicePaymentCandidates,
  getLedgerRevision,
  getProfitFactsBackfillStatus,
  getProfitFactsPage,
  saveTransactionUpdates,
  upsertActivityBatch
} from "../convex/banking";

type AsyncHandler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;

function handlerOf<TArgs, TResult>(registered: object): AsyncHandler<TArgs, TResult> {
  const candidate: unknown = Reflect.get(registered, "_handler");
  if (typeof candidate !== "function") throw new Error("Convex handler is not registered");
  return async (ctx, args) => candidate(ctx, args);
}

test("bank activity account contract accepts Wise entity labels", () => {
  const exportArgs: unknown = Reflect.get(upsertActivityBatch, "exportArgs");
  if (typeof exportArgs !== "function") throw new Error("Convex argument validator is not registered");
  const validator = JSON.parse(exportArgs()) as {
    value: {
      accounts: {
        fieldType: {
          value: {
            value: Record<string, { optional: boolean }>;
          };
        };
      };
    };
  };

  assert.equal(validator.value.accounts.fieldType.value.value.wiseEntity?.optional, true);
});

function convexErrorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data
    ? String(error.data.code)
    : undefined;
}

async function withServiceToken(run: () => Promise<void>): Promise<void> {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  try {
    await run();
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previousToken;
  }
}

test("classification backlog fairly interleaves bank sources", async () => {
  await withServiceToken(async () => {
    const connectionKey = "a".repeat(64);
    const makeRow = (source: "revolut" | "slash", index: number) => ({
      _id: `${source}-row-${index}`,
      _creationTime: source === "slash" ? index + 1 : 100 + index,
      syncedAt: "2026-08-06T12:00:00.000Z",
      connectionKey,
      profitContributionVersion: 1,
      identityVersion: 2,
      id: `${source}-${index}`,
      source,
      accountName: `${source} account`,
      date: "2026-08-04",
      description: `${source} merchant ${index}`,
      rawName: `${source} merchant ${index}`,
      counterparty: `${source} merchant ${index}`,
      amount: 10,
      currency: "USD",
      direction: "out" as const,
      status: "posted" as const,
      category: "Uncategorized",
      classificationComplete: index === 1 ? false : undefined
    });
    const rowsBySource = {
      revolut: [makeRow("revolut", 0), makeRow("revolut", 1)],
      slash: Array.from({ length: 6 }, (_, index) => makeRow("slash", index))
    };
    const queriedClassificationStates: unknown[] = [];
    const context = {
      db: {
        query(table: string) {
          if (table === "bankConnectionBindings") {
            return {
              take: async () => [
                { source: "slash", connectionKey },
                { source: "revolut", connectionKey }
              ]
            };
          }
          return {
            withIndex(_index: string, applyRange: (builder: { eq(field: string, value: unknown): unknown }) => unknown) {
              let activeSource: "revolut" | "slash" = "revolut";
              let classificationComplete: boolean | undefined;
              const range = {
                eq(field: string, value: unknown) {
                  if (field === "source") activeSource = value as typeof activeSource;
                  if (field === "classificationComplete") {
                    classificationComplete = value as typeof classificationComplete;
                    queriedClassificationStates.push(value);
                  }
                  return range;
                }
              };
              applyRange(range);
              const terminal = {
                filter() {
                  return terminal;
                },
                order() {
                  return terminal;
                },
                async take(limit: number) {
                  return rowsBySource[activeSource]
                    .filter((row) => row.classificationComplete === classificationComplete)
                    .slice(0, limit);
                }
              };
              return terminal;
            }
          };
        }
      }
    };
    const getBacklog = handlerOf<{
      serviceToken: string;
      limit: number;
    }, {
      transactions: Array<{ id: string }>;
      hasMore: boolean;
    }>(getClassificationBacklog);

    const result = await getBacklog(context, {
      serviceToken: "expected-token",
      limit: 4
    });

    assert.deepEqual(result.transactions.map((transaction) => transaction.id), [
      "revolut-0",
      "slash-0",
      "revolut-1",
      "slash-1"
    ]);
    assert.equal(result.hasMore, true);
    assert.equal(queriedClassificationStates.filter((value) => value === undefined).length, 2);
    assert.equal(queriedClassificationStates.filter((value) => value === false).length, 2);
  });
});

type ActivityPageArgs = {
  serviceToken: string;
  source?: "wise" | "revolut" | "slash" | "amex";
  direction?: "in" | "out";
  fromDate: string;
  toDate: string;
  order: "asc" | "desc";
  paginationOpts: {
    cursor: string | null;
    numItems: number;
    maximumRowsRead?: number;
    maximumBytesRead?: number;
  };
};

type QueryTrace = {
  table?: string;
  index?: string;
  constraints: Array<["eq" | "gte" | "lte", string, unknown]>;
  order?: "asc" | "desc";
  paginationOpts?: Record<string, unknown>;
};

function activityQueryContext(trace: QueryTrace) {
  const connectionKey = "a".repeat(64);
  const range = {
    eq(field: string, value: unknown) {
      trace.constraints.push(["eq", field, value]);
      return range;
    },
    gte(field: string, value: unknown) {
      trace.constraints.push(["gte", field, value]);
      return range;
    },
    lte(field: string, value: unknown) {
      trace.constraints.push(["lte", field, value]);
      return range;
    }
  };
  return {
    db: {
      query(table: string) {
        if (table === "bankConnectionBindings") {
          return {
            take: async () => ["wise", "revolut", "slash", "amex"].map((source) => ({
              source,
              connectionKey
            }))
          };
        }
        trace.table = table;
        return {
          withIndex(index: string, applyRange: (builder: typeof range) => unknown) {
            trace.index = index;
            applyRange(range);
            return {
              order(order: "asc" | "desc") {
                trace.order = order;
                const ordered = {
                  filter() {
                    return ordered;
                  },
                  async paginate(paginationOpts: Record<string, unknown>) {
                    trace.paginationOpts = paginationOpts;
                    return {
                      page: [{
                        _id: "row-1",
                        _creationTime: 123,
                        syncedAt: "2026-07-31T12:00:00.000Z",
                        profitContributionVersion: 1,
                        id: "transaction-1",
                        source: "revolut",
                        accountName: "Operating",
                        date: "2026-07-31",
                        description: "Merchant",
                        rawName: "Merchant",
                        counterparty: "Merchant",
                        amount: 12,
                        currency: "USD",
                        direction: "out",
                        status: "posted",
                        category: "Review"
                      }],
                      isDone: false,
                      continueCursor: "next-cursor",
                      splitCursor: null,
                      pageStatus: "SplitRecommended"
                    };
                  }
                };
                return ordered;
              }
            };
          }
        };
      }
    }
  };
}

const getActivityPageHandler = handlerOf<ActivityPageArgs, {
  page: Array<Record<string, unknown>>;
  isDone: boolean;
  continueCursor: string;
}>(getActivityPage);

test("bank activity pages use a stable indexed contract for every filter combination", async () => {
  await withServiceToken(async () => {
    const cases: Array<{
      filters: Pick<ActivityPageArgs, "source" | "direction">;
      index: string;
      constraints: QueryTrace["constraints"];
    }> = [
      {
        filters: {},
        index: "by_date_id",
        constraints: [["gte", "date", "2026-06-01"], ["lte", "date", "2026-06-30"]]
      },
      {
        filters: { direction: "out" },
        index: "by_direction_date_id",
        constraints: [
          ["eq", "direction", "out"],
          ["gte", "date", "2026-06-01"],
          ["lte", "date", "2026-06-30"]
        ]
      },
      {
        filters: { source: "wise" },
        index: "by_source_connection_date_id",
        constraints: [
          ["eq", "source", "wise"],
          ["eq", "connectionKey", "a".repeat(64)],
          ["gte", "date", "2026-06-01"],
          ["lte", "date", "2026-06-30"]
        ]
      },
      {
        filters: { source: "slash", direction: "in" },
        index: "by_source_connection_direction_date_id",
        constraints: [
          ["eq", "source", "slash"],
          ["eq", "connectionKey", "a".repeat(64)],
          ["eq", "direction", "in"],
          ["gte", "date", "2026-06-01"],
          ["lte", "date", "2026-06-30"]
        ]
      }
    ];

    for (const item of cases) {
      const trace: QueryTrace = { constraints: [] };
      const result = await getActivityPageHandler(activityQueryContext(trace), {
        serviceToken: "expected-token",
        ...item.filters,
        fromDate: "2026-06-01",
        toDate: "2026-06-30",
        order: "desc",
        paginationOpts: { cursor: "cursor-1", numItems: 50 }
      });

      assert.equal(trace.table, "bankTransactions");
      assert.equal(trace.index, item.index);
      assert.deepEqual(trace.constraints, item.constraints);
      assert.equal(trace.order, "desc");
      assert.equal(result.page[0]._id, undefined);
      assert.equal(result.page[0]._creationTime, undefined);
      assert.equal(result.page[0].syncedAt, undefined);
      assert.equal(result.page[0].profitContributionVersion, undefined);
      assert.equal(result.page[0].id, "transaction-1");
    }
  });
});

test("bank activity pagination clamps response, row-read, and byte-read budgets", async () => {
  await withServiceToken(async () => {
    const trace: QueryTrace = { constraints: [] };
    await getActivityPageHandler(activityQueryContext(trace), {
      serviceToken: "expected-token",
      source: "amex",
      direction: "out",
      fromDate: "2026-01-01",
      toDate: "2026-07-31",
      order: "asc",
      paginationOpts: {
        cursor: "opaque-cursor",
        numItems: 9_001,
        maximumRowsRead: 10_000,
        maximumBytesRead: 100_000_000
      }
    });

    assert.deepEqual(trace.paginationOpts, {
      cursor: "opaque-cursor",
      numItems: 200,
      maximumRowsRead: 250,
      maximumBytesRead: 4 * 1024 * 1024
    });
  });
});

test("bank activity pagination rejects invalid ranges before querying", async () => {
  await withServiceToken(async () => {
    let queried = false;
    await assert.rejects(
      () => getActivityPageHandler(
        { db: { query: () => { queried = true; throw new Error("unexpected query"); } } },
        {
          serviceToken: "expected-token",
          fromDate: "2026-08-01",
          toDate: "2026-07-31",
          order: "desc",
          paginationOpts: { cursor: null, numItems: 200 }
        }
      ),
      (error) => {
        assert.equal(convexErrorCode(error), "INVALID_DATE_RANGE");
        return true;
      }
    );
    assert.equal(queried, false);
  });
});

type CandidateRow = {
  _id: string;
  _creationTime: number;
  syncedAt: string;
  profitContributionVersion: number;
  identityVersion: number;
  connectionKey: string;
  id: string;
  source: "wise";
  accountId: string;
  accountName: string;
  date: string;
  description: string;
  rawName: string;
  counterparty: string;
  amount: number;
  currency: string;
  direction: "in";
  status: "posted" | "pending" | "settled" | "voided";
  category: string;
};

function candidateRow(id: string, date: string, status: CandidateRow["status"], currency = "USD"): CandidateRow {
  return {
    _id: `row-${id}`,
    _creationTime: 1,
    syncedAt: "2026-07-31T12:00:00.000Z",
    profitContributionVersion: 1,
    identityVersion: 2,
    connectionKey: "a".repeat(64),
    id,
    source: "wise",
    accountId: "wise-1-123",
    accountName: "Operating",
    date,
    description: id,
    rawName: id,
    counterparty: id,
    amount: 10,
    currency,
    direction: "in",
    status,
    category: "Revenue"
  };
}

function invoiceCandidateContext(rows: CandidateRow[]) {
  return {
    db: {
      query: (table: string) => table === "bankConnectionBindings" ? {
        take: async () => [{ source: "wise", connectionKey: "a".repeat(64) }]
      } : ({
        withIndex: (_index: string, applyRange: (builder: unknown) => unknown) => {
          const constraints: Array<["eq" | "lt", string, unknown]> = [];
          const builder = {
            eq(field: string, value: unknown) {
              constraints.push(["eq", field, value]);
              return builder;
            },
            lt(field: string, value: unknown) {
              constraints.push(["lt", field, value]);
              return builder;
            }
          };
          applyRange(builder);
          const terminal = {
            filter() {
              return terminal;
            },
            order: () => ({
              take: async (limit: number) => rows
                .filter((row) => constraints.every(([operator, field, value]) => {
                  const actual = row[field as keyof CandidateRow];
                  return operator === "eq" ? actual === value : String(actual) < String(value);
                }))
                .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
                .slice(0, limit)
            })
          };
          return terminal;
        }
      })
    }
  };
}

test("invoice payment candidates paginate every posted and settled row with stable date/id cursors", async () => {
  await withServiceToken(async () => {
    const handler = handlerOf<{
      serviceToken: string;
      currency: string;
      limit: number;
      cursor: string | null;
    }, {
      transactions: Array<{ id: string; _id?: string; syncedAt?: string }>;
      hasMore: boolean;
      continueCursor: string | null;
    }>(getInvoicePaymentCandidates);
    const ctx = invoiceCandidateContext([
      candidateRow("same-date-z", "2026-07-31", "posted"),
      candidateRow("same-date-a", "2026-07-31", "settled"),
      candidateRow("posted-2", "2026-07-30", "posted"),
      candidateRow("settled-2", "2026-07-29", "settled"),
      candidateRow("posted-1", "2026-07-28", "posted"),
      candidateRow("pending-hidden", "2026-08-01", "pending"),
      candidateRow("other-currency", "2026-08-01", "posted", "EUR")
    ]);

    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await handler(ctx, {
        serviceToken: "expected-token",
        currency: "usd",
        limit: 2,
        cursor
      });
      pages += 1;
      ids.push(...page.transactions.map((transaction) => transaction.id));
      assert.equal(page.transactions.every((transaction) => transaction._id === undefined), true);
      assert.equal(page.transactions.every((transaction) => transaction.syncedAt === undefined), true);
      assert.equal(
        page.transactions.every((transaction) => !("profitContributionVersion" in transaction)),
        true
      );
      assert.equal(page.hasMore, page.continueCursor !== null);
      cursor = page.continueCursor;
    } while (cursor);

    assert.equal(pages, 3);
    assert.deepEqual(ids, ["same-date-z", "same-date-a", "posted-2", "settled-2", "posted-1"]);
    assert.equal(new Set(ids).size, ids.length);
  });
});

test("invoice payment candidate cursors are bound to their currency", async () => {
  await withServiceToken(async () => {
    const handler = handlerOf<Record<string, unknown>, unknown>(getInvoicePaymentCandidates);
    let queried = false;
    await assert.rejects(
      () => handler(
        { db: { query: () => { queried = true; throw new Error("unexpected query"); } } },
        {
          serviceToken: "expected-token",
          currency: "EUR",
          limit: 200,
          cursor: JSON.stringify({ version: 1, currency: "USD", date: "2026-07-31", id: "transaction-1" })
        }
      ),
      (error) => {
        assert.equal(convexErrorCode(error), "INVALID_CURSOR");
        return true;
      }
    );
    assert.equal(queried, false);
  });
});

test("team assignment maintenance rejects more than 200 rows atomically", async () => {
  await withServiceToken(async () => {
    const handler = handlerOf<{
      serviceToken: string;
      assignments: Array<{ transactionId: string; teamId: string }>;
    }, { updated: number }>(applyTeamAssignmentsBatch);
    let queried = false;
    await assert.rejects(
      () => handler(
        { db: { query: () => { queried = true; throw new Error("unexpected query"); } } },
        {
          serviceToken: "expected-token",
          assignments: Array.from({ length: 201 }, (_, index) => ({
            transactionId: `transaction-${index}`,
            teamId: "team-1"
          }))
        }
      ),
      (error) => {
        assert.equal(convexErrorCode(error), "BATCH_TOO_LARGE");
        return true;
      }
    );
    assert.equal(queried, false);
  });
});

function relationshipMutationContext(patches: Array<Record<string, unknown>>) {
  const range = {
    eq() {
      return range;
    }
  };
  return {
    db: {
      query: () => ({
        withIndex: (_index: string, applyRange: (builder: typeof range) => unknown) => {
          applyRange(range);
          return { unique: async () => ({ _id: "row-1" }) };
        }
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      }
    }
  };
}

test("nullable team and invoice assignment commands explicitly clear stored fields", async () => {
  await withServiceToken(async () => {
    const teamHandler = handlerOf<{
      serviceToken: string;
      assignments: Array<{ transactionId: string; teamId: string | null }>;
    }, { updated: number }>(applyTeamAssignmentsBatch);
    const invoiceHandler = handlerOf<{
      serviceToken: string;
      assignments: Array<{ transactionId: string; matchedInvoiceId: string | null }>;
    }, { updated: number }>(applyMatchedInvoiceAssignmentsBatch);
    const patches: Array<Record<string, unknown>> = [];
    const ctx = relationshipMutationContext(patches);

    assert.deepEqual(await teamHandler(ctx, {
      serviceToken: "expected-token",
      assignments: [{ transactionId: "transaction-1", teamId: null }]
    }), { updated: 1 });
    assert.deepEqual(await invoiceHandler(ctx, {
      serviceToken: "expected-token",
      assignments: [{ transactionId: "transaction-1", matchedInvoiceId: null }]
    }), { updated: 1 });

    assert.equal("teamId" in patches[0], true);
    assert.equal(patches[0].teamId, undefined);
    assert.equal("matchedInvoiceId" in patches[1], true);
    assert.equal(patches[1].matchedInvoiceId, undefined);
  });
});

test("matched invoice assignment maintenance rejects more than 200 rows atomically", async () => {
  await withServiceToken(async () => {
    const handler = handlerOf<{
      serviceToken: string;
      assignments: Array<{ transactionId: string; matchedInvoiceId: string | null }>;
    }, { updated: number }>(applyMatchedInvoiceAssignmentsBatch);
    let queried = false;
    await assert.rejects(
      () => handler(
        { db: { query: () => { queried = true; throw new Error("unexpected query"); } } },
        {
          serviceToken: "expected-token",
          assignments: Array.from({ length: 201 }, (_, index) => ({
            transactionId: `transaction-${index}`,
            matchedInvoiceId: null
          }))
        }
      ),
      (error) => {
        assert.equal(convexErrorCode(error), "BATCH_TOO_LARGE");
        return true;
      }
    );
    assert.equal(queried, false);
  });
});

test("merchant category maintenance clamps each cursor page to 200 writes", async () => {
  await withServiceToken(async () => {
    const handler = handlerOf<Record<string, unknown>, {
      updated: number;
      hasMore: boolean;
      continueCursor: string | null;
    }>(applyMerchantCategory);
    const patched: string[] = [];
    let paginationOpts: Record<string, unknown> | undefined;
    const range = {
      eq() {
        return range;
      }
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, applyRange: (builder: typeof range) => unknown) => {
            applyRange(range);
            if (table === "bankLedgerRevision") {
              return { unique: async () => null };
            }
            return {
              paginate: async (options: Record<string, unknown>) => {
                paginationOpts = options;
                return {
                  page: Array.from({ length: 200 }, (_, index) => ({
                    _id: `row-${index}`,
                    date: "2026-07-01"
                  })),
                  isDone: false,
                  continueCursor: "next-cursor"
                };
              }
            };
          }
        }),
        patch: async (id: string) => {
          patched.push(id);
        },
        insert: async () => "revision-row"
      }
    };

    const result = await handler(ctx, {
      serviceToken: "expected-token",
      merchantKey: "merchant",
      merchantName: "Merchant",
      direction: "out",
      category: "Software",
      cursor: "current-cursor",
      limit: 9_001
    });

    assert.deepEqual(paginationOpts, {
      cursor: "current-cursor",
      numItems: 200,
      maximumRowsRead: 200,
      maximumBytesRead: 4 * 1024 * 1024
    });
    assert.equal(patched.length, 200);
    assert.deepEqual(result, { updated: 200, hasMore: true, continueCursor: "next-cursor" });
  });
});

test("source deletion maintenance reads one lookahead row and deletes at most 200", async () => {
  await withServiceToken(async () => {
    const handler = handlerOf<Record<string, unknown>, { deleted: number; hasMore: boolean }>(deleteSourceBatch);
    let takeLimit = 0;
    const deleted: string[] = [];
    const range = {
      eq() {
        return range;
      }
    };
    const ctx = {
      db: {
        query: (table: string) => ({
          withIndex: (_index: string, applyRange: (builder: typeof range) => unknown) => {
            applyRange(range);
            if (table === "bankLedgerRevision") {
              return { unique: async () => null };
            }
            if (table === "bankTransactionAliases") {
              return { take: async () => [] };
            }
            return {
              take: async (limit: number) => {
                takeLimit = limit;
                return Array.from({ length: limit }, (_, index) => ({
                  _id: `row-${index}`,
                  id: `transaction-${index}`,
                  date: "2026-07-01",
                  identityVersion: 2
                }));
              }
            };
          }
        }),
        delete: async (id: string) => {
          deleted.push(id);
        },
        insert: async () => "revision-row"
      }
    };

    const result = await handler(ctx, {
      serviceToken: "expected-token",
      source: "wise",
      limit: 50_000
    });

    assert.equal(takeLimit, 201);
    assert.equal(deleted.length, 200);
    assert.deepEqual(result, { deleted: 200, hasMore: true });
  });
});

type MemoryDocument = Record<string, unknown> & { _id: string; _creationTime: number };
type MemoryConstraint = ["eq" | "gte" | "lte" | "lt", string, unknown];
type MemoryQueryTerminal = {
  order: (direction: "asc" | "desc") => MemoryQueryTerminal;
  take: (limit: number) => Promise<MemoryDocument[]>;
  unique: () => Promise<MemoryDocument | null>;
  paginate: (options: Record<string, unknown>) => Promise<{
    page: MemoryDocument[];
    isDone: boolean;
    continueCursor: string;
    splitCursor: null;
    pageStatus: null;
  }>;
};

function memoryBankingContext(initial: Record<string, MemoryDocument[]>) {
  const tables: Record<string, MemoryDocument[]> = Object.fromEntries(
    Object.entries(initial).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  );
  let generatedId = 0;
  const rowsFor = (table: string) => tables[table] ?? (tables[table] = []);
  const findById = (id: string) => {
    for (const rows of Object.values(tables)) {
      const row = rows.find((candidate) => candidate._id === id);
      if (row) return { row, rows };
    }
    return undefined;
  };

  return {
    tables,
    db: {
      query(table: string) {
        return {
          withIndex(
            index: string,
            applyRange?: (builder: {
              eq: (field: string, value: unknown) => unknown;
              gte: (field: string, value: unknown) => unknown;
              lte: (field: string, value: unknown) => unknown;
              lt: (field: string, value: unknown) => unknown;
            }) => unknown
          ): MemoryQueryTerminal {
            const constraints: MemoryConstraint[] = [];
            const range = {
              eq(field: string, value: unknown) {
                constraints.push(["eq", field, value]);
                return range;
              },
              gte(field: string, value: unknown) {
                constraints.push(["gte", field, value]);
                return range;
              },
              lte(field: string, value: unknown) {
                constraints.push(["lte", field, value]);
                return range;
              },
              lt(field: string, value: unknown) {
                constraints.push(["lt", field, value]);
                return range;
              }
            };
            applyRange?.(range);
            let order: "asc" | "desc" = "asc";
            const matchingRows = () => {
              const matched = rowsFor(table).filter((row) => constraints.every(([operator, field, value]) => {
                const actual = row[field];
                if (operator === "eq") return actual === value;
                if (operator === "gte") return String(actual) >= String(value);
                if (operator === "lte") return String(actual) <= String(value);
                return String(actual) < String(value);
              }));
              if (index === "by_month_currency") {
                matched.sort((left, right) =>
                  String(left.month).localeCompare(String(right.month))
                  || String(left.currency).localeCompare(String(right.currency))
                );
              }
              return order === "desc" ? matched.reverse() : matched;
            };
            const terminal: MemoryQueryTerminal = {
              order(direction) {
                order = direction;
                return terminal;
              },
              async take(limit) {
                return matchingRows().slice(0, limit);
              },
              async unique() {
                const matched = matchingRows();
                if (matched.length > 1) throw new Error(`Expected unique ${table}.${index} result`);
                return matched[0] ?? null;
              },
              async paginate(options) {
                const start = Number(options.cursor ?? 0);
                const limit = Number(options.numItems);
                const matched = matchingRows();
                const page = matched.slice(start, start + limit);
                const next = start + page.length;
                return {
                  page,
                  isDone: next >= matched.length,
                  continueCursor: String(next),
                  splitCursor: null,
                  pageStatus: null
                };
              }
            };
            return terminal;
          }
        };
      },
      async patch(id: string, value: Record<string, unknown>) {
        const found = findById(id);
        if (!found) throw new Error(`Unknown document ${id}`);
        for (const [key, next] of Object.entries(value)) {
          if (next === undefined) delete found.row[key];
          else found.row[key] = next;
        }
      },
      async insert(table: string, value: Record<string, unknown>) {
        generatedId += 1;
        const id = `${table}-generated-${generatedId}`;
        rowsFor(table).push({ _id: id, _creationTime: generatedId, ...value });
        return id;
      },
      async delete(id: string) {
        const found = findById(id);
        if (!found) throw new Error(`Unknown document ${id}`);
        found.rows.splice(found.rows.indexOf(found.row), 1);
      }
    }
  };
}

function bankTransactionValue(
  id: string,
  amount: number,
  currency: string,
  direction: "in" | "out",
  category: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: wiseTransactionId("123", id),
    source: "wise",
    accountId: "wise-1-123",
    accountName: `Wise ${currency}`,
    date: "2026-06-15",
    description: "Operating activity",
    rawName: "Operating activity",
    counterparty: "Operating activity",
    amount,
    currency,
    direction,
    status: "posted",
    category,
    ...overrides
  };
}

function storedTransaction(
  id: string,
  amount: number,
  currency: string,
  direction: "in" | "out",
  category: string,
  overrides: Record<string, unknown> = {}
): MemoryDocument {
  return {
    _id: `stored-${id}`,
    _creationTime: 1,
    syncedAt: "2026-07-31T12:00:00.000Z",
    connectionKey: "a".repeat(64),
    identityVersion: 2,
    ...bankTransactionValue(id, amount, currency, direction, category, overrides)
  };
}

test("profit fact backfill is bounded, resumable, and idempotent", async () => {
  await withServiceToken(async () => {
    const ctx = memoryBankingContext({
      bankTransactions: [
        storedTransaction("revenue", 100_000, "USD", "in", "Revenue"),
        storedTransaction("cost", 20_000, "USD", "out", "Subscription"),
        storedTransaction("salary", 3_000, "EUR", "out", "Salary and payroll", {
          counterparty: "Ben",
          rawName: "Ben",
          description: "Ben"
        })
      ],
      profitDistributionFacts: [],
      bankLedgerRevision: []
    });
    const backfill = handlerOf<Record<string, unknown>, {
      processed: number;
      hasMore: boolean;
      version: number;
    }>(backfillProfitFactsBatch);
    const status = handlerOf<Record<string, unknown>, { version: number; isComplete: boolean }>(
      getProfitFactsBackfillStatus
    );

    assert.deepEqual(await backfill(ctx, { serviceToken: "expected-token", limit: 2 }), {
      processed: 2,
      hasMore: true,
      version: 1
    });
    assert.equal(ctx.tables.bankTransactions.filter((row) => row.profitContributionVersion === 1).length, 2);
    assert.deepEqual(
      ctx.tables.profitDistributionFacts.map(({ month, currency, transactionCount, revenue, generalCosts }) => ({
        month,
        currency,
        transactionCount,
        revenue,
        generalCosts
      })),
      [{ month: "2026-06", currency: "USD", transactionCount: 2, revenue: 100_000, generalCosts: 20_000 }]
    );
    assert.deepEqual(await status(ctx, { serviceToken: "expected-token" }), { version: 1, isComplete: false });

    assert.deepEqual(await backfill(ctx, { serviceToken: "expected-token", limit: 2 }), {
      processed: 1,
      hasMore: false,
      version: 1
    });
    const factsAfterCompletion = JSON.stringify(ctx.tables.profitDistributionFacts);
    assert.deepEqual(await backfill(ctx, { serviceToken: "expected-token", limit: 2 }), {
      processed: 0,
      hasMore: false,
      version: 1
    });
    assert.equal(JSON.stringify(ctx.tables.profitDistributionFacts), factsAfterCompletion);
    assert.deepEqual(await status(ctx, { serviceToken: "expected-token" }), { version: 1, isComplete: true });
    const eurFact = ctx.tables.profitDistributionFacts.find((fact) => fact.currency === "EUR");
    assert.deepEqual(eurFact?.payments, [{ partnerId: "ben", bucket: "salary", amount: 3_000 }]);
    assert.equal(ctx.tables.bankLedgerRevision.length, 0, "internal backfill must not invalidate transaction caches");
  });
});

test("versioned transaction edits update compact facts and bump one ledger revision", async () => {
  await withServiceToken(async () => {
    const existing = storedTransaction("revenue", 100_000, "USD", "in", "Revenue", {
      profitContributionVersion: 1
    });
    const ctx = memoryBankingContext({
      bankTransactions: [existing],
      profitDistributionFacts: [{
        _id: "fact-usd",
        _creationTime: 1,
        key: "2026-06:USD",
        version: 1,
        month: "2026-06",
        currency: "USD",
        transactionCount: 1,
        revenue: 100_000,
        generalCosts: 0,
        payments: [],
        updatedAt: "2026-07-31T12:00:00.000Z"
      }],
      bankLedgerRevision: []
    });
    const save = handlerOf<Record<string, unknown>, { updated: number }>(saveTransactionUpdates);
    const revision = handlerOf<Record<string, unknown>, { revision: number; updatedAt: string | null }>(
      getLedgerRevision
    );
    const periodRevision = handlerOf<
      { serviceToken: string; fromDate: string; toDate: string },
      Array<{ month: string; revision: number }>
    >(getAnalyticsPeriodRevision);
    const replacement = bankTransactionValue("revenue", 100_000, "USD", "in", "Internal transfer");

    assert.deepEqual(await save(ctx, {
      serviceToken: "expected-token",
      transactions: [replacement]
    }), { updated: 1 });
    assert.equal(ctx.tables.profitDistributionFacts[0].revenue, 0);
    assert.equal(ctx.tables.profitDistributionFacts[0].transactionCount, 1);
    assert.equal(ctx.tables.bankTransactions[0].profitContributionVersion, 1);
    assert.equal((await revision(ctx, { serviceToken: "expected-token" })).revision, 1);
    assert.deepEqual(await periodRevision(ctx, {
      serviceToken: "expected-token",
      fromDate: "2026-06-01",
      toDate: "2026-07-31"
    }), [
      { month: "2026-06", revision: 1 },
      { month: "2026-07", revision: 0 }
    ]);

    await save(ctx, { serviceToken: "expected-token", transactions: [replacement] });
    assert.equal((await revision(ctx, { serviceToken: "expected-token" })).revision, 1);
  });
});

test("bank upserts and deletes maintain facts, classification, and ledger revision atomically", async () => {
  await withServiceToken(async () => {
    const ctx = memoryBankingContext({
      bankTransactions: [],
      profitDistributionFacts: [],
      bankLedgerRevision: [],
      bankLedgerCutover: [{
        _id: "cutover-ready",
        _creationTime: 1,
        key: "default",
        status: "ready"
      }],
      bankConnectionBindings: [{
        _id: "binding-wise",
        _creationTime: 1,
        source: "wise",
        connectionKey: "a".repeat(64)
      }],
      bankTransactionAliases: []
    });
    const upsert = handlerOf<Record<string, unknown>, {
      accounts: number;
      transactions: number;
      insertedTransactions: number;
      updatedTransactions: number;
    }>(upsertActivityBatch);
    const removeSource = handlerOf<Record<string, unknown>, { deleted: number; hasMore: boolean }>(deleteSourceBatch);
    const original = bankTransactionValue("revenue", 100_000, "USD", "in", "Revenue", {
      categorySource: "manual",
      categoryConfidence: 1,
      categoryReason: "Reviewed",
      matchedInvoiceId: "invoice-reviewed",
      invoiceMatchSource: "manual",
      teamId: "team-reviewed"
    });

    assert.deepEqual(await upsert(ctx, {
      serviceToken: "expected-token",
      source: "wise",
      connectionKey: "a".repeat(64),
      replaceAccounts: false,
      accounts: [],
      transactions: [original],
      syncedAt: "2026-07-31T12:00:00.000Z"
    }), {
      accounts: 0,
      transactions: 1,
      insertedTransactions: 1,
      updatedTransactions: 0
    });
    assert.equal(ctx.tables.bankTransactions[0].profitContributionVersion, 1);
    assert.equal(ctx.tables.profitDistributionFacts[0].revenue, 100_000);
    assert.equal(ctx.tables.bankLedgerRevision[0].revision, 1);

    const refreshed = bankTransactionValue("revenue", 120_000, "USD", "in", "Internal transfer");
    await upsert(ctx, {
      serviceToken: "expected-token",
      source: "wise",
      connectionKey: "a".repeat(64),
      replaceAccounts: false,
      accounts: [],
      transactions: [refreshed],
      syncedAt: "2026-07-31T13:00:00.000Z"
    });
    assert.equal(ctx.tables.bankTransactions[0].category, "Revenue");
    assert.equal(ctx.tables.bankTransactions[0].categorySource, "manual");
    assert.equal(ctx.tables.bankTransactions[0].categoryReason, "Reviewed");
    assert.equal(ctx.tables.bankTransactions[0].matchedInvoiceId, "invoice-reviewed");
    assert.equal(ctx.tables.bankTransactions[0].invoiceMatchSource, "manual");
    assert.equal(ctx.tables.bankTransactions[0].teamId, "team-reviewed");
    assert.equal(ctx.tables.profitDistributionFacts[0].revenue, 120_000);
    assert.equal(ctx.tables.bankLedgerRevision[0].revision, 2);

    assert.deepEqual(await removeSource(ctx, {
      serviceToken: "expected-token",
      source: "wise",
      limit: 200
    }), { deleted: 1, hasMore: false });
    assert.equal(ctx.tables.bankTransactions.length, 0);
    assert.equal(ctx.tables.profitDistributionFacts.length, 0);
    assert.equal(ctx.tables.bankLedgerRevision[0].revision, 3);
  });
});

test("bank upserts retain pending-to-voided transitions as zero-value tombstones", async () => {
  await withServiceToken(async () => {
    const ctx = memoryBankingContext({
      bankTransactions: [],
      profitDistributionFacts: [],
      bankLedgerRevision: [],
      bankLedgerCutover: [{
        _id: "cutover-ready",
        _creationTime: 1,
        key: "default",
        status: "ready"
      }],
      bankConnectionBindings: [{
        _id: "binding-wise",
        _creationTime: 1,
        source: "wise",
        connectionKey: "a".repeat(64)
      }],
      bankTransactionAliases: []
    });
    const upsert = handlerOf<Record<string, unknown>, {
      accounts: number;
      transactions: number;
      insertedTransactions: number;
      updatedTransactions: number;
    }>(upsertActivityBatch);
    const pending = bankTransactionValue("pending-revenue", 100_000, "USD", "in", "Revenue", {
      status: "pending",
      classificationComplete: false
    });

    await upsert(ctx, {
      serviceToken: "expected-token",
      source: "wise",
      connectionKey: "a".repeat(64),
      replaceAccounts: false,
      accounts: [],
      transactions: [pending],
      syncedAt: "2026-07-31T12:00:00.000Z"
    });
    assert.equal(ctx.tables.profitDistributionFacts.length, 0);

    await upsert(ctx, {
      serviceToken: "expected-token",
      source: "wise",
      connectionKey: "a".repeat(64),
      replaceAccounts: false,
      accounts: [],
      transactions: [{ ...pending, status: "voided", classificationComplete: true }],
      syncedAt: "2026-07-31T13:00:00.000Z"
    });

    assert.equal(ctx.tables.bankTransactions.length, 1);
    assert.equal(ctx.tables.bankTransactions[0].status, "voided");
    assert.equal(ctx.tables.bankTransactions[0].classificationComplete, true);
    assert.equal(ctx.tables.profitDistributionFacts.length, 0);
    assert.equal(ctx.tables.bankLedgerRevision[0].revision, 2);
  });
});

test("profit fact pages expose only the compact public contract", async () => {
  await withServiceToken(async () => {
    const ctx = memoryBankingContext({
      profitDistributionFacts: [{
        _id: "fact-usd",
        _creationTime: 1,
        key: "2026-06:USD",
        version: 1,
        month: "2026-06",
        currency: "USD",
        transactionCount: 4,
        revenue: 100_000,
        generalCosts: 20_000,
        payments: [],
        updatedAt: "2026-07-31T12:00:00.000Z"
      }]
    });
    const getPage = handlerOf<Record<string, unknown>, {
      page: Array<Record<string, unknown>>;
      isDone: boolean;
    }>(getProfitFactsPage);
    const result = await getPage(ctx, {
      serviceToken: "expected-token",
      paginationOpts: { cursor: null, numItems: 50_000 }
    });

    assert.equal(result.page.length, 1);
    assert.equal(result.page[0]._id, undefined);
    assert.equal(result.page[0]._creationTime, undefined);
    assert.equal(result.page[0].key, undefined);
    assert.equal(result.page[0].updatedAt, undefined);
    assert.deepEqual(result.page[0], {
      version: 1,
      month: "2026-06",
      currency: "USD",
      transactionCount: 4,
      revenue: 100_000,
      generalCosts: 20_000,
      payments: []
    });
  });
});
