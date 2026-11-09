import assert from "node:assert/strict";
import test from "node:test";
import { exactWorkspaceCompany } from "./exactWorkspace";
import { revolutOwnerCompany } from "./statementRevolut";
import { RompslompError, rompslompList, rompslompRow } from "./rompslomp";

test("accounting ownership requires a verified legal name, never an account nickname", () => {
  assert.equal(exactWorkspaceCompany("AR-TEC Engineering & Innovations B.V."), "artec");
  assert.equal(exactWorkspaceCompany("AMG-Holding B.V."), "amg-holding");
  assert.equal(exactWorkspaceCompany("LoveMeDo B.V."), "lovemedo");
  assert.equal(exactWorkspaceCompany("AMG Client"), undefined);
  assert.equal(revolutOwnerCompany(["LoveMeDo B.V."]), "lovemedo");
  assert.equal(revolutOwnerCompany(["Digital Nudge OÜ"]), "digital-nudge");
  assert.equal(revolutOwnerCompany(["Main EUR"]), undefined);
  assert.equal(revolutOwnerCompany(["LoveMeDo B.V.", "Another owner"]), undefined);
  assert.equal(revolutOwnerCompany([]), undefined);
});

test("Rompslomp preserves exact expense totals and uses EUR accounting amounts", () => {
  const row = rompslompRow({ id: 1, date: "2026-11-01", currency: "USD", cached_contact: { name: "Supplier" }, invoice_lines: [{price_with_vat:"0.1"},{price_with_vat:"0.2"},{price_with_vat:"-0.05"}] }, "expenses");
  assert.equal(row.amount, "0.25000000"); assert.equal(row.currency, "EUR"); assert.equal(row.contact, "Supplier");
  assert.throws(()=>rompslompRow({id:1,date:"2026-11-01",invoice_lines:[{}]},"expenses"),/Missing expense/);
});

test("Rompslomp pagination rejects missing pages and changing totals", async () => {
  const items=Array.from({length:100},(_,id)=>({id}));
  let calls=0;
  const fetcher=(async()=>Response.json({expenses:++calls===1?items:[{id:100}]},{headers:{"X-Total":"101","X-Page":String(calls)}})) as typeof fetch;
  assert.equal((await rompslompList("test","companies/1/expenses","expenses",{},fetcher)).length,101);
  await assert.rejects(rompslompList("test","companies","companies",{},async()=>Response.json({companies:[]})),/pagination/);
  await assert.rejects(rompslompList("test","companies","companies",{},async()=>Response.json({companies:[{id:1}]},{headers:{"X-Total":"2","X-Page":"1"}})),/Incomplete/);
  await assert.rejects(rompslompList("test","companies","companies",{},async()=>Response.json({companies:[{id:1},{id:1}]},{headers:{"X-Total":"2","X-Page":"1"}})),/Duplicate/);
  await assert.rejects(rompslompList("test","companies","companies",{},async()=>new Response(null,{status:429,headers:{"Retry-After":"7200"}})),e=>e instanceof RompslompError&&e.retryAfterMs===7200000);
});
