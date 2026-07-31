import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import {
  finalizeBankLedgerCutover,
  getBankLedgerCutoverStatus
} from "../convex/banking";

type AsyncHandler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;
type BankSource = "wise" | "revolut" | "slash" | "amex";
type Connection = { source: BankSource; connectionKey: string };
type StoredRow = Record<string, unknown> & { _id: string };

function handlerOf<TArgs, TResult>(registered: object): AsyncHandler<TArgs, TResult> {
  const candidate: unknown = Reflect.get(registered, "_handler");
  if (typeof candidate !== "function") throw new Error("Convex handler is not registered");
  return async (ctx, args) => candidate(ctx, args);
}

function convexErrorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data
    ? String(error.data.code)
    : undefined;
}

function cutoverContext(seed: Partial<Record<string, StoredRow[]>> = {}) {
  const tables = new Map<string, StoredRow[]>(
    Object.entries(seed).map(([table, rows]) => [table, (rows ?? []).map((row) => ({ ...row }))])
  );
  let nextId = 1;
  const rowsFor = (table: string): StoredRow[] => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: StoredRow[] = [];
    tables.set(table, created);
    return created;
  };
  const db = {
    query(table: string) {
      const constraints: Array<{ operator: "eq" | "lt" | "gt"; field: string; value: unknown }> = [];
      const range = {
        eq(field: string, value: unknown) {
          constraints.push({ operator: "eq", field, value });
          return range;
        },
        lt(field: string, value: unknown) {
          constraints.push({ operator: "lt", field, value });
          return range;
        },
        gt(field: string, value: unknown) {
          constraints.push({ operator: "gt", field, value });
          return range;
        }
      };
      const selected = () => rowsFor(table).filter((row) => constraints.every(({ operator, field, value }) => {
        if (operator === "eq") return row[field] === value;
        if (typeof row[field] !== "string" || typeof value !== "string") return false;
        return operator === "lt" ? row[field] < value : row[field] > value;
      }));
      const query = {
        withIndex(_index: string, applyRange: (builder: typeof range) => unknown) {
          applyRange(range);
          return query;
        },
        async take(limit: number) {
          return selected().slice(0, limit);
        },
        async first() {
          return selected()[0] ?? null;
        },
        async unique() {
          const matches = selected();
          if (matches.length > 1) throw new Error(`Expected unique ${table} row`);
          return matches[0] ?? null;
        }
      };
      return query;
    },
    async delete(id: string) {
      for (const rows of tables.values()) {
        const index = rows.findIndex((row) => row._id === id);
        if (index >= 0) rows.splice(index, 1);
      }
    },
    async patch(id: string, value: Record<string, unknown>) {
      for (const rows of tables.values()) {
        const row = rows.find((item) => item._id === id);
        if (row) Object.assign(row, value);
      }
    },
    async insert(table: string, value: Record<string, unknown>) {
      const id = `${table}-${nextId++}`;
      rowsFor(table).push({ _id: id, ...value });
      return id;
    }
  };
  return { context: { db }, tables };
}

const finalizeHandler = handlerOf<{
  serviceToken: string;
  connections: Connection[];
}, { ready: boolean }>(finalizeBankLedgerCutover);
const statusHandler = handlerOf<{
  serviceToken: string;
}, {
  prerequisitesReady: boolean;
  ready: boolean;
  unresolvedLegacyIdentitySources: BankSource[];
}>(getBankLedgerCutoverStatus);

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

test("bank ledger cutover allows providers that are truly empty and unconfigured", async () => {
  await withServiceToken(async () => {
    const { context } = cutoverContext();
    const result = await finalizeHandler(context, {
      serviceToken: "expected-token",
      connections: []
    });
    assert.equal(result.ready, true);
    const status = await statusHandler(context, { serviceToken: "expected-token" });
    assert.deepEqual(status, {
      legacyFieldsPresent: false,
      legacyTransactions: 0,
      legacyTeamAssignments: 0,
      unversionedTransactions: 0,
      unversionedIdentities: 0,
      unscopedTransactionAccounts: 0,
      unresolvedLegacyIdentitySources: [],
      completedIdentityMigrations: 0,
      prerequisitesReady: true,
      ready: true
    });
  });
});

