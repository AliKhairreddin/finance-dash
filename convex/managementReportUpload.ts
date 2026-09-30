"use node";

import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { readManagementWorkbook, managementWorkbookMaximumBytes } from "../shared/managementReportWorkbook";
import { storeManagementWorkbook } from "../shared/managementReportImport";

export const importWorkbook = action({
  args: { importToken: v.string(), storageId: v.id("_storage"), fileName: v.string() },
  returns: v.object({ importId: v.string(), alreadyComplete: v.boolean() }),
  handler: async (ctx, args) => {
    const expected = process.env.MANAGEMENT_REPORT_IMPORT_TOKEN;
    if (!expected || args.importToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED_IMPORT" });
    try {
      const file = await ctx.storage.get(args.storageId);
      if (!file) throw new Error("Uploaded workbook is unavailable.");
      if (file.size > managementWorkbookMaximumBytes) throw new Error("The workbook exceeds the 10 MB upload limit.");
      const prepared = await readManagementWorkbook(new Uint8Array(await file.arrayBuffer()), args.fileName);
      return await storeManagementWorkbook({ mutation: (fn, payload) => ctx.runMutation(fn, payload) }, args.importToken, prepared);
    } catch (error) {
      throw new ConvexError(error instanceof Error ? error.message : "Management report import failed");
    } finally {
      await ctx.storage.delete(args.storageId);
    }
  }
});
