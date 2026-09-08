import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramSlashReport, slashReportDateIfDue } from "./telegramSlashReport";
import type { SlashTransaction, SlashVirtualAccountBalance } from "../shared/slashApi";
const asOf=Date.parse("2026-09-08T14:00:00Z");
const account={id:"va",name:"Primary",balance:9000,currency:"USD",accountId:"a",accountType:"primary"} as SlashVirtualAccountBalance;
const charge={id:"charge",date:"2026-09-08T13:00:00Z",description:"Meta",amountCents:-20000,accountId:"a",accountSubtype:"credit",virtualAccountId:"va",cardId:"c",status:"posted"} as SlashTransaction;
test("daily report becomes due at 17:00 Beirut in summer and winter, on every weekday",()=>{
 for(const [before,due] of [["2026-09-08T13:59:59Z","2026-09-08T14:00:00Z"],["2026-01-04T14:59:59Z","2026-01-04T15:00:00Z"],["2026-03-29T13:59:59Z","2026-03-29T14:00:00Z"],["2026-10-25T14:59:59Z","2026-10-25T15:00:00Z"]]) {
  assert.equal(slashReportDateIfDue(Date.parse(before)),null);assert.equal(slashReportDateIfDue(Date.parse(due)),due.slice(0,10));
 }
});
test("funding report separates posted, pending and refunds and excludes repayments, duplicates and out-of-window activity",()=>{
 const report=buildTelegramSlashReport({accounts:[account],asOf,reserveUsd:10000,transactions:[charge,charge,{...charge,id:"pending",status:"pending",amountCents:-5000},{...charge,id:"refund",amountCents:2500},{...charge,id:"old",date:"2026-09-07T14:00:00Z"},{...charge,id:"future",date:"2026-09-08T14:01:00Z"},{...charge,id:"failed",status:"failed"},{...charge,id:"repayment",cardId:undefined,amountCents:-100000}]});
 assert.match(report,/Last 24h card spend: \$200.00/);assert.match(report,/Pending card spend: \$50.00/);assert.match(report,/Posted card refunds: \$25.00/);assert.match(report,/Suggested total transfer: \$1,250.00/);
});
test("unknown account attribution and missing balances prevent a misleading funding total",()=>{
 assert.throws(()=>buildTelegramSlashReport({accounts:[],transactions:[],asOf,reserveUsd:10000}));
 const report=buildTelegramSlashReport({accounts:[account],transactions:[{...charge,virtualAccountId:undefined}],asOf,reserveUsd:10000});
 assert.match(report,/recommendation unavailable/);assert.doesNotMatch(report,/Suggested total transfer:/);
});
