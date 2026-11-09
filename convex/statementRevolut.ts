import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { statementMember, requireScope } from "./statementAccess";
import { revolutOwnerCompany } from "../shared/statementRevolut";
import { statementAmountMinor, statementCandidateKey, statementIdentity, type StatementRow } from "../shared/statements";
const service = (token: string) => { if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized"); };
export const discoveryLease = mutation({ args: { serviceToken: v.string(), connectionKey: v.string(), token: v.string() }, returns: v.boolean(), handler: async (ctx, a) => {
  service(a.serviceToken);
  const old = await ctx.db.query("statementRevolutState").withIndex("by_connection", q => q.eq("connectionKey", a.connectionKey)).unique();
  if (old && (old.leaseUntil > Date.now() || old.discoveredAt > Date.now() - 24 * 3600000 || old.retryAt > Date.now())) return false;
  if (old) await ctx.db.patch(old._id, { token: a.token, leaseUntil: Date.now()+120000 });
  else await ctx.db.insert("statementRevolutState", { connectionKey:a.connectionKey, token:a.token,leaseUntil:Date.now()+120000,discoveredAt:0,retryAt:0,scanSince:"",scanUntil:"",scanCursor:null });
  return true;
}});
export const discovered = mutation({args:{serviceToken:v.string(),connectionKey:v.string(),token:v.string(),error:v.optional(v.string()),accounts:v.array(v.object({id:v.string(),name:v.string(),currency:v.string(),beneficiaries:v.array(v.string())}))},returns:v.null(),handler:async(ctx,a)=>{
  service(a.serviceToken);const state=await ctx.db.query("statementRevolutState").withIndex("by_connection",q=>q.eq("connectionKey",a.connectionKey)).unique();
  if(!state || state.token!==a.token || state.leaseUntil<Date.now())throw new ConvexError("Discovery expired");
  if(a.error){await ctx.db.patch(state._id,{error:a.error,leaseUntil:0,retryAt:Date.now()+3600000});return null;}
  if(!a.accounts.length || a.accounts.length>1000 || new Set(a.accounts.map(r=>r.id)).size!==a.accounts.length)throw new ConvexError("Incomplete account directory");
  const verifiedAt=Date.now(); let backfill=false;
  for(const account of a.accounts){
    const old=await ctx.db.query("statementRevolutAccounts").withIndex("by_account",q=>q.eq("accountId",account.id)).unique();
    const companyId=revolutOwnerCompany(account.beneficiaries);
    if(old?.companyId && old.companyId!==companyId)throw new ConvexError("Revolut ownership changed; review connection before importing");
    if(companyId && old?.companyId!==companyId)backfill=true;
    const fields={accountId:account.id,connectionKey:a.connectionKey,name:account.name,currency:account.currency,beneficiaries:account.beneficiaries,companyId,verifiedAt};
    if(old)await ctx.db.patch(old._id,fields);else await ctx.db.insert("statementRevolutAccounts",fields);
  }
  const currentIds=new Set(a.accounts.map(account=>account.id));
  for(const old of await ctx.db.query("statementRevolutAccounts").withIndex("by_connection",q=>q.eq("connectionKey",a.connectionKey)).take(1000))if(!currentIds.has(old.accountId))await ctx.db.delete(old._id);
  await ctx.db.patch(state._id,{discoveredAt:verifiedAt,error:undefined,leaseUntil:0,retryAt:0,...(backfill?{scanSince:"",scanUntil:"",scanCursor:null}:{})});return null;
}});
export const status=query({args:{serviceToken:v.string(),actor:v.string(),companyId:v.union(v.literal("lovemedo"),v.literal("digital-nudge"))},returns:v.string(),handler:async(ctx,a)=>{
 const member=await statementMember(ctx,a);requireScope(member,{companyId:a.companyId,...(a.companyId==="lovemedo"?{financialAccountId:"revolut-lmd"}:{})});
 const rows=await ctx.db.query("statementRevolutAccounts").withIndex("by_company",q=>q.eq("companyId",a.companyId)).take(1000);
 const states=await ctx.db.query("statementRevolutState").take(5);
 const accounts=await Promise.all(rows.filter(row=>states.some(s=>s.connectionKey===row.connectionKey&&s.discoveredAt===row.verifiedAt&&!s.error)).map(async row=>{const saved=await ctx.db.query("bankAccounts").withIndex("by_account_id",q=>q.eq("id",row.accountId)).unique();return {id:row.accountId,name:row.name,currency:row.currency,owner:row.beneficiaries.join(" / "),balance:saved?.connectionKey===row.connectionKey?saved.balance:null,syncedAt:saved?.syncedAt??null};}));
 return JSON.stringify({accounts,discoveredAt:Math.max(0,...states.map(s=>s.discoveredAt)),error:states.map(s=>s.error).filter(Boolean).join("; "),importedThrough:states.map(s=>s.scanSince).filter(Boolean).sort()[0]??null});
}});
export const pump=internalMutation({args:{},returns:v.null(),handler:async(ctx)=>{
 const states=await ctx.db.query("statementRevolutState").take(5);
 for(const state of states){
  if(state.error || !state.discoveredAt || state.discoveredAt<Date.now()-26*3600000)continue;
  const mappings=await ctx.db.query("statementRevolutAccounts").withIndex("by_connection",q=>q.eq("connectionKey",state.connectionKey)).take(1000);
  const until=state.scanUntil||new Date().toISOString();
  const page=await ctx.db.query("bankTransactions").withIndex("by_source_connection_synced",q=>q.eq("source","revolut").eq("connectionKey",state.connectionKey).gte("syncedAt",state.scanSince).lte("syncedAt",until)).paginate({cursor:state.scanCursor,numItems:50});
  for(const bank of page.page){
   const mapping=mappings.find(m=>m.accountId===bank.accountId&&m.verifiedAt===state.discoveredAt);if(!mapping?.companyId)continue;
   const row:StatementRow={companyId:mapping.companyId,...(mapping.companyId==="lovemedo"?{financialAccountId:"revolut-lmd"}:{}),date:bank.date.slice(0,10),description:bank.description,counterparty:bank.counterparty,source:"Revolut",account:bank.accountId,providerId:bank.id,amountMinor:statementAmountMinor(String(Math.abs(bank.amount)),bank.currency),currency:bank.currency,direction:bank.direction,reviewReasons:[],...(bank.reference?{reference:bank.reference}:{}),...(bank.cardLastFour?{cardLastFour:bank.cardLastFour}:{})};
   const identity=statementIdentity(row)!,snapshot=JSON.stringify({...row,status:bank.status});
   const old=await ctx.db.query("statementTransactions").withIndex("by_identity",q=>q.eq("identity",identity)).unique();
   if(old){if(old.sourceSnapshot && old.sourceSnapshot!==snapshot){const links=await ctx.db.query("statementInvoiceTransactions").withIndex("by_transaction",q=>q.eq("transactionId",old._id)).take(201);
    if(links.length>200)throw new ConvexError("Review document history before applying source correction");
    for(const link of links){const invoice=await ctx.db.get(link.invoiceId);if(invoice&&!['discarded','cancelled','superseded'].includes(invoice.state)){await ctx.db.patch(invoice._id,{state:"stale",updatedAt:Date.now()});for(const doc of await ctx.db.query("statementDocuments").withIndex("by_generatedInvoiceId",q=>q.eq("generatedInvoiceId",invoice._id)).take(2))await ctx.db.patch(doc._id,{status:"needs_review",error:"Revolut source changed; review transaction and regenerate. Original PDF retained."});}}
    await ctx.db.patch(old._id,{status:"pending",completedAt:undefined,completedBy:undefined,completionReason:undefined,doneAt:undefined,doneBy:undefined,financialRevision:(old.financialRevision??old.revision)+1,...(old.generatedInvoiceId?{documentState:"stale",generatedInvoiceState:undefined}:{}),sourceSnapshot:snapshot,sourceCorrectionJson:snapshot,reviewState:"unresolved",reviewReasons:[...new Set([...old.reviewReasons,"Revolut source changed. Review the correction before using this transaction."])],updatedAt:new Date().toISOString(),revision:old.revision+1});}continue;}
   if(!["posted","settled"].includes(bank.status))continue;
   const candidateKey=statementCandidateKey(row),candidates=await ctx.db.query("statementTransactions").withIndex("by_candidateKey",q=>q.eq("candidateKey",candidateKey)).take(1);
   const reasons=candidates.length?["Possible overlap with an existing statement import; review both records"]:[];
   await ctx.db.insert("statementTransactions",{...row,reviewReasons:reasons,identity,candidateKey,intakeKey:`revolut:${bank.id}`,origin:"api",status:"pending",reviewState:reasons.length?"unresolved":"pending",documentState:"missing",financialRevision:1,documentIds:[],revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:"Revolut sync",sourceSnapshot:snapshot});
  }
  await ctx.db.patch(state._id,{scanCursor:page.isDone?null:page.continueCursor,scanUntil:page.isDone?"":until,...(page.isDone?{scanSince:until}:{})});
  if(!page.isDone)await ctx.scheduler.runAfter(1000,internal.statementRevolut.pump,{});
 }
 return null;
}});
