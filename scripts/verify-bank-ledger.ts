import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });
config();

const convexUrl = process.env.CONVEX_URL?.trim();
const serviceToken = process.env.CONVEX_SERVICE_TOKEN?.trim();
if (!convexUrl || !serviceToken) {
  throw new Error("CONVEX_URL and CONVEX_SERVICE_TOKEN are required to verify the bank ledger");
}

const convex = new ConvexHttpClient(convexUrl);
const status = await convex.query(api.banking.getBankLedgerCutoverStatus, { serviceToken });
if (!status.ready) {
  throw new Error(`Bank ledger is not ready: ${JSON.stringify(status)}`);
}

console.log(JSON.stringify({ event: "bank_ledger_ready", ...status }));
