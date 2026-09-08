import assert from "node:assert/strict";
import test from "node:test";
import { manualReceivableFromPayload, validateOpenItemDeletion } from "./manualReceivables";
import type { Invoice } from "./types";
const invoice = { id: "i", invoiceNumber: "INV-1", status:"draft", origin:"manual", meritDeliveryStatus:"not-sent", revenueRunIds:[] } as unknown as Invoice;
test("manual receivable editing keeps identity and validates dates and values",()=>{
  const row=manualReceivableFromPayload({name:"  Client ",amount:12.345,currency:"usd",notes:"  note ",dueDate:"2026-09-08"},"r");
  assert.deepEqual(row,{id:"r",name:"Client",balance:12.35,currency:"USD",notes:"note",dueDate:"2026-09-08",source:"manual"});
  for(const patch of [{amount:0},{amount:NaN},{dueDate:"2026-02-30"},{name:""}]) assert.throws(()=>manualReceivableFromPayload({name:"Client",amount:10,currency:"USD",...patch},"r"));
});
test("mixed open-item deletion validates the whole batch and protects linked invoices",()=>{
 const manual=manualReceivableFromPayload({name:"Commission",amount:10,currency:"USD"},"r");
 assert.deepEqual([...validateOpenItemDeletion(["i","r"],[invoice],[manual],[])],["i","r"]);
 assert.deepEqual([...validateOpenItemDeletion(["i"],[{...invoice,status:"open"}],[],[])],["i"]);
 for(const bad of [{...invoice,externalId:"merit-1"},{...invoice,transactionId:"t"},{...invoice,status:"paid" as const},{...invoice,origin:"revenue" as const}]) assert.throws(()=>validateOpenItemDeletion(["r","i"],[bad],[manual],[]));
 assert.throws(()=>validateOpenItemDeletion(["r","missing"],[invoice],[manual],[]));
 assert.throws(()=>validateOpenItemDeletion(["r","r"],[],[manual],[]));
});
