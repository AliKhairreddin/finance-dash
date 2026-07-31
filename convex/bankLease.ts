import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

export interface BankSyncLeaseCredential {
  connectionKey: string;
  leaseToken: string;
  leaseFence: number;
}

export async function assertBankLedgerReady(ctx: MutationCtx | QueryCtx): Promise<void> {
  const cutover = await ctx.db
    .query("bankLedgerCutover")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  if (!cutover || cutover.status !== "ready") {
    throw new ConvexError({ code: "BANK_LEDGER_CUTOVER_REQUIRED" });
  }
}

export async function assertBankConnectionBinding(
  ctx: MutationCtx | QueryCtx,
  source: "wise" | "revolut" | "slash" | "amex",
  connectionKey: string
): Promise<void> {
  const binding = await ctx.db
    .query("bankConnectionBindings")
    .withIndex("by_source", (q) => q.eq("source", source))
    .unique();
  if (!binding || binding.connectionKey !== connectionKey) {
    throw new ConvexError({
      code: "BANK_CONNECTION_REBIND_REQUIRED",
      source,
      expectedConnectionKey: binding?.connectionKey ?? null
    });
  }
}

export async function ensureBankConnectionBinding(
  ctx: MutationCtx,
  source: "wise" | "revolut" | "slash" | "amex",
  connectionKey: string
): Promise<void> {
  const binding = await ctx.db
    .query("bankConnectionBindings")
    .withIndex("by_source", (q) => q.eq("source", source))
    .unique();
  if (binding) {
    if (binding.connectionKey !== connectionKey) {
      throw new ConvexError({
        code: "BANK_CONNECTION_REBIND_REQUIRED",
        source,
        expectedConnectionKey: binding.connectionKey
      });
    }
    return;
  }
  const [transaction, account] = await Promise.all([
    ctx.db.query("bankTransactions").withIndex("by_source", (q) => q.eq("source", source)).first(),
    ctx.db.query("bankAccounts").withIndex("by_source", (q) => q.eq("source", source)).first()
  ]);
  if (transaction || account) {
    throw new ConvexError({
      code: "BANK_CONNECTION_REBIND_REQUIRED",
      source,
      expectedConnectionKey: null
    });
  }
  await ctx.db.insert("bankConnectionBindings", {
    source,
    connectionKey,
    boundAt: new Date().toISOString()
  });
}

export async function assertActiveBankSyncLease(
  ctx: MutationCtx,
  source: "wise" | "revolut" | "slash" | "amex",
  credential: BankSyncLeaseCredential
): Promise<void> {
  if (
    !credential.leaseToken
    || credential.leaseToken.length > 256
    || !Number.isSafeInteger(credential.leaseFence)
    || credential.leaseFence < 1
  ) {
    throw new ConvexError({ code: "INVALID_SYNC_LEASE", source });
  }
  const lease = await ctx.db
    .query("workerLeases")
    .withIndex("by_key", (q) => q.eq("key", `bank-sync:${source}:${credential.connectionKey}`))
    .unique();
  if (
    !lease
    || lease.token !== credential.leaseToken
    || lease.fence !== credential.leaseFence
    || lease.expiresAt <= Date.now()
  ) {
    throw new ConvexError({ code: "STALE_SYNC_LEASE", source });
  }
}
