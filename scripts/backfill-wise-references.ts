import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { productionEnvironment, productionUrl } from "./deploy-production";

// Preview by default; --apply updates references only, in bounded, resumable batches.
const dryRun = !process.argv.includes("--apply");
const env = productionEnvironment(process.env);
const selection = env.CONVEX_DEPLOY_KEY ? [] : ["--deployment", "famous-oyster-878"];
const token = spawnSync("npx", ["convex", "env", "get", "CONVEX_SERVICE_TOKEN", ...selection], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (token.status !== 0 || !token.stdout.trim()) throw new Error("Could not read production storage credentials.");
const serviceToken = token.stdout.trim();
const client = new ConvexHttpClient(productionUrl);
const before = await client.query(api.banking.getBankLedgerCutoverStatus, { serviceToken });
if (!before.ready) throw new Error("Production ledger is not ready.");
let cursor: string | null = null, scanned = 0, changed = 0;
for (let page = 0; page < 10_000; page++) {
  const result: { scanned: number; changed: number; isDone: boolean; continueCursor: string } = await client.mutation(api.banking.backfillWiseReferences, { serviceToken, dryRun, cursor });
  scanned += result.scanned; changed += result.changed;
  if (result.isDone) {
    const after = await client.query(api.banking.getBankLedgerCutoverStatus, { serviceToken });
    if (!after.ready) throw new Error("Production ledger verification failed after backfill.");
    console.log(JSON.stringify({ productionUrl, dryRun, scanned, changed, ledgerReady: after.ready }));
    process.exit(0);
  }
  cursor = result.continueCursor;
}
throw new Error("Backfill reached its batch limit; rerun to continue safely.");
