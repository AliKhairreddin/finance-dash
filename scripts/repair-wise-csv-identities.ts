import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });
config();

const convexUrl = process.env.CONVEX_URL?.trim();
const serviceToken = process.env.CONVEX_SERVICE_TOKEN?.trim();
if (!convexUrl || !serviceToken) {
  throw new Error("CONVEX_URL and CONVEX_SERVICE_TOKEN are required");
}

const convex = new ConvexHttpClient(convexUrl);
let cursor: string | null = null;
let processed = 0;
let rekeyed = 0;
let merged = 0;

do {
  const page: {
    processed: number;
    rekeyed: number;
    merged: number;
    isDone: boolean;
    continueCursor: string | null;
  } = await convex.mutation(api.banking.canonicalizeWiseCsvTransactionsBatch, {
    serviceToken,
    cursor,
    limit: 200
  });
  processed += page.processed;
  rekeyed += page.rekeyed;
  merged += page.merged;
  cursor = page.continueCursor;
  if (page.isDone) break;
} while (cursor);

console.log(JSON.stringify({ processed, rekeyed, merged }, null, 2));
