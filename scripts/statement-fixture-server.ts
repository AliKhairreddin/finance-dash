// Isolated browser test harness. No dotenv loading, remote backend or real credentials.
import http from "node:http";
import { AsyncResource } from "node:async_hooks";
import { convexTest } from "convex-test";
import { convexToJson, jsonToConvex, ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { statementCompanies, statementAccounts } from "../shared/statements";
import { handleStatementApi, type StatementEnv } from "../worker/statements";
import { handleStatementInvoices } from "../worker/statementInvoices";
import { handleMailboxApi } from "../worker/statementMailboxes";
import { handleCaptureDevice } from "../worker/receiptCapture";
import { invoiceHtml } from "../worker/statementInvoicePdf";
process.env.CONVEX_SERVICE_TOKEN = "isolated-statement-fixture";
const auth = { serviceToken: process.env.CONVEX_SERVICE_TOKEN, actor: "Ali" };
const modules = {
  "../convex/statementMailboxes.ts": () =>
    import("../convex/statementMailboxes"),
  "../convex/statementCapture.ts": () => import("../convex/statementCapture"),
  "../convex/statementProcessing.ts": () =>
    import("../convex/statementProcessing"),
  "../convex/statementAutomation.ts": () =>
    import("../convex/statementAutomation"),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/statements.ts": () => import("../convex/statements"),
  "../convex/statementInvoices.ts": () => import("../convex/statementInvoices"),
  "../convex/statementWorkspace.ts": () =>
    import("../convex/statementWorkspace"),
  "../convex/statementIntelligence.ts": () =>
    import("../convex/statementIntelligence"),
  "../convex/statementLibrary.ts": () => import("../convex/statementLibrary"),
  "../convex/statementDesigns.ts": () => import("../convex/statementDesigns"),
};
// Convex scheduled jobs start outside the scheduling mutation. Node timers retain
// AsyncLocalStorage by default; clear that inherited test-only nested transaction.
const timerRoot = new AsyncResource("statement-fixture-scheduler"),
  nativeTimer = globalThis.setTimeout;
globalThis.setTimeout = ((
  callback: (...args: unknown[]) => void,
  delay?: number,
  ...args: unknown[]
) =>
  nativeTimer(
    () => timerRoot.runInAsyncScope(callback, undefined, ...args),
    delay,
  )) as typeof setTimeout;
const t = convexTest(schema, modules);
// The test database has one transaction stack. Serialize its HTTP bridge and drain
// real scheduled handlers; production Convex supplies its own transaction isolation.
let databaseTail: Promise<unknown> = Promise.resolve();
function database<T>(work: () => Promise<T>): Promise<T> {
  const result = databaseTail.then(work);
  databaseTail = result.catch(() => {});
  return result;
}
await t.mutation(api.statements.initialize, {
  serviceToken: auth.serviceToken,
});
for (const company of statementCompanies) {
  await t.mutation(api.statements.saveAddress, {
    ...auth,
    companyId: company.id,
    name: company.name,
    addressLine1: "SYNTHETIC - Example Lane 1",
    city: "Example City",
    country: "NL",
    notes: "Synthetic browser fixture",
  });
  await t.mutation(api.statements.saveAddress, {
    ...auth,
    companyId: company.id,
    name: "Synthetic Hosting",
    addressLine1: "SYNTHETIC - Sample Lane 2",
    city: "Example City",
    country: "NL",
    description: "Web hosting services",
    notes: "Synthetic browser fixture",
  });
  for (let batch = 0; batch < 2; batch++)
    await t.mutation(api.statements.createTransactions, {
      ...auth,
      requestId: crypto.randomUUID(),
      rows: Array.from({ length: 15 }, (_, i) => ({
        companyId: company.id,
        ...(company.id === "lovemedo"
          ? { financialAccountId: statementAccounts[i % 3].id }
          : {}),
        date: `2026-10-${String(i + 1).padStart(2, "0")}`,
        description: `Synthetic hosting ${batch * 15 + i + 1}`,
        counterparty: i % 4 ? "Synthetic Hosting" : "Unresolved Merchant",
        source:
          company.id === "lovemedo"
            ? statementAccounts[i % 3].provider
            : "Synthetic Bank",
        account: "Fixture account",
        providerId: `${company.id}-${batch}-${i}`,
        amount: `${20 + i}.00`,
        currency: "EUR",
        direction: i % 3 ? ("out" as const) : ("in" as const),
      })),
    });
}
await t.run(async (ctx) => {
  for (let i = 0; i < 2101; i++)
    await ctx.db.insert("statementTransactions", {
      companyId: "artec",
      date: "2025-01-01",
      description: `Volume fixture ${i}`,
      source: "Isolated volume fixture",
      amountMinor: "100",
      currency: "EUR",
      direction: "out",
      reviewReasons: [],
      origin: "manual",
      status: "pending",
      documentIds: [],
      revision: 1,
      financialRevision: 1,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      createdBy: "Ali",
      candidateKey: `volume-${i}`,
      intakeKey: `volume-${i}`,
    });
});
// All network calls from this process must stay on loopback, except Convex-test's in-memory storage URLs.
const nativeFetch = globalThis.fetch;
const storageObjects = new Map<string, Blob>();
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (
    url.hostname === "some-deployment.convex.cloud" &&
    url.pathname.startsWith("/api/storage/")
  ) {
    if (url.pathname.endsWith("/upload")) {
      const request = new Request(url, { ...init });
      const blob = new Blob([new Uint8Array(await request.arrayBuffer())], {
        type: request.headers.get("Content-Type") ?? "application/octet-stream",
      });
      const storageId = await database(() =>
        t.run((ctx) => ctx.storage.store(blob)),
      );
      const storedUrl = await database(() =>
        t.run((ctx) => ctx.storage.getUrl(storageId)),
      );
      storageObjects.set(storedUrl!, blob);
      return Response.json({ storageId });
    }
    const blob = storageObjects.get(url.href);
    return blob
      ? new Response(blob)
      : new Response("Missing fixture", { status: 404 });
  }
  if (!["127.0.0.1", "localhost"].includes(url.hostname))
    throw new Error(`Fixture blocked external request: ${url.hostname}`);
  return nativeFetch(input, init);
};
const browser = await chromium.launch({ headless: true });
const env = {
  CONVEX_URL: "http://127.0.0.1:8797",
  CONVEX_SERVICE_TOKEN: auth.serviceToken,
  OPENROUTER_API_KEY: "",
} as StatementEnv;
const server = http.createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const data = Buffer.concat(chunks),
      url = new URL(req.url ?? "/", "http://127.0.0.1:8797");
    if (url.pathname === "/api/query_ts") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ts: "isolated-fixture" }));
      return;
    }
    if (
      [
        "/api/query_at_ts",
        "/api/query",
        "/api/mutation",
        "/api/action",
      ].includes(url.pathname)
    ) {
      const body = JSON.parse(data.toString()),
        args = jsonToConvex(
          Array.isArray(body.args) ? body.args[0] : body.args,
        ) as Record<string, unknown>;
      let value: unknown;
      try {
        value = await database(async () => {
          if (["/api/query", "/api/query_at_ts"].includes(url.pathname))
            return t.query(makeFunctionReference<"query">(body.path), args);
          if (url.pathname === "/api/mutation") {
            const value = await t.mutation(
              makeFunctionReference<"mutation">(body.path),
              args,
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            await t.finishAllScheduledFunctions(() => {});
            return value;
          }
          return t.action(makeFunctionReference<"action">(body.path), args);
        });
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "success",
            value: convexToJson(value as never),
          }),
        );
      } catch (error) {
        res.statusCode = 560;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Fixture error",
            errorData:
              error instanceof ConvexError ? error.data : String(error),
          }),
        );
      }
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(key, value);
    // Vite's same-origin proxy retains the UI origin. Reconstruct the original request URL.
    const requestUrl = `http://127.0.0.1:5179${url.pathname}${url.search}`;
    const request = new Request(requestUrl, {
      method: req.method,
      headers,
      ...(!["GET", "HEAD"].includes(req.method ?? "GET")
        ? { body: new Uint8Array(data) }
        : {}),
    });
    let response = await handleStatementInvoices(
      request,
      env,
      { username: "Ali", role: "administrator" },
      async (_env, _example, layout, draft, isDraft) => {
        const page = await browser.newPage();
        try {
          await page.route("**/*", (route) => route.abort());
          await page.setContent(invoiceHtml(draft, layout, isDraft));
          return new Uint8Array(
            await page.pdf({
              format: "A4",
              printBackground: true,
              displayHeaderFooter: true,
              headerTemplate: "<div></div>",
              footerTemplate:
                '<div style="font-size:8px;width:100%;text-align:center">SYNTHETIC · Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
              margin: {
                top: "0.4in",
                bottom: "0.45in",
                left: "0.5in",
                right: "0.5in",
              },
            }),
          );
        } finally {
          await page.close();
        }
      },
    );
    response ??= await handleMailboxApi(request, env, {
      username: "Ali",
      role: "administrator",
    });
    response ??= await handleCaptureDevice(request, env as WorkerEnv, {
      username: "Ali",
      role: "administrator",
    });
    response ??= await handleStatementApi(request, env, {
      username: "Ali",
      role: "administrator",
    });
    response ??= new Response("Not found", { status: 404 });
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        message: e instanceof Error ? e.message : "Fixture failure",
      }),
    );
  }
});
await new Promise<void>((resolve) => server.listen(8797, "127.0.0.1", resolve));
const vite = await createServer({
  envDir: false,
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: true,
    watch: { ignored: ["**/output/**"] },
    proxy: { "/api": "http://127.0.0.1:8797" },
  },
});
await vite.listen();
console.log("Isolated synthetic Statements: http://127.0.0.1:5179/statements");
process.on("SIGTERM", () => {
  void Promise.all([vite.close(), browser.close()]).then(() =>
    server.close(() => process.exit(0)),
  );
});
