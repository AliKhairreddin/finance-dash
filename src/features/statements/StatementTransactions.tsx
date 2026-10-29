import { useStatementAccounts } from "./StatementAccountContext";
import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { statementCompanies, statementAccounts, statementContext, statementWorkspaces, statementAmountDecimal, type StatementRow, type StatementTransaction as SharedStatementTransaction } from "../../../shared/statements";
import { ErrorMessage, SelectField, StatementModal, SubmitButton, jsonRequest, statementRequest } from "./StatementUi";

export interface TransactionDraft {
  companyId: string; financialAccountId: string; date: string; description: string; counterparty: string; reference: string;
  source: string; account: string; providerId: string; cardLastFour: string; amount: string; currency: string;
  direction: "in" | "out"; notes: string; fee: string; balance: string;
}
export type StatementTransaction = SharedStatementTransaction & { deletedAt?: string };
export const companyName = (id?: string,accounts:Array<{id:string;name:string}>=[]) => [...accounts,...statementCompanies, ...statementAccounts].find(company => company.id === id)?.name || "No company";
export const companyOptions = [{ value: "", label: "No company — choose later" }, ...statementCompanies.map(company => ({ value: company.id, label: company.name }))];
export const decimalAmount = statementAmountDecimal;
export function displayAmount(minor: string, currency: string): string {
  const decimal = decimalAmount(minor, currency);
  const [integer, fraction] = decimal.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""} ${currency}`;
}
export const blankDraft = (companyId = ""): TransactionDraft => ({ companyId: statementContext(companyId).companyId || "", financialAccountId: statementContext(companyId).financialAccountId || "", date: new Date().toLocaleDateString("en-CA"), description: "", counterparty: "", reference: "", source: "Manual", account: "", providerId: "", cardLastFour: "", amount: "", currency: "EUR", direction: "out", notes: "", fee: "", balance: "" });
export const transactionDraft = (row: StatementRow): TransactionDraft => ({
  companyId: row.companyId || "", financialAccountId: row.financialAccountId || "", date: row.date, description: row.description, counterparty: row.counterparty || "", reference: row.reference || "", source: row.source,
  account: row.account || "", providerId: row.providerId || "", cardLastFour: row.cardLastFour || "", amount: decimalAmount(row.amountMinor, row.currency), currency: row.currency, direction: row.direction, notes: row.notes || "", fee: row.feeMinor ? decimalAmount(row.feeMinor, row.currency) : "", balance: row.balanceMinor ? decimalAmount(row.balanceMinor, row.currency) : ""
});
export function transactionPayload(draft: TransactionDraft) {
  return { ...draft, companyId: draft.companyId || undefined, financialAccountId: draft.financialAccountId || undefined, providerId: draft.providerId || undefined, cardLastFour: draft.cardLastFour || undefined };
}

export function TransactionFields({ draft, onChange, disabled = false }: { draft: TransactionDraft; onChange: (draft: TransactionDraft) => void; disabled?: boolean }) {
  const edit = (field: keyof TransactionDraft, value: string) => onChange({ ...draft, [field]: value });
  const accounts=useStatementAccounts();
  return <fieldset className="statement-fields" disabled={disabled}>
    <SelectField label="Company" value={draft.companyId} options={companyOptions} onChange={value => onChange({ ...draft, companyId: value, financialAccountId: "" })} disabled={disabled} />
    <SelectField label="Financial account" value={draft.financialAccountId} onChange={value => edit("financialAccountId", value)} options={[{ value: "", label: "Unresolved account" }, ...accounts.filter(a => a.companyId === draft.companyId).map(a => ({ value: a.id, label: a.name }))]} />
    <label>Date<Input type="date" required value={draft.date} onChange={event => edit("date", event.target.value)} /></label>
    <label>Amount<Input inputMode="decimal" required pattern="[0-9]+([.,][0-9]+)?" placeholder="0.00" value={draft.amount} onChange={event => edit("amount", event.target.value.replace(",", "."))} /></label>
    <label>Currency<Input required pattern="[A-Z]{3,4}" maxLength={4} value={draft.currency} onChange={event => edit("currency", event.target.value.toUpperCase())} /></label>
    <SelectField label="Direction" value={draft.direction} onChange={value => edit("direction", value)} options={[{ value: "out", label: "Money out" }, { value: "in", label: "Money in" }]} disabled={disabled} />
    <label>Paid to / received from<Input value={draft.counterparty} onChange={event => edit("counterparty", event.target.value)} /></label>
    <label className="statement-field-span">Description<Input required value={draft.description} onChange={event => edit("description", event.target.value)} /></label>
    <label>Reference<Input value={draft.reference} onChange={event => edit("reference", event.target.value)} /></label>
    <label>Bank or payment service<Input required value={draft.source} placeholder="Bank, card, or cash" onChange={event => edit("source", event.target.value)} /></label>
    <label>Account<Input value={draft.account} onChange={event => edit("account", event.target.value)} /></label>
    <label>Last 4 card digits<Input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={draft.cardLastFour} onChange={event => edit("cardLastFour", event.target.value)} /></label>
    <details className="statement-field-full statement-extra-fields"><summary>More details</summary><div className="statement-fields"><label>Bank transaction ID<Input value={draft.providerId} onChange={event => edit("providerId", event.target.value)} /></label><label>Fee<Input inputMode="decimal" value={draft.fee} onChange={event => edit("fee", event.target.value)} /></label><label>Balance<Input inputMode="decimal" value={draft.balance} onChange={event => edit("balance", event.target.value)} /></label><label className="statement-field-full">Notes<Textarea rows={2} value={draft.notes} onChange={event => edit("notes", event.target.value)} /></label></div></details>
  </fieldset>;
}

export function ManualTransactions({ companyId, copy, onClose, onSaved }: { companyId?: string; copy?: StatementTransaction; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<TransactionDraft[]>([copy ? { ...transactionDraft(copy), providerId: "", reference: "" } : blankDraft(companyId)]);
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <StatementModal title={copy ? "Copy transaction" : "Add transactions"} onClose={onClose} busy={busy} wide>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      try { await statementRequest("/transactions", jsonRequest("POST", { rows: rows.map(transactionPayload), requestId })); onSaved(); onClose(); }
      catch (err) { setError(err instanceof Error ? err.message : "Transactions could not be saved"); } finally { setBusy(false); }
    }}>
      <div className="statement-entry-rows">{rows.map((row, index) => <section className="statement-entry" key={index}>
        <div className="statement-entry-heading"><strong>Transaction {index + 1}</strong><div className="row-actions"><Button variant="ghost" size="icon" type="button" aria-label={`Copy transaction ${index + 1}`} disabled={busy || rows.length >= 50} onClick={() => setRows(current => [...current, { ...row, providerId: "", reference: "" }])}><Copy size={15} /></Button>{rows.length > 1 && <Button variant="ghost" size="icon" type="button" aria-label={`Remove transaction ${index + 1}`} disabled={busy} onClick={() => setRows(current => current.filter((_, i) => i !== index))}><Trash2 size={15} /></Button>}</div></div>
        <TransactionFields draft={row} disabled={busy} onChange={draft => setRows(current => current.map((item, i) => i === index ? draft : item))} />
      </section>)}</div>
      <ErrorMessage error={error} />
      <div className="statement-dialog-footer"><Button variant="outline" type="button" disabled={busy || rows.length >= 50} onClick={() => setRows(current => [...current, blankDraft(companyId)])}><Plus size={15} />Add row</Button><div className="row-actions"><InfoPopover label="Manual transaction validation">These entries join your other transactions. Choose a company before marking them checked. Two transactions with the same date and amount are not always the same payment.</InfoPopover><SubmitButton busy={busy}>Save {rows.length === 1 ? "transaction" : `${rows.length} transactions`}</SubmitButton></div></div>
    </form>
  </StatementModal>;
}
