import assert from "node:assert/strict";
import test from "node:test";
import {convexTest} from "convex-test";
import schema from "../convex/schema";
import {api,internal} from "../convex/_generated/api";
import {statementPermissions} from "../shared/statements";
process.env.CONVEX_SERVICE_TOKEN="rompslomp-test";
const auth={serviceToken:"rompslomp-test",actor:"Ali"};
const modules={"../convex/_generated/server.ts":()=>import("../convex/_generated/server"),"../convex/rompslomp.ts":()=>import("../convex/rompslomp")};
test("Rompslomp serializes refresh, preserves saved records on errors, and never exposes credentials",async()=>{
 const t=convexTest(schema,modules),snapshot=JSON.stringify([{id:"1",amount:"20.00"}]);
 await t.run(async ctx=>{
  await ctx.db.insert("statementMembers",{actor:"Ali",companyIds:["mzs-bouw"],manage:true,permissions:[...statementPermissions]});
  await ctx.db.insert("rompslompConnections",{companyId:"mzs-bouw",companyNumber:1,encryptedToken:"ciphertext-not-public",nextRunAt:0,leaseUntil:0,lastSyncedAt:123,lastFullAt:123,dataJson:snapshot});
 });
 assert.ok(await t.mutation(internal.rompslomp.claim,{token:"one"}));
 assert.equal(await t.mutation(internal.rompslomp.claim,{token:"two"}),null);
 await assert.rejects(t.mutation(internal.rompslomp.finish,{token:"two",full:false,dataJson:"[]"}),/expired/);
 await t.mutation(internal.rompslomp.finish,{token:"one",full:false,error:"Rate limited",retryMs:7200000});
 const saved=await t.query(api.rompslomp.saved,auth),data=JSON.parse(saved);
 assert.equal(data.lastSyncedAt,123);assert.deepEqual(data.rows,JSON.parse(snapshot));assert.equal(data.error,"Rate limited");assert.ok(!saved.includes("ciphertext"));
 assert.equal(await t.mutation(internal.rompslomp.claim,{token:"three"}),null);
 await assert.rejects(t.mutation(api.rompslomp.refresh,{...auth,full:true}),/retry is scheduled/);
 await assert.rejects(t.query(api.rompslomp.saved,{...auth,actor:"Alaa"}));
});
