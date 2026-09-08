import assert from "node:assert/strict";
import test from "node:test";
import { pendingInvoices } from "./pendingInvoices";
import type { Invoice, PaymentAllocation } from "./types";
test("pending invoices include drafts and partial balances, excluding paid, settled and supplier bills",()=>{
 const base={id:"a",documentType:"sales_invoice",invoiceNumber:"1",dueDate:"2026-09-10",status:"open",amount:100,currency:"USD"} as Invoice;
 const invoices=[base,{...base,id:"b",invoiceNumber:"2",dueDate:"2026-09-09",status:"draft" as const},{...base,id:"paid",status:"paid" as const},{...base,id:"bill",documentType:"supplier_bill" as const},{...base,id:"settled"}];
 const payments=[{invoiceId:"a",amount:40,currency:"USD"},{invoiceId:"settled",amount:100,currency:"USD"}] as PaymentAllocation[];
 assert.deepEqual(pendingInvoices(invoices,payments).map(row=>[row.invoice.id,row.outstanding]),[["b",100],["a",60]]);
});
