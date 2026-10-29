import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  normalizeStatementActor,
  statementCompanies,
  statementAccounts,
  type StatementCompanyId,
  type StatementPermission,
} from "../shared/statements";
export async function statementMember(
  ctx: QueryCtx | MutationCtx,
  args: { serviceToken: string; actor: string },
  permission: StatementPermission = "view",
) {
  if (
    !process.env.CONVEX_SERVICE_TOKEN ||
    args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN
  )
    throw new ConvexError("Unauthorized");
  const actor = normalizeStatementActor(args.actor);
  const member = await ctx.db
    .query("statementMembers")
    .withIndex("by_actor", (q) => q.eq("actor", actor))
    .unique();
  if (!member) throw new ConvexError("Statement access is not configured");
  requirePermission(member, permission);
  return member;
}
export function requirePermission(
  member: Doc<"statementMembers">,
  permission: StatementPermission,
) {
  if (!member.permissions?.includes(permission))
    throw new ConvexError(
      `Permission required: ${permission}. Ask an administrator to configure access.`,
    );
}
export function canReadScope(
  member: Doc<"statementMembers">,
  row: { companyId?: string; financialAccountId?: string },
) {
  if (
    row.companyId
      ? !member.companyIds.some((c) => c === row.companyId)
      : !statementCompanies.every((c) => member.companyIds.includes(c.id))
  )
    return false;
  // Unresolved LoveMeDo records are available only to members authorized for every LMD account.
  if (row.companyId === "lovemedo" && !row.financialAccountId)
    return ["revolut-lmd", "amex-lmd", "wise-lmd"].every((id) =>
      member.accountIds?.includes(id),
    );
  return (
    !row.financialAccountId ||
    Boolean(member.accountIds?.includes(row.financialAccountId))
  );
}
export function requireScope(
  member: Doc<"statementMembers">,
  row: { companyId?: StatementCompanyId; financialAccountId?: string },
) {
  if (!canReadScope(member, row))
    throw new ConvexError("Company or financial account access required");
}
export async function validateAccount(
  ctx: QueryCtx | MutationCtx,
  row: { companyId?: StatementCompanyId; financialAccountId?: string },
) {
  if (!row.financialAccountId) return;
  const account = await ctx.db
    .query("statementAccounts")
    .withIndex("by_key", (q) => q.eq("key", row.financialAccountId!))
    .unique();
  if (!account || account.companyId !== row.companyId)
    throw new ConvexError("Choose an account belonging to the legal company");
}

export function fullStatementManagement(
  member: Doc<"statementMembers"> | null,
) {
  return Boolean(
    member?.manage &&
      member.permissions?.includes("settings") &&
      statementCompanies.every((c) => member.companyIds.includes(c.id)) &&
      statementAccounts.every((a) => member.accountIds?.includes(a.id)),
  );
}
