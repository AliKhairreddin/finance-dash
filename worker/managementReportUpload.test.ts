import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { importWorkbook } from "../convex/managementReportUpload";
import { handleManagementReportUpload } from "./managementReportUpload";
import { managementWorkbookBytes, managementWorkbookSheets } from "../shared/testFixtures/managementWorkbook";

const env = { CONVEX_URL: "https://test.convex.cloud", MANAGEMENT_REPORT_IMPORT_TOKEN: "import-secret" };
const args = { importToken: env.MANAGEMENT_REPORT_IMPORT_TOKEN, storageId: "temporary-workbook", fileName: "report.xlsx" };
const runImport = (ctx: unknown, values = args) => (importWorkbook as unknown as { _handler(ctx: unknown, args: unknown): Promise<{ importId: string; alreadyComplete: boolean }> })._handler(ctx, values);
function uploadRequest(bytes = managementWorkbookBytes(), fileName = "report.xlsx") {
  return new Request("https://finance.example/api/management-report/upload", {
    method: "POST", headers: { "X-File-Name": encodeURIComponent(fileName) }, body: bytes
  });
}
function importContext(bytes = managementWorkbookBytes(), options: { duplicate?: boolean; fail?: boolean } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const ctx = {
    storage: { async get() { return new Blob([bytes]); }, async delete(id: string) { deleted.push(id); } },
    async runMutation(fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) {
      const name = getFunctionName(fn); calls.push({ name, args });
      if (name === "managementReport:beginImport") return { importId: args.importId, alreadyComplete: Boolean(options.duplicate) };
      if (name === "managementReport:cleanupImportBatch") return { hasMore: false };
      if (name === "managementReport:insertSourceRows" && options.fail) throw new Error("Storage write failed");
      return null;
    }
  };
  return { ctx, calls, deleted };
}
function configureToken(t: { after(fn: () => void): void }) {
  const previous = process.env.MANAGEMENT_REPORT_IMPORT_TOKEN;
  process.env.MANAGEMENT_REPORT_IMPORT_TOKEN = env.MANAGEMENT_REPORT_IMPORT_TOKEN;
  t.after(() => { if (previous === undefined) delete process.env.MANAGEMENT_REPORT_IMPORT_TOKEN; else process.env.MANAGEMENT_REPORT_IMPORT_TOKEN = previous; });
}

test("Node workbook import completes a validated snapshot in batches and removes its temporary file", async t => {
  configureToken(t);
  const { ctx, calls, deleted } = importContext();
  const result = await runImport(ctx);
  assert.match(result.importId, /^management-[a-f0-9]{24}$/);
  assert.deepEqual(Object.keys(result).sort(), ["alreadyComplete", "importId"]);
  assert.equal(calls.at(-1)?.name, "managementReport:completeImport");
  assert.ok(calls.some(call => call.name === "managementReport:insertSourceRows"));
  assert.ok(calls.some(call => call.name === "managementReport:insertBankEntries"));
  for (const call of calls) { assert.equal(call.args.importToken, env.MANAGEMENT_REPORT_IMPORT_TOKEN); assert.equal(call.args.importId, result.importId); }
  assert.deepEqual(deleted, [args.storageId]);
});

test("reuploading an existing workbook does not delete or rewrite its snapshot", async t => {
  configureToken(t);
  const { ctx, calls, deleted } = importContext(undefined, { duplicate: true });
  const result = await runImport(ctx);
  assert.equal(result.alreadyComplete, true);
  assert.deepEqual(calls.map(call => call.name), ["managementReport:beginImport"]);
  assert.deepEqual(deleted, [args.storageId]);
});

test("invalid workbooks cannot reach report storage and failed imports cannot become current", async t => {
  configureToken(t);
  const invalid = importContext(new Uint8Array([1, 2]));
  await assert.rejects(runImport(invalid.ctx), /could not be read/);
  assert.equal(invalid.calls.length, 0);
  assert.deepEqual(invalid.deleted, [args.storageId]);
  const failed = importContext(undefined, { fail: true });
  await assert.rejects(runImport(failed.ctx), /Storage write failed/);
  assert.equal(failed.calls.at(-1)?.name, "managementReport:failImport");
  assert.ok(!failed.calls.some(call => call.name === "managementReport:completeImport"));
  assert.deepEqual(failed.deleted, [args.storageId]);
  const unauthorized = importContext();
  await assert.rejects(runImport(unauthorized.ctx, { ...args, importToken: "wrong" }), /UNAUTHORIZED_IMPORT/);
  assert.equal(unauthorized.calls.length, 0);
  assert.equal(unauthorized.deleted.length, 0);
});

test("large compressed worksheets are parsed in the Node action", async t => {
  configureToken(t);
  const large = [...managementWorkbookSheets(), { sheet: "Supporting data", data: Array.from({ length: 7000 }, (_, i) => [String(i), "Large supporting row ".repeat(8)]) }];
  const { ctx, calls } = importContext(managementWorkbookBytes(large));
  await runImport(ctx);
  assert.ok(calls.filter(call => call.name === "managementReport:insertSourceRows").length > 90);
  assert.equal(calls.at(-1)?.name, "managementReport:completeImport");
});

test("Worker stages the workbook and forwards imports to Convex without exposing the credential", async t => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    calls.push({ name: getFunctionName(fn), args }); return "https://test.convex.cloud/upload";
  });
  t.mock.method(globalThis, "fetch", async (url: string) => { assert.equal(url, "https://test.convex.cloud/upload"); return Response.json({ storageId: "temporary-workbook" }); });
  t.mock.method(ConvexHttpClient.prototype, "action", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    calls.push({ name: getFunctionName(fn), args }); return { importId: "saved-report", alreadyComplete: false };
  });
  const response = await handleManagementReportUpload(uploadRequest(), env);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { importId: "saved-report", alreadyComplete: false });
  assert.equal(calls[0].name, "managementReport:generateImportUploadUrl");
  assert.equal(calls[1].name, "managementReportUpload:importWorkbook");
  assert.deepEqual(calls[1].args, args);
  assert.equal((await handleManagementReportUpload(uploadRequest(new Uint8Array([1]), "report.pdf"), env)).status, 400);
  assert.equal((await handleManagementReportUpload(uploadRequest(), { ...env, MANAGEMENT_REPORT_IMPORT_TOKEN: "" })).status, 503);
  assert.equal(calls.length, 2, "unsupported uploads and missing credentials cannot reach storage");
  t.mock.method(ConvexHttpClient.prototype, "action", async () => { throw new ConvexError("VB - Consolidated is required for the management report."); });
  const invalid = await handleManagementReportUpload(uploadRequest(), env);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { message: "VB - Consolidated is required for the management report." });
});
