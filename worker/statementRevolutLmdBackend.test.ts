import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { statementPermissions } from "../shared/statements";
import { encodeBankSyncCheckpoint } from "../shared/bankSyncCheckpoint";
import { lmdRevolutFetcher } from "./statementRevolutLmd";
import { RevolutApiError } from "../shared/revolutApi";

process.env.CONVEX_SERVICE_TOKEN="lmd-test";
const auth={serviceToken:"lmd-test",token:"one"};
const modules={"../convex/_generated/server.ts":()=>import("../convex/_generated/server"),"../convex/statementRevolut.ts":()=>import("../convex/statementRevolut"),"../convex/statementRevolutFeed.ts":()=>import("../convex/statementRevolutFeed")};
const account={id:"revolut-lmd-eur",name:"Main",currency:"EUR",beneficiaries:["LoveMeDo B.V."]};
const tx={id:"revolut-tx",accountId:account.id,date:"2026-11-01",description:"Supplier",counterparty:"Supplier",amount:12.34,currency:"EUR",direction:"out" as const,status:"posted" as const};

test("LMD honors long provider cooldowns without an immediate retry",async()=>{
 let calls=0;
 const fetcher=lmdRevolutFetcher(async()=>{calls++;return new Response("limited",{status:429,headers:{"Retry-After":"7200"}});});
 const before=Date.now();
 await assert.rejects(fetcher("https://b2b.revolut.com/api/1.0/accounts"),error=>error instanceof RevolutApiError&&error.status===429&&error.retryAt!>=before+7_200_000);
 assert.equal(calls,1);
 const t=convexTest(schema,modules);await t.mutation(api.statementRevolutFeed.acquire,auth);
 await t.mutation(api.statementRevolutFeed.failed,{...auth,error:"Rate limited",retryAt:before+7_200_000});
 const state=(await t.run(ctx=>ctx.db.query("statementRevolutFeeds").collect()))[0];assert.equal(state.nextRunAt,before+7_200_000);
});

test("LMD authorization requires verified ownership and never modifies Finance or DN",async()=>{
 const t=convexTest(schema,modules);
 await assert.rejects(t.mutation(api.statementRevolutFeed.acquire,{...auth,serviceToken:"bad"}));
 assert.ok(await t.mutation(api.statementRevolutFeed.acquire,auth));
 assert.equal(await t.mutation(api.statementRevolutFeed.acquire,{...auth,token:"concurrent"}),null);
 await assert.rejects(t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[tx]}));
 await assert.rejects(t.mutation(api.statementRevolutFeed.directory,{...auth,accounts:[{...account,beneficiaries:["Digital Nudge OU"]}]}));
 await t.mutation(api.statementRevolutFeed.directory,{...auth,accounts:[account]});
 await assert.rejects(t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[{...tx,accountId:"dn-account"}]}));
 await assert.rejects(t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[{...tx,currency:"USD"}]}));
 await t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[tx,tx,{...tx,id:"pending",status:"pending"}]});
 const rows=await t.run(ctx=>ctx.db.query("statementTransactions").collect());
 assert.equal(rows.length,1);assert.equal(rows[0].companyId,"lovemedo");assert.equal(rows[0].financialAccountId,"revolut-lmd");assert.equal(rows[0].amountMinor,"1234");
 assert.equal((await t.run(ctx=>ctx.db.query("bankTransactions").collect())).length,0);
 assert.equal((await t.run(ctx=>ctx.db.query("bankConnectionBindings").collect())).length,0);
});

