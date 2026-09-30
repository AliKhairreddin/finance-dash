import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { boundedBytes } from "./documentIntake";

export async function handleManagementReportUpload(
  request: Request,
  env: Pick<WorkerEnv, "CONVEX_URL" | "MANAGEMENT_REPORT_IMPORT_TOKEN">
): Promise<Response> {
  if (!env.CONVEX_URL || !env.MANAGEMENT_REPORT_IMPORT_TOKEN?.trim()) {
    return Response.json({ message: "Management report imports are not configured" }, { status: 503 });
  }
  try {
    const fileName = decodeURIComponent(request.headers.get("X-File-Name") ?? "");
    if (!fileName.toLowerCase().endsWith(".xlsx")) throw new Error("Choose a management report .xlsx workbook.");
    const bytes = await boundedBytes(request.body, 10 * 1024 * 1024);
    if (!bytes.length) throw new Error("The workbook is empty.");
    const convex = new ConvexHttpClient(env.CONVEX_URL);
    const importToken = env.MANAGEMENT_REPORT_IMPORT_TOKEN.trim();
    const uploadUrl = await convex.mutation(api.managementReport.generateImportUploadUrl, { importToken });
    const upload = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, body: new Blob([bytes]), signal: AbortSignal.timeout(30_000) });
    if (!upload.ok) throw new Error("The workbook could not be uploaded. Please retry.");
    const { storageId } = await upload.json() as { storageId: Id<"_storage"> };
    const result = await convex.action(api.managementReportUpload.importWorkbook, { importToken, storageId, fileName });
    return Response.json(result, { status: result.alreadyComplete ? 200 : 201 });
  } catch (error) {
    const message = error instanceof ConvexError && typeof error.data === "string"
      ? error.data
      : error instanceof Error ? error.message : "Management report upload failed";
    return Response.json({ message }, { status: 400 });
  }
}
