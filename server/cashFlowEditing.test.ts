import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { financeOperatingDate } from "../shared/operatingDate";
import type { SaveCashFlowSnapshotPayload } from "../shared/types";

test("section saves preserve other sections and notes, formulas survive reload, manual edits and batch deletion persist", async () => {
  const directory=await mkdtemp(join(tmpdir(),"finance-cash-test-"));
  const previous=process.cwd();
  try {
    process.chdir(directory); await mkdir('.local'); await writeFile('.local/finance-dashboard-store.json','{}');
    const store=await import('./store'); await store.initializeStore();
    const base: SaveCashFlowSnapshotPayload={asOfDate:financeOperatingDate(),cashAccounts:[{id:"cash",name:"Cash",amount:0,formula:"=100+25",currency:"USD",notes:"Deposit + refund"}],receivables:[],openBalances:[],payables:[{id:"pay",name:"Payable",amount:50,currency:"USD"}],investments:[],notes:"Report note"};
    const first=await store.saveCashFlowSnapshot(base);
    assert.equal(first.cashAccounts[0].amount,125);
    const second=await store.saveCashFlowSnapshot({...base,id:first.id,section:"payables",cashAccounts:[],notes:"Unsaved report edit",payables:[{...base.payables[0],amount:75}]});
    assert.equal(second.cashAccounts[0].amount,125);assert.equal(second.notes,"Report note");assert.equal(second.payables[0].amount,75);
    await store.initializeStore();const loaded=store.getSnapshot().cashFlowSnapshots.find(row=>row.id===first.id)!;
    assert.equal(loaded.cashAccounts[0].formula,"=100+25");assert.equal(loaded.cashAccounts[0].notes,"Deposit + refund");
    await assert.rejects(store.saveCashFlowSnapshot({...base,cashAccounts:[{...base.cashAccounts[0],formula:"=1/0"}]}),/divide by zero/);
    const manual=await store.createManualReceivable({name:"Test",amount:50,currency:"USD"});
    await store.updateManualReceivable(manual.id,{name:"Updated",amount:75,currency:"USD",notes:"Commission"});
    await store.initializeStore();assert.equal(store.getSnapshot().receivables.find(row=>row.id===manual.id)?.balance,75);
    await assert.rejects(store.deleteOpenItems([manual.id,"missing"]));
    assert.ok(store.getSnapshot().receivables.some(row=>row.id===manual.id));
    await store.deleteOpenItems([manual.id]);await store.initializeStore();assert.equal(store.getSnapshot().receivables.some(row=>row.id===manual.id),false);
  } finally { process.chdir(previous); await rm(directory,{recursive:true,force:true}); }
});
