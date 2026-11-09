import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { statementPermissions } from "../shared/statements";
process.env.CONVEX_SERVICE_TOKEN = "revolut-test";
const auth={serviceToken:"revolut-test",actor:"Ali"};
const modules={"../convex/_generated/server.ts":()=>import("../convex/_generated/server"),"../convex/statementRevolut.ts":()=>import("../convex/statementRevolut")};

test("saved Revolut imports isolate verified companies, deduplicate and preserve corrections for review",async()=>{
 const t=convexTest(schema,modules);
 const bankId=await t.run(async ctx=>{
  await ctx.db.insert("statementMembers",{actor:"Ali",companyIds:["lovemedo","digital-nudge"],manage:true,permissions:[...statementPermissions]});
  return ctx.db.insert("bankTransactions",{id:"tx-1",source:"revolut",connectionKey:"connection",accountId:"revolut-a",accountName:"Main",date:"2026-10-01",description:"Test",rawName:"Vendor",counterparty:"Vendor",amount:12.34,currency:"EUR",direction:"out",status:"posted",category:"Other",syncedAt:"2026-11-01T00:00:00Z"});
 });
 const lease={serviceToken:auth.serviceToken,connectionKey:"connection",token:"one"};
 assert.equal(await t.mutation(api.statementRevolut.discoveryLease,lease),true);
 assert.equal(await t.mutation(api.statementRevolut.discoveryLease,{...lease,token:"two"}),false);
 await t.mutation(api.statementRevolut.discovered,{...lease,accounts:[{id:"revolut-a",name:"Main",currency:"EUR",beneficiaries:["LoveMeDo B.V."]}]});
 await t.mutation(internal.statementRevolut.pump,{});
 await t.mutation(internal.statementRevolut.pump,{});
 let rows=await t.run(ctx=>ctx.db.query("statementTransactions").collect());
 assert.equal(rows.length,1);assert.equal(rows[0].companyId,"lovemedo");assert.equal(rows[0].financialAccountId,"revolut-lmd");assert.equal(rows[0].amountMinor,"1234");
 assert.equal(JSON.parse(await t.query(api.statementRevolut.status,{...auth,companyId:"digital-nudge"})).accounts.length,0);
 await t.run(async ctx=>{await ctx.db.patch(bankId,{amount:15,syncedAt:new Date().toISOString()});});
 await t.mutation(internal.statementRevolut.pump,{});
 rows=await t.run(ctx=>ctx.db.query("statementTransactions").collect());
 assert.equal(rows.length,1);assert.equal(rows[0].amountMinor,"1234");assert.equal(JSON.parse(rows[0].sourceCorrectionJson!).amountMinor,"1500");assert.equal(rows[0].reviewState,"unresolved");assert.equal(rows[0].financialRevision,2);
 await assert.rejects(t.query(api.statementRevolut.status,{...auth,actor:"Alaa",companyId:"lovemedo"}));
});

test("newly verified accounts backfill saved history and removed accounts cease importing",async()=>{
 const t=convexTest(schema,modules),lease={serviceToken:auth.serviceToken,connectionKey:"connection",token:"one"};
 await t.mutation(api.statementRevolut.discoveryLease,lease);
 await t.mutation(api.statementRevolut.discovered,{...lease,accounts:[{id:"a",name:"Main",currency:"EUR",beneficiaries:[]}]});
 await t.run(async ctx=>{const s=(await ctx.db.query("statementRevolutState").collect())[0];await ctx.db.patch(s._id,{discoveredAt:1,scanSince:"2026-11-09",leaseUntil:Date.now()+60000,token:"two"});});
 await t.mutation(api.statementRevolut.discovered,{...lease,token:"two",accounts:[{id:"a",name:"Main",currency:"EUR",beneficiaries:["Digital Nudge OU"]}]});
 assert.equal((await t.run(ctx=>ctx.db.query("statementRevolutState").collect()))[0].scanSince,"");
 await t.run(async ctx=>{const s=(await ctx.db.query("statementRevolutState").collect())[0];await ctx.db.patch(s._id,{discoveredAt:1,leaseUntil:Date.now()+60000,token:"three"});await ctx.db.insert("statementMembers",{actor:"Ali",companyIds:["digital-nudge"],manage:true,permissions:[...statementPermissions]});});
 await t.mutation(api.statementRevolut.discovered,{...lease,token:"three",accounts:[{id:"b",name:"Unknown",currency:"EUR",beneficiaries:[]}]});
 assert.equal(JSON.parse(await t.query(api.statementRevolut.status,{...auth,companyId:"digital-nudge"})).accounts.length,0);
});
