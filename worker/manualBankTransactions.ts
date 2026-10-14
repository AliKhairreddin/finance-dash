import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isManualBankSource, manualBankSortKeys, validateManualBankFields, type ManualBankFields, type ManualBankSortKey } from "../shared/manualBankTransactions";
import type { DashboardSession } from "../shared/types";

export async function handleManualBankApi(request: Request, env: Pick<WorkerEnv, "CONVEX_URL" | "CONVEX_SERVICE_TOKEN">, session: DashboardSession | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/manual-bank-transactions" && !url.pathname.startsWith("/api/manual-bank-transactions/")) return null;
  if (!session || !["administrator", "finance-operator"].includes(session.role)) return Response.json({ message: "Bank editing access is required." }, { status: 403 });
  const convex = new ConvexHttpClient(env.CONVEX_URL), serviceToken = env.CONVEX_SERVICE_TOKEN;
  try {
    if (request.method === "GET" && url.pathname === "/api/manual-bank-transactions") {
      const source = url.searchParams.get("source"), sortKey = url.searchParams.get("sort") ?? "date", order = url.searchParams.get("order") ?? "desc";
      if (!isManualBankSource(source) || !manualBankSortKeys.includes(sortKey as ManualBankSortKey) || !["asc", "desc"].includes(order)) throw new Error("Invalid ledger or sort.");
      return Response.json(await convex.query(api.manualBankTransactions.list, { serviceToken, source, sortKey: sortKey as ManualBankSortKey, order: order as "asc" | "desc", paginationOpts: { numItems: 50, cursor: url.searchParams.get("cursor") || null } }));
    }
    const match = url.pathname.match(/^\/api\/manual-bank-transactions\/([a-z0-9]+)$/u);
    if (request.method === "PATCH" && match) {
      if (request.headers.get("Origin") !== url.origin) return Response.json({ message: "Open this editor from the dashboard." }, { status: 403 });
      const text = await request.text();
      if (text.length > 4096) throw new Error("Transaction update is too large.");
      const input = JSON.parse(text) as ManualBankFields & { expectedRevision: number };
      const fields = validateManualBankFields(input);
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error("Transaction revision is required.");
      await convex.mutation(api.manualBankTransactions.update, { serviceToken, id: match[1] as Id<"manualBankTransactions">, ...fields, expectedRevision: input.expectedRevision, updatedBy: session.username });
      return Response.json({ ok: true });
    }
    return Response.json({ message: "Method not allowed." }, { status: 405 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ledger request failed.";
    return Response.json({ message }, { status: message.includes("edited by someone else") ? 409 : 400 });
  }
}
