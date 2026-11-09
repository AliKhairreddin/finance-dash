import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import { statementRevolutDirectAccount } from "./statementSchema";
import { revolutOwnerCompany } from "../shared/statementRevolut";
import { decodeBankSyncCheckpoint } from "../shared/bankSyncCheckpoint";
import { saveRevolutStatementRow } from "./statementRevolut";

const day = 86_400_000;
const auth = { serviceToken: v.string(), token: v.string() };
function service(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
async function feed(ctx: MutationCtx, a: {serviceToken:string;token:string}) {
  service(a.serviceToken);
  const row = await ctx.db.query("statementRevolutFeeds").withIndex("by_key", q => q.eq("key", "lmd")).unique();
  if (!row || row.token !== a.token || row.leaseUntil < Date.now()) throw new ConvexError("Revolut sync lease expired");
  return row;
}

export const acquire = mutation({
  args: auth,
  returns: v.union(v.null(), v.object({checkpoint:v.union(v.string(),v.null()),fromDate:v.string(),toDate:v.string(),discover:v.boolean()})),
  handler: async(ctx,a) => {
    service(a.serviceToken);
    const old = await ctx.db.query("statementRevolutFeeds").withIndex("by_key", q=>q.eq("key","lmd")).unique();
    const now=Date.now();
    if(old && (old.leaseUntil>now || old.nextRunAt>now)) return null;
    const full=!old?.lastFullAt || old.lastFullAt<now-30*day;
    const range=old?.checkpoint ? {fromDate:old.fromDate,toDate:old.toDate,full:old.full} : {fromDate:full?"2015-01-01":new Date(now-35*day).toISOString().slice(0,10),toDate:new Date(now).toISOString().slice(0,10),full};
    const fields={...range,token:a.token,leaseUntil:now+5*60_000};
    if(old) await ctx.db.patch(old._id,fields);
    else await ctx.db.insert("statementRevolutFeeds",{...fields,key:"lmd",accounts:[],verifiedAt:0,nextRunAt:0,lastSyncedAt:0,lastFullAt:0,checkpoint:null});
    return {checkpoint:old?.checkpoint??null,fromDate:range.fromDate,toDate:range.toDate,discover:!old?.verifiedAt || old.verifiedAt<now-day};
  }
});

export const directory = mutation({
  args:{...auth,accounts:v.array(statementRevolutDirectAccount)},returns:v.null(),
  handler:async(ctx,a)=>{
    const old=await feed(ctx,a);
    if(!a.accounts.length || a.accounts.length>1000 || new Set(a.accounts.map(x=>x.id)).size!==a.accounts.length) throw new ConvexError("Incomplete LMD account directory");
    // Every imported account must have an unambiguous LMD legal beneficiary.
    if(a.accounts.some(x=>revolutOwnerCompany(x.beneficiaries)!=="lovemedo")) throw new ConvexError("LMD account ownership could not be verified");
    await ctx.db.patch(old._id,{accounts:a.accounts.map(x=>{const prior=old.accounts.find(p=>p.id===x.id);return {...x,...(prior?.balance!==undefined?{balance:prior.balance}:{}),...(prior?.syncedAt?{syncedAt:prior.syncedAt}:{})};}),verifiedAt:Date.now()});
    return null;
  }
});

const transaction=v.object({id:v.string(),accountId:v.string(),date:v.string(),description:v.string(),counterparty:v.string(),amount:v.number(),currency:v.string(),direction:v.union(v.literal("in"),v.literal("out")),status:v.union(v.literal("posted"),v.literal("settled"),v.literal("pending"),v.literal("voided")),reference:v.optional(v.string()),cardLastFour:v.optional(v.string())});
export const ingest = mutation({
  args:{...auth,transactions:v.array(transaction)},returns:v.null(),
  handler:async(ctx,a)=>{
    const state=await feed(ctx,a);
    if(!state.verifiedAt || state.verifiedAt<Date.now()-26*60*60_000) throw new ConvexError("LMD ownership verification expired");
    if(a.transactions.length>50) throw new ConvexError("Revolut transaction batch is too large");
    for(const row of a.transactions){
      const account=state.accounts.find(x=>x.id===row.accountId);
      if(!account || account.currency!==row.currency || !Number.isFinite(row.amount) || row.amount<0 || !/^\d{4}-\d{2}-\d{2}/.test(row.date)) throw new ConvexError("Transaction does not match a verified LMD account");
      await saveRevolutStatementRow(ctx,row,"lovemedo");
    }
    await ctx.db.patch(state._id,{leaseUntil:Date.now()+5*60_000});
    return null;
  }
});

export const finish = mutation({
  args:{...auth,checkpoint:v.union(v.string(),v.null()),accounts:v.array(v.object({id:v.string(),currency:v.string(),balance:v.number()}))},returns:v.null(),
  handler:async(ctx,a)=>{
    const state=await feed(ctx,a), now=Date.now();
    if(!a.accounts.length || new Set(a.accounts.map(x=>x.id)).size!==a.accounts.length || a.accounts.length!==state.accounts.length || a.accounts.some(x=>!Number.isFinite(x.balance)||!state.accounts.some(s=>s.id===x.id&&s.currency===x.currency))) throw new ConvexError("Incomplete LMD account balance snapshot");
    if(a.checkpoint){const cursor=decodeBankSyncCheckpoint(a.checkpoint,"revolut");if(cursor.windowStart.slice(0,10)!==state.fromDate || cursor.windowEnd.slice(0,10)!==state.toDate)throw new ConvexError("Revolut checkpoint window mismatch");}
    await ctx.db.patch(state._id,{
      checkpoint:a.checkpoint,leaseUntil:0,nextRunAt:now+(a.checkpoint?60_000:15*60_000),error:undefined,
      accounts:state.accounts.map(x=>({...x,balance:a.accounts.find(s=>s.id===x.id)!.balance,syncedAt:new Date(now).toISOString()})),
      ...(!a.checkpoint?{lastSyncedAt:now,coverageThrough:new Date(now).toISOString(),...(state.full?{lastFullAt:now,coverageFrom:state.fromDate}:{})}:{})
    });
    return null;
  }
});

export const failed = mutation({
  args:{...auth,error:v.string(),retryAt:v.optional(v.number())},returns:v.null(),handler:async(ctx,a)=>{
    const state=await feed(ctx,a);
    await ctx.db.patch(state._id,{leaseUntil:0,nextRunAt:Math.max(Date.now()+60*60_000,Number.isFinite(a.retryAt)?a.retryAt!:0),error:a.error.slice(0,200),verifiedAt:0});
    return null;
  }
});

// Operator reconciliation queues history without deleting saved records or bypassing a live lease/cooldown.
export const reconcile = mutation({args:{serviceToken:v.string()},returns:v.null(),handler:async(ctx,a)=>{
  service(a.serviceToken);
  const state=await ctx.db.query("statementRevolutFeeds").withIndex("by_key",q=>q.eq("key","lmd")).unique();
  if(state){if(state.leaseUntil>Date.now())throw new ConvexError("Revolut sync is running");await ctx.db.patch(state._id,{checkpoint:null,lastFullAt:0});}
  return null;
}});