test("bank ledger cutover rejects stored provider data without a binding", async () => {
  await withServiceToken(async () => {
    const { context } = cutoverContext({
      bankTransactions: [{
        _id: "transaction-1",
        source: "wise",
        connectionKey: "a".repeat(64),
        accountId: "wise-account-1",
        identityVersion: 2,
        profitContributionVersion: 1
      }]
    });
    await assert.rejects(
      () => finalizeHandler(context, { serviceToken: "expected-token", connections: [] }),
      (error) => {
        assert.equal(convexErrorCode(error), "BANK_LEDGER_CUTOVER_INCOMPLETE");
        return true;
      }
    );
  });
});

test("bank ledger cutover requires the supplied directory to match persisted bindings", async () => {
  await withServiceToken(async () => {
    const { context } = cutoverContext({
      bankConnectionBindings: [{
        _id: "binding-1",
        source: "wise",
        connectionKey: "a".repeat(64)
      }],
      bankIdentityMigrations: [{ _id: "migration-1", source: "wise", version: 2 }]
    });
    await assert.rejects(
      () => finalizeHandler(context, {
        serviceToken: "expected-token",
        connections: [{ source: "wise", connectionKey: "b".repeat(64) }]
      }),
      (error) => {
        assert.equal(convexErrorCode(error), "BANK_CONNECTION_DIRECTORY_MISMATCH");
        return true;
      }
    );
  });
});

test("bank ledger cutover accepts one exact bound provider and leaves empty providers unbound", async () => {
  await withServiceToken(async () => {
    const connectionKey = "a".repeat(64);
    const { context } = cutoverContext({
      bankTransactions: [{
        _id: "transaction-1",
        source: "wise",
        connectionKey,
        accountId: "wise-account-1",
        identityVersion: 2,
        profitContributionVersion: 1
      }],
      bankAccounts: [{ _id: "account-1", source: "wise", connectionKey }],
      bankConnectionBindings: [{ _id: "binding-1", source: "wise", connectionKey }],
      bankIdentityMigrations: [{ _id: "migration-1", source: "wise", version: 2 }]
    });
    const result = await finalizeHandler(context, {
      serviceToken: "expected-token",
      connections: [{ source: "wise", connectionKey }]
    });
    assert.equal(result.ready, true);
    const status = await statusHandler(context, { serviceToken: "expected-token" });
    assert.equal(status.prerequisitesReady, true);
    assert.equal(status.ready, true);
  });
});

test("bank ledger cutover refuses to hide unresolved surrogate identities", async () => {
  await withServiceToken(async () => {
    const connectionKey = "a".repeat(64);
    const { context } = cutoverContext({
      bankTransactions: [{
        _id: "transaction-1",
        source: "wise",
        connectionKey,
        accountId: "wise-account-1",
        identityVersion: 1,
        profitContributionVersion: 1
      }],
      bankConnectionBindings: [{ _id: "binding-1", source: "wise", connectionKey }],
      bankIdentityMigrations: [{ _id: "migration-1", source: "wise", version: 2 }]
    });
    const status = await statusHandler(context, { serviceToken: "expected-token" });
    assert.deepEqual(status.unresolvedLegacyIdentitySources, ["wise"]);
    assert.equal(status.prerequisitesReady, false);
    await assert.rejects(
      () => finalizeHandler(context, {
        serviceToken: "expected-token",
        connections: [{ source: "wise", connectionKey }]
      }),
      (error) => {
        assert.equal(convexErrorCode(error), "BANK_LEDGER_CUTOVER_INCOMPLETE");
        return true;
      }
    );
  });
});
