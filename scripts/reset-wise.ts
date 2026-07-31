import { config } from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

config({ path: ".env.local" });

const convexUrl = process.env.CONVEX_URL?.trim();
const serviceToken = process.env.CONVEX_SERVICE_TOKEN?.trim();
if (!convexUrl || !serviceToken) {
  throw new Error("CONVEX_URL and CONVEX_SERVICE_TOKEN are required in .env.local");
}

const confirmation = process.argv.find((argument) => argument.startsWith("--confirm="))?.slice("--confirm=".length);
const convex = new ConvexHttpClient(convexUrl);
const preview = await convex.query(api.dashboard.getWiseResetPreview, { serviceToken });

if (confirmation !== "CLEAR_WISE_IMPORT_HISTORY") {
  console.log(JSON.stringify({
    mode: "preview",
    ...preview,
    next: "Re-run with --confirm=CLEAR_WISE_IMPORT_HISTORY"
  }));
  process.exit(0);
}

const result = await convex.mutation(api.dashboard.resetWiseImports, { serviceToken });
console.log(JSON.stringify({
  mode: "deleted",
  deletedTransactions: result.deletedTransactions,
  deletedImports: result.deletedImports,
  updatedAt: result.updatedAt
}));
