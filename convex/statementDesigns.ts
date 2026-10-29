import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { statementCompany } from "./statementSchema";
import { statementMember, requireScope } from "./statementAccess";
import {
  defaultInvoiceDesign,
  validateInvoiceDesign,
} from "../shared/statementInvoiceDesign";
import { statementCompanies } from "../shared/statements";
export const styles = [
  "corporate",
  "minimal",
  "technology",
  "insurance",
  "professional_services",
  "retail",
  "subscription",
] as const;
const auth = { serviceToken: v.string(), actor: v.string() };
export const list = query({
  args: auth,
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    const rows = await Promise.all(
      member.companyIds.map(async (companyId) => ({
        companyId,
        design: await ctx.db
          .query("statementInvoiceDesigns")
          .withIndex("by_issuer", (q) => q.eq("issuerKey", `our:${companyId}`))
          .unique(),
        versions: await ctx.db
          .query("statementTemplateVersions")
          .withIndex("by_company", (q) => q.eq("companyId", companyId))
          .order("desc")
          .take(100),
      })),
    );
    return JSON.stringify(rows);
  },
});
export const save = mutation({
  args: {
    ...auth,
    companyId: statementCompany,
    style: v.string(),
    accent: v.string(),
    locked: v.boolean(),
    expectedVersion: v.number(),
    brandingAuthorized: v.boolean(),
    logoDataUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    requireScope(member, { companyId: args.companyId });
    if (!member.manage) throw new ConvexError("Administrator required");
    if (
      !styles.some((s) => s === args.style) ||
      !/^#[0-9a-f]{6}$/i.test(args.accent)
    )
      throw new ConvexError("Choose a supported template and color");
    if (args.logoDataUrl && !args.brandingAuthorized)
      throw new ConvexError(
        "Authorize use of this company logo before saving it",
      );
    const issuerKey = `our:${args.companyId}`,
      old = await ctx.db
        .query("statementInvoiceDesigns")
        .withIndex("by_issuer", (q) => q.eq("issuerKey", issuerKey))
        .unique();
    if ((old?.version ?? 0) !== args.expectedVersion)
      throw new ConvexError("Design changed; reload before saving");
    if (old?.locked && args.locked)
      throw new ConvexError("Unlock this design explicitly before changing it");
    const company = statementCompanies.find((c) => c.id === args.companyId)!;
    const base = defaultInvoiceDesign(issuerKey, company.name),
      design = validateInvoiceDesign({
        ...base,
        logoDataUrl:
          args.logoDataUrl === undefined
            ? old
              ? JSON.parse(old.designJson).logoDataUrl
              : undefined
            : args.logoDataUrl || undefined,
        template: args.style as (typeof styles)[number],
        accent: args.accent,
        style: ["insurance", "professional_services"].includes(args.style)
          ? "frame"
          : args.style === "minimal"
            ? "minimal"
            : "rule",
        font: args.style === "insurance" ? "serif" : "sans",
        ...(!args.brandingAuthorized
          ? { logoPath: undefined, logoDataUrl: undefined, source: undefined }
          : {}),
      });
    const version = (old?.version ?? 0) + 1,
      designJson = JSON.stringify(design);
    await ctx.db.insert("statementTemplateVersions", {
      companyId: args.companyId,
      version,
      style: args.style,
      designJson,
      brandingAuthorized: args.brandingAuthorized,
      actor: member.actor,
      createdAt: Date.now(),
    });
    const fields = {
      issuerKey,
      designJson,
      createdAt: old?.createdAt ?? Date.now(),
      version,
      locked: args.locked,
      style: args.style,
      brandingAuthorized: args.brandingAuthorized,
    };
    if (old) await ctx.db.patch(old._id, fields);
    else await ctx.db.insert("statementInvoiceDesigns", fields);
    await ctx.db.insert("statementAudit", {
      entityType: "template",
      entityId: issuerKey,
      actor: member.actor,
      action: "template_version_saved",
      details: JSON.stringify({
        version,
        style: args.style,
        locked: args.locked,
        brandingAuthorized: args.brandingAuthorized,
      }),
      createdAt: new Date().toISOString(),
    });
    return null;
  },
});
