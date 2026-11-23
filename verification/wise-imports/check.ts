import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { AccountBalance } from "../../shared/types";
import { verifyWiseStatementAccount } from "../../shared/wiseEntities";
import {
  normalizeImportedWiseTransactions,
  parseWiseStatementCsv,
  prepareWiseStatementImport,
  validateWiseStatementImportPayload,
} from "../../shared/wiseStatements";

const url = process.env.TEST_CONVEX_URL ?? "";
assert.equal(new URL(url).hostname, "127.0.0.1");
const serviceToken = process.env.TEST_SERVICE_TOKEN!;
const client = new ConvexHttpClient(url);
const account = {
  id: "wise-1-101", name: "Digital Nudge test balance", source: "wise", wiseEntity: "dn",
  balance: 0, currency: "USD", updatedAt: "2026-01-01T00:00:00Z", status: "live",
} as const satisfies AccountBalance;
const exports = ["debit at 09:00", "debit at 16:00", "refund"] as const;
type Export = typeof exports[number];

async function submit(day: string, event: Export, accounts: AccountBalance[]) {
  const localTime = event === "debit at 16:00" ? "16:00" : "09:00";
  const amount = event === "refund" ? "12.34" : "-12.34";
  const type = event === "refund" ? "CREDIT" : "DEBIT";
  const [parsed] = parseWiseStatementCsv([
    "TransferWise ID,Date,Date Time,Amount,Currency,Description,Transaction Type,Transaction Details Type",
    `TRANSFER-TEST-${day},${day}-01-2026,${day}-01-2026 ${localTime},${amount},USD,Fixture transfer,${type},TRANSFER`,
  ].join("\n"), "statement_101_USD_2026-01-01_2026-01-31.csv");
  const payload = prepareWiseStatementImport(parsed, verifyWiseStatementAccount(parsed.metadata, accounts, "dn"));
  validateWiseStatementImportPayload(payload, []);
  return new ConvexHttpClient(url).mutation(api.banking.upsertActivityBatch, {
    serviceToken, connectionKey: "a".repeat(64), source: "wise", accounts: [], replaceAccounts: false,
    syncedAt: "2026-02-01T00:00:00Z",
    transactions: normalizeImportedWiseTransactions(payload).map(row => ({ ...row, source: "wise" as const })),
  });
}

async function checkLedger(day: string, events: readonly Export[]) {
  const date = `2026-01-${day}`;
  const result = await client.query(api.banking.getActivityPage, {
    serviceToken, source: "wise", fromDate: date, toDate: date, order: "asc",
    paginationOpts: { cursor: null, numItems: 20 },
  });
  const expected = new Set(events.map(event => event === "refund" ? "in 12.34 USD" : "out 12.34 USD"));
  const rows = result.page.map(row => `${row.direction} ${row.amount} ${row.currency}`).sort();
  assert.equal(result.isDone, true);
  assert.deepEqual(rows, [...expected].sort(), `Wise ledger after ${events.join(", ")}: ${JSON.stringify(rows)}`);
}

await client.mutation(api.banking.finalizeBankLedgerCutover, { serviceToken, connections: [] });
const connection = { connectionKey: "a".repeat(64), source: "wise" as const };
const { wiseEntity: _entity, ...unlabeled } = account;
await client.mutation(api.banking.upsertActivityBatch, {
  ...connection, serviceToken, accounts: [account, { ...unlabeled, id: "wise-1-102" }],
  replaceAccounts: true, syncedAt: account.updatedAt, transactions: [],
});
const { accounts } = await client.query(api.banking.getActivityMetadata, { serviceToken, connections: [connection] });
assert.deepEqual(accounts.map(row => [row.id, row.wiseEntity]).sort(), [[account.id, "dn"], ["wise-1-102", undefined]]);
let scenario = 0;
for (const first of exports) {
  for (const second of exports) {
    for (const third of exports) {
      const day = String(++scenario).padStart(2, "0");
      const received: Export[] = [];
      for (const event of [first, second, third]) {
        await submit(day, event, accounts);
        received.push(event);
        await checkLedger(day, received);
      }
    }
  }
}
await Promise.all(exports.map(event => submit("28", event, accounts)));
await checkLedger("28", exports);
console.log(`Verified ${scenario} three-submission orders, every prefix, and three concurrent imports.`);
