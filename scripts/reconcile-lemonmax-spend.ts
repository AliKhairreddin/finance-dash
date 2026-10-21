import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parse } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { mediaSpendDates, mediaSpendMaximumSyncDays, mediaSpendYesterdayInIndia } from "../shared/mediaSpend";
import { syncMediaSpend } from "../worker/handler";
import { productionEnvironment, productionServiceEnvironment, productionUrl } from "./deploy-production";

// Deliberate historical reconciliation, using the same validation and lease as the Worker.
// Checkpoints resume completed batches without downloading their source data again.
function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Required option: ${name}`);
  return value;
}

const fromDate = option("--from");
const toDate = option("--to");
const dates = mediaSpendDates(fromDate, toDate);
if (toDate > mediaSpendYesterdayInIndia(Date.now())) throw new Error("Only published days through yesterday can be reconciled");
const backupDirectory = resolve(option("--backup-dir"));
const privateDirectory = resolve(".local") + "/";
if (!backupDirectory.startsWith(privateDirectory)) throw new Error("Use a git-ignored .local/ directory for private backups");
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
const local = Object.assign({}, ...[".env", ".env.local"].map(file => existsSync(file) ? parse(readFileSync(file)) : {}));
const env = productionServiceEnvironment(productionEnvironment({ ...local, ...process.env }));
const credentials: unknown = JSON.parse(readFileSync(option("--credentials-file"), "utf8"));
if (!credentials || typeof credentials !== "object" || !("authToken" in credentials) || !("bearerToken" in credentials)
  || typeof credentials.authToken !== "string" || !credentials.authToken || typeof credentials.bearerToken !== "string" || !credentials.bearerToken) {
  throw new Error("The private credentials file must contain authToken and bearerToken");
}
const workerEnv = {
  CONVEX_URL: productionUrl,
  CONVEX_SERVICE_TOKEN: env.CONVEX_SERVICE_TOKEN!,
  LEMONMAX_AUTH_TOKEN: credentials.authToken,
  LEMONMAX_BEARER_TOKEN: credentials.bearerToken,
  LEMONMAX_SPEND_CURRENCY: "USD",
  LEMONMAX_SYNC_START_DATE: fromDate
} as WorkerEnv;
const convex = new ConvexHttpClient(productionUrl);
const serviceToken = env.CONVEX_SERVICE_TOKEN!;
const manifestPath = resolve(backupDirectory, "manifest.json");
const manifest = { deployment: productionUrl, fromDate, toDate };
if (existsSync(manifestPath)) {
  if (JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) !== JSON.stringify(manifest)) {
    throw new Error("This backup directory belongs to another reconciliation range");
  }
} else writeFileSync(manifestPath, JSON.stringify(manifest), { flag: "wx", mode: 0o600 });

for (let offset = 0; offset < dates.length; offset += mediaSpendMaximumSyncDays) {
  const batch = dates.slice(offset, offset + mediaSpendMaximumSyncDays);
  const checkpoint = resolve(backupDirectory, `${batch[0]}-through-${batch.at(-1)}.complete.json`);
  if (existsSync(checkpoint)) {
    console.log(JSON.stringify({ event: "lemonmax_reconciliation_batch_already_complete", fromDate: batch[0], toDate: batch.at(-1) }));
    continue;
  }
  for (const date of batch) {
    const backupPath = resolve(backupDirectory, `${date}.before.json`);
    if (!existsSync(backupPath)) {
      const saved = await convex.query(api.mediaSpend.listDate, { serviceToken, date, includeZeroSpend: true });
      writeFileSync(backupPath, JSON.stringify(saved), { flag: "wx", mode: 0o600 });
    }
  }
  const imported = await syncMediaSpend(workerEnv, batch[0], batch.at(-1)!);
  if (!imported) throw new Error("The reconciliation did not acquire the sync lease");
  const verification = [];
  let savedRowCount = 0;
  let savedSpend = 0;
  for (const date of batch) {
    const saved = await convex.query(api.mediaSpend.listDate, { serviceToken, date, includeZeroSpend: true });
    if (saved.rows.length === 0 || saved.rows.length !== saved.storedRowCount) throw new Error(`Stored data is incomplete for ${date}`);
    savedRowCount += saved.rows.length;
    savedSpend += saved.rows.reduce((sum, row) => sum + row.spend, 0);
    const result = {
      date, rows: saved.rows.length,
      accounts: new Set(saved.rows.map(row => `${row.platform}:${row.accountId}`)).size,
      withAgency: saved.rows.filter(row => row.agencyId !== undefined || row.agencyName !== undefined).length,
      spend: Math.round(saved.rows.reduce((sum, row) => sum + row.spend, 0) * 100) / 100
    };
    verification.push(result);
  }
  if (savedRowCount !== imported.rowCount || Math.abs(savedSpend - imported.totalSpend) > 0.005) {
    throw new Error("Saved account rows and spend do not reconcile to the validated source response");
  }
  writeFileSync(checkpoint, JSON.stringify(verification, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ event: "lemonmax_reconciliation_batch_verified", fromDate: batch[0], toDate: batch.at(-1), verification }));
  if (offset + mediaSpendMaximumSyncDays < dates.length) await setTimeout(1_000);
}
console.log(JSON.stringify({ event: "lemonmax_reconciliation_complete", ...manifest, days: dates.length }));
