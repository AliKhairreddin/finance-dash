import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { CashFlowLine, SaveCashFlowSnapshotPayload } from "../shared/types";

config({ path: ".env.local" });
config();

type ExpectedTotals = {
  cash: number;
  receivables: number;
  openBalances: number;
  payables: number;
  investments: number;
  profit: number;
  assets: number;
};

type SnapshotFile = {
  snapshot: SaveCashFlowSnapshotPayload;
  expectedTotals: ExpectedTotals;
};

const confirmationPhrase = "SAVE_CASH_FLOW_SNAPSHOT";
const convexUrl = process.env.CONVEX_URL?.trim();
const serviceToken = process.env.CONVEX_SERVICE_TOKEN?.trim();
if (!convexUrl || !serviceToken) throw new Error("CONVEX_URL and CONVEX_SERVICE_TOKEN are required");

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function total(lines: CashFlowLine[]): number {
  return Number(lines
    .filter((line) => !line.excludedFromTotals)
    .reduce((sum, line) => sum + line.amount, 0)
    .toFixed(2));
}

const file = argument("file");
if (!file) throw new Error("--file=/path/to/cash-flow-snapshot.json is required");
const source = JSON.parse(await readFile(path.resolve(file), "utf8")) as SnapshotFile;
const { snapshot, expectedTotals } = source;
const calculated = {
  cash: total(snapshot.cashAccounts),
  receivables: total(snapshot.receivables),
  openBalances: total(snapshot.openBalances),
  payables: total(snapshot.payables),
  investments: total(snapshot.investments),
  profit: 0,
  assets: 0
};
calculated.profit = Number((calculated.cash + calculated.receivables + calculated.openBalances - calculated.payables).toFixed(2));
calculated.assets = Number((calculated.profit + calculated.investments).toFixed(2));
for (const key of Object.keys(expectedTotals) as Array<keyof ExpectedTotals>) {
  if (calculated[key] !== expectedTotals[key]) {
    throw new Error(`${key} does not reconcile: calculated ${calculated[key]}, expected ${expectedTotals[key]}`);
  }
}

const preview = {
  mode: "preview",
  asOfDate: snapshot.asOfDate,
  rows: snapshot.cashAccounts.length + snapshot.receivables.length + snapshot.openBalances.length
    + snapshot.payables.length + snapshot.investments.length,
  totals: calculated
};
if (argument("confirm") !== confirmationPhrase) {
  console.log(JSON.stringify({ ...preview, next: `Re-run with --confirm=${confirmationPhrase}` }, null, 2));
  process.exit(0);
}

const convex = new ConvexHttpClient(convexUrl);
const saved = await convex.mutation(api.dashboard.upsertCashFlowSnapshot, { serviceToken, snapshot });
console.log(JSON.stringify({ mode: "saved", snapshot: saved, totals: calculated }, null, 2));
