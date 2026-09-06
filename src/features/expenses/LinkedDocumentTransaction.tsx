import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUrlState } from "@/lib/url-state";
import type { ExpenseRecord, Invoice, Transaction } from "../../../shared/types";

export function LinkedDocumentTransaction({ apiBase, invoices, expenses }: { apiBase: string; invoices: Invoice[]; expenses: ExpenseRecord[] }) {
  const [id, setId] = useUrlState("documentTransaction", "");
  const [transaction, setTransaction] = useState<Transaction | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController(); setTransaction(null); setError("");
    void fetch(`${apiBase}/transactions/lookup?id=${encodeURIComponent(id)}`, { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error("Could not load the linked transaction"); const row = await response.json() as Transaction | null; if (!row) throw new Error("This bank transaction is unavailable"); if (!controller.signal.aborted) setTransaction(row); }).catch(err => { if (!controller.signal.aborted) setError(String(err)); });
    return () => controller.abort();
  }, [apiBase, id]);
  if (!id) return null;
  const invoice = invoices.find(i => i.id === transaction?.matchedInvoiceId || i.transactionId === id);
  const expense = expenses.find(e => e.transactionId === id);
  return <section className="panel linked-document-transaction" aria-label="Linked bank transaction"><div className="panel-header"><h2>Linked bank transaction</h2><Button onClick={() => setId("")}>Close</Button></div>
    {error ? <p role="alert" className="inline-error">{error}</p> : !transaction ? <p role="status">Loading transaction…</p> : <><dl className="document-transaction-details"><div><dt>Counterparty</dt><dd>{transaction.counterparty}</dd></div><div><dt>Amount</dt><dd>{transaction.direction === "out" ? "−" : "+"}{new Intl.NumberFormat(undefined, { style: "currency", currency: transaction.currency }).format(transaction.amount)}</dd></div><div><dt>Date</dt><dd>{transaction.date}</dd></div><div><dt>Bank account</dt><dd>{transaction.accountName}</dd></div><div><dt>Status</dt><dd>{transaction.status}</dd></div></dl><p>{transaction.description}</p>
    {invoice && <a href={`?page=invoices&invoiceTab=all&invoiceQuery=${encodeURIComponent(invoice.invoiceNumber)}`}>Invoice {invoice.invoiceNumber} · {invoice.status}</a>}{expense && <a href={`?page=expenses&expenseQuery=${encodeURIComponent(expense.recordNumber)}`}>Expense {expense.recordNumber} · {expense.paymentStatus}</a>}
    </>}
  </section>;
}