test("incomplete pulls keep good balances and coverage; failed pulls retain imported rows",async()=>{
 const t=convexTest(schema,modules);
 await t.mutation(api.statementRevolutFeed.acquire,auth);
 await t.mutation(api.statementRevolutFeed.directory,{...auth,accounts:[account]});
 await t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[tx]});
 const accounts=[{id:account.id,currency:account.currency,balance:13882.04}];
 await t.mutation(api.statementRevolutFeed.finish,{...auth,accounts,checkpoint:null});
 await t.run(async ctx=>{const s=(await ctx.db.query("statementRevolutFeeds").collect())[0];await ctx.db.patch(s._id,{nextRunAt:0});});
 const lease=await t.mutation(api.statementRevolutFeed.acquire,auth);assert.ok(lease);assert.notEqual(lease.fromDate,"2015-01-01");
 const before=(await t.run(ctx=>ctx.db.query("statementRevolutFeeds").collect()))[0];
 await assert.rejects(t.mutation(api.statementRevolutFeed.finish,{...auth,accounts:[],checkpoint:null}));
 await t.mutation(api.statementRevolutFeed.failed,{...auth,error:"Rate limited"});
 const after=(await t.run(ctx=>ctx.db.query("statementRevolutFeeds").collect()))[0];
 assert.deepEqual(after.accounts,before.accounts);assert.equal(after.coverageThrough,before.coverageThrough);assert.equal(after.checkpoint,before.checkpoint);
 assert.equal(await t.mutation(api.statementRevolutFeed.acquire,auth),null);
 assert.equal((await t.run(ctx=>ctx.db.query("statementTransactions").collect())).length,1);
 await t.run(ctx=>ctx.db.insert("statementMembers",{actor:"Ali",companyIds:["lovemedo","digital-nudge"],accountIds:["revolut-lmd"],manage:true,permissions:[...statementPermissions]}));
 const lmd=JSON.parse(await t.query(api.statementRevolut.status,{serviceToken:auth.serviceToken,actor:"Ali",companyId:"lovemedo"}));
 assert.equal(lmd.accounts[0].balance,13882.04);assert.equal(lmd.error,"Rate limited");
 const dn=JSON.parse(await t.query(api.statementRevolut.status,{serviceToken:auth.serviceToken,actor:"Ali",companyId:"digital-nudge"}));
 assert.equal(dn.accounts.length,0);assert.equal(dn.error,"");
});

test("backfill resumes its cursor and marks coverage only after the complete window",async()=>{
 const t=convexTest(schema,modules);
 const lease=await t.mutation(api.statementRevolutFeed.acquire,auth);assert.ok(lease);
 await t.mutation(api.statementRevolutFeed.directory,{...auth,accounts:[account]});
 const checkpoint=encodeBankSyncCheckpoint({provider:"revolut",windowStart:`${lease.fromDate}T00:00:00.000Z`,windowEnd:`${lease.toDate}T23:59:59.999Z`,cursor:"cursor"});
 const accounts=[{id:account.id,currency:"EUR",balance:13}];
 await t.mutation(api.statementRevolutFeed.finish,{...auth,accounts,checkpoint});
 await t.run(async ctx=>{const s=(await ctx.db.query("statementRevolutFeeds").collect())[0];assert.equal(s.lastFullAt,0);assert.equal(s.coverageThrough,undefined);await ctx.db.patch(s._id,{nextRunAt:0});});
 const resumed=await t.mutation(api.statementRevolutFeed.acquire,{...auth,token:"two"});assert.equal(resumed?.checkpoint,checkpoint);
 await assert.rejects(t.mutation(api.statementRevolutFeed.finish,{...auth,accounts,checkpoint:null}));
 await t.mutation(api.statementRevolutFeed.finish,{...auth,token:"two",accounts,checkpoint:null});
 const done=(await t.run(ctx=>ctx.db.query("statementRevolutFeeds").collect()))[0];assert.ok(done.lastFullAt);assert.equal(done.coverageFrom,"2015-01-01");
 await t.mutation(api.statementRevolutFeed.reconcile,{serviceToken:auth.serviceToken});
 const queued=(await t.run(ctx=>ctx.db.query("statementRevolutFeeds").collect()))[0];assert.equal(queued.lastFullAt,0);assert.equal(queued.nextRunAt,done.nextRunAt);
});

test("provider corrections retain LMD's original amount and require review",async()=>{
 const t=convexTest(schema,modules);
 await t.mutation(api.statementRevolutFeed.acquire,auth);
 await t.mutation(api.statementRevolutFeed.directory,{...auth,accounts:[account]});
 await t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[tx]});
 await t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[{...tx,amount:20}]});
 await t.mutation(api.statementRevolutFeed.ingest,{...auth,transactions:[{...tx,amount:20}]});
 const rows=await t.run(ctx=>ctx.db.query("statementTransactions").collect());assert.equal(rows.length,1);assert.equal(rows[0].amountMinor,"1234");assert.equal(JSON.parse(rows[0].sourceCorrectionJson!).amountMinor,"2000");assert.equal(rows[0].revision,2);
});
