import {
  Check,
  CircleAlert,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  ReceiptText,
  ShieldAlert,
  Upload,
  X
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreateExpensePayload,
  DashboardSnapshot,
  ExpenseDocumentKind,
  ExpenseRecord,
  ExpenseVatTreatment,
  Provider,
  Transaction,
  UploadedExpenseDocumentPayload
} from "../../../shared/types";
import { matchingUnpaidSupplierBills } from "../../../shared/expenses";
import { transactionBusinessCategory, transactionCategoryOptionsForDirection } from "../../../shared/categories";

const acceptedDocumentTypes = "application/pdf,image/jpeg,image/png,image/webp";
const maximumDocumentBytes = 10 * 1024 * 1024;

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(amount);
}

function dateLabel(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}

function dueDateFrom(issueDate: string, days = 30): string {
  const date = new Date(`${issueDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function vatTreatmentLabel(value: ExpenseVatTreatment): string {
  const labels: Record<ExpenseVatTreatment, string> = {
    standard: "Standard VAT",
    reduced: "Reduced VAT",
    zero: "0% VAT",
    exempt: "VAT exempt",
    reverse_charge: "Reverse charge",
    not_applicable: "No input VAT recorded"
  };
  return labels[value];
}

function documentKindLabel(kind: ExpenseDocumentKind): string {
  if (kind === "vendor_invoice") return "Supplier invoice";
  if (kind === "vendor_receipt") return "Supplier receipt";
  return "Missing-document declaration";
}

function calculatedAmounts(grossAmount: number, treatment: ExpenseVatTreatment, vatRate: number): {
  netAmount: number;
  vatAmount: number;
} {
  if (
    !Number.isFinite(grossAmount)
    || grossAmount < 0
    || treatment === "not_applicable"
    || treatment === "zero"
    || treatment === "exempt"
    || treatment === "reverse_charge"
  ) {
    return { netAmount: Number.isFinite(grossAmount) ? grossAmount : 0, vatAmount: 0 };
  }
  const netAmount = grossAmount / (1 + vatRate / 100);
  return {
    netAmount: Number(netAmount.toFixed(2)),
    vatAmount: Number((grossAmount - netAmount).toFixed(2))
  };
}

async function uploadExpenseDocument(
  apiBase: string,
  file: File,
  kind: Extract<ExpenseDocumentKind, "vendor_invoice" | "vendor_receipt">
): Promise<UploadedExpenseDocumentPayload> {
  if (!acceptedDocumentTypes.split(",").includes(file.type)) {
    throw new Error("Choose a PDF, JPEG, PNG, or WebP document");
  }
  if (file.size <= 0 || file.size > maximumDocumentBytes) {
    throw new Error("The document must be between 1 byte and 10 MB");
  }
  const response = await fetch(`${apiBase}/expense-documents/upload`, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name)
    },
    body: file
  });
  const body = (await response.json().catch(() => null)) as { storageId?: string; size?: number; message?: string } | null;
  if (!response.ok || !body?.storageId) throw new Error(body?.message || "The source document could not be uploaded");
  return {
    kind,
    fileName: file.name,
    contentType: file.type,
    size: body.size ?? file.size,
    storageId: body.storageId
  };
}

export function ExpensesView({
  apiBase,
  dashboard,
  onCreateExpense,
  onMatchPayment
}: {
  apiBase: string;
  dashboard: DashboardSnapshot;
  onCreateExpense: (payload: CreateExpensePayload) => Promise<ExpenseRecord>;
  onMatchPayment: (expenseId: string, transactionId: string) => Promise<void>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unpaid" | "paid" | "missing">("all");
  const [query, setQuery] = useState("");
  const rows = dashboard.expenses
    .filter((expense) => {
      if (filter === "unpaid" && expense.paymentStatus !== "unpaid") return false;
      if (filter === "paid" && expense.paymentStatus !== "paid") return false;
      if (filter === "missing" && !expense.documents.some((document) => document.kind === "missing_receipt_declaration")) return false;
      const search = query.trim().toLowerCase();
      return !search || [
        expense.recordNumber,
        expense.supplierName,
        expense.sourceDocumentNumber,
        expense.description,
        expense.businessPurpose,
        expense.category,
        expense.supplierVatNumber
      ].filter(Boolean).join(" ").toLowerCase().includes(search);
    })
    .sort((left, right) => right.issueDate.localeCompare(left.issueDate) || right.createdAt.localeCompare(left.createdAt));
  const unpaidCount = dashboard.expenses.filter((expense) => expense.paymentStatus === "unpaid").length;
  const paidCount = dashboard.expenses.filter((expense) => expense.paymentStatus === "paid").length;
  const missingCount = dashboard.expenses.filter((expense) =>
    expense.documents.some((document) => document.kind === "missing_receipt_declaration")
  ).length;

  return (
    <div className="expenses-stack">
      <section className="expense-summary-grid">
        <article><span>Unpaid supplier bills</span><strong>{unpaidCount}</strong><small>Included in supplier payables</small></article>
        <article><span>Paid expenses</span><strong>{paidCount}</strong><small>Matched to outgoing bank activity</small></article>
        <article className={missingCount > 0 ? "warning" : ""}><span>Missing source documents</span><strong>{missingCount}</strong><small>Internal declarations, no input VAT</small></article>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Expenses and accounts payable</p>
            <h2>Supplier documents and payment evidence</h2>
          </div>
          <Button className="primary-button" type="button" onClick={() => setEditorOpen(true)}>
            <Plus size={16} /> Add supplier bill
          </Button>
        </div>
        <div className="income-callout">
          <FileText size={17} />
          <span>Electronic source documents are retained in their original format. Internal missing-document declarations are visibly separated and never treated as supplier VAT invoices.</span>
        </div>
        <div className="list-toolbar">
          <div className="list-toolbar-main">
            <Input
              aria-label="Search expenses"
              placeholder="Search supplier, document number, purpose"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <NativeSelect value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
              <NativeSelectOption value="all">All records</NativeSelectOption>
              <NativeSelectOption value="unpaid">Unpaid bills</NativeSelectOption>
              <NativeSelectOption value="paid">Paid expenses</NativeSelectOption>
              <NativeSelectOption value="missing">Missing documents</NativeSelectOption>
            </NativeSelect>
          </div>
          <span className="total-pill">{rows.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="data-table expense-table">
            <thead><tr><th>Record / supplier</th><th>Source document</th><th>Economic content</th><th>VAT</th><th>Status</th><th className="amount">Gross amount</th></tr></thead>
            <tbody>
              {rows.length > 0 ? rows.map((expense) => (
                <tr key={expense.id}>
                  <td className="counterparty-cell"><strong>{expense.recordNumber}</strong><span>{expense.supplierName}</span><small>{expense.supplierVatNumber || expense.supplierRegistrationNumber || "Supplier ID not recorded"}</small></td>
                  <td>
                    <span>{expense.sourceDocumentNumber || "Internal declaration"}</span>
                    <div className="expense-document-links">
                      {expense.documents.map((document) => (
                        <a key={document.id} href={`${apiBase}/expense-documents/${encodeURIComponent(document.id)}`} target="_blank" rel="noreferrer" title={document.fileName}>
                          <Paperclip size={13} /> {documentKindLabel(document.kind)}
                        </a>
                      ))}
                    </div>
                  </td>
                  <td className="counterparty-cell"><strong>{expense.description}</strong><span>{expense.businessPurpose}</span><small>{expense.category} · {dateLabel(expense.transactionDate ?? expense.issueDate)}</small></td>
                  <td><span>{vatTreatmentLabel(expense.vatTreatment)}</span><small>{money(expense.vatAmount, expense.currency)}{expense.vatRate !== undefined ? ` · ${expense.vatRate}%` : ""}</small></td>
                  <td><span className={`status-pill ${expense.paymentStatus === "paid" ? "good" : "warning"}`}>{expense.paymentStatus === "paid" ? "Paid" : "Unpaid"}</span><small>{expense.paymentStatus === "paid" ? `Paid ${dateLabel(expense.paidAt)}` : `Due ${dateLabel(expense.dueDate)}`}</small></td>
                  <td className="amount"><strong>{money(expense.grossAmount, expense.currency)}</strong><small>Net {money(expense.netAmount, expense.currency)}</small></td>
                </tr>
              )) : <tr><td colSpan={6}>No expense records match this view</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editorOpen && (
        <ExpenseEditorDialog
          apiBase={apiBase}
          dashboard={dashboard}
          onClose={() => setEditorOpen(false)}
          onCreateExpense={async (payload) => {
            const expense = await onCreateExpense(payload);
            setEditorOpen(false);
            return expense;
          }}
          onMatchPayment={onMatchPayment}
        />
      )}
    </div>
  );
}

export function ExpenseEditorDialog({
  apiBase,
  dashboard,
  transaction,
  onClose,
  onCreateExpense,
  onMatchPayment
}: {
  apiBase: string;
  dashboard: DashboardSnapshot;
  transaction?: Transaction;
  onClose: () => void;
  onCreateExpense: (payload: CreateExpensePayload) => Promise<ExpenseRecord>;
  onMatchPayment: (expenseId: string, transactionId: string) => Promise<void>;
}) {
  const supplierOptions = dashboard.providers
    .filter((provider) => provider.type === "supplier")
    .sort((left, right) => left.name.localeCompare(right.name));
  const initialProvider = transaction?.matchedProviderId
    ? supplierOptions.find((provider) => provider.id === transaction.matchedProviderId)
    : undefined;
  const matchCandidates = transaction ? matchingUnpaidSupplierBills(dashboard.expenses, transaction) : [];
  const [mode, setMode] = useState<"record" | "match">(matchCandidates.length > 0 ? "match" : "record");
  const [matchingExpenseId, setMatchingExpenseId] = useState(matchCandidates[0]?.id ?? "");
  const [providerId, setProviderId] = useState(initialProvider?.id ?? "");
  const [supplierName, setSupplierName] = useState(initialProvider?.legalName || initialProvider?.name || transaction?.counterparty || "");
  const [supplierRegistrationNumber, setSupplierRegistrationNumber] = useState(initialProvider?.meritDetails?.registrationNumber ?? "");
  const [supplierVatNumber, setSupplierVatNumber] = useState(initialProvider?.taxId ?? "");
  const [currency, setCurrency] = useState(transaction?.currency ?? initialProvider?.defaultCurrency ?? "EUR");
  const [sourceDocumentNumber, setSourceDocumentNumber] = useState("");
  const initialDate = transaction?.date ?? new Date().toISOString().slice(0, 10);
  const [issueDate, setIssueDate] = useState(initialDate);
  const [transactionDate, setTransactionDate] = useState(initialDate);
  const [dueDate, setDueDate] = useState(dueDateFrom(initialDate, initialProvider?.paymentTermsDays ?? 30));
  const [category, setCategory] = useState(transaction ? transactionBusinessCategory(transaction.category) : "Uncategorized");
  const [teamId, setTeamId] = useState(transaction?.teamId ?? "");
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [businessPurpose, setBusinessPurpose] = useState("");
  const [grossAmount, setGrossAmount] = useState(transaction ? String(transaction.amount) : "");
  const [vatTreatment, setVatTreatment] = useState<ExpenseVatTreatment>("not_applicable");
  const [vatRate, setVatRate] = useState("24");
  const initialAmounts = calculatedAmounts(Number(grossAmount), vatTreatment, Number(vatRate));
  const [netAmount, setNetAmount] = useState(String(initialAmounts.netAmount || ""));
  const [vatAmount, setVatAmount] = useState(String(initialAmounts.vatAmount || "0"));
  const [documentMode, setDocumentMode] = useState<"upload" | "missing">("upload");
  const [documentKind, setDocumentKind] = useState<"vendor_invoice" | "vendor_receipt">(transaction ? "vendor_receipt" : "vendor_invoice");
  const [file, setFile] = useState<File | null>(null);
  const [missingReason, setMissingReason] = useState("");
  const [declarationConfirmed, setDeclarationConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = transactionCategoryOptionsForDirection("out", dashboard.transactionCategories);

  function applyProvider(nextProvider?: Provider) {
    setProviderId(nextProvider?.id ?? "");
    if (!nextProvider) return;
    setSupplierName(nextProvider.legalName || nextProvider.name);
    setSupplierRegistrationNumber(nextProvider.meritDetails?.registrationNumber ?? "");
    setSupplierVatNumber(nextProvider.taxId ?? "");
    if (!transaction) setCurrency(nextProvider.defaultCurrency ?? "EUR");
    setDueDate(dueDateFrom(issueDate, nextProvider.paymentTermsDays ?? 30));
  }

  function recalculate(nextGross: string, nextTreatment = vatTreatment, nextRate = vatRate) {
    const amounts = calculatedAmounts(Number(nextGross), nextTreatment, Number(nextRate));
    setNetAmount(String(amounts.netAmount || ""));
    setVatAmount(String(amounts.vatAmount));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "match") {
        if (!transaction || !matchingExpenseId) throw new Error("Choose an unpaid supplier bill to match");
        await onMatchPayment(matchingExpenseId, transaction.id);
        onClose();
        return;
      }
      const gross = Number(grossAmount);
      const net = Number(netAmount);
      const vat = Number(vatAmount);
      if (!supplierName.trim() || !description.trim() || !businessPurpose.trim()) {
        throw new Error("Supplier, economic content, and business purpose are required");
      }
      if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(net) || !Number.isFinite(vat)) {
        throw new Error("Enter valid gross, net, and VAT amounts");
      }
      let document: CreateExpensePayload["document"];
      if (documentMode === "missing") {
        if (!transaction || !missingReason.trim() || !declarationConfirmed) {
          throw new Error("Explain the missing document and confirm the declaration");
        }
        document = {
          mode: "generate_missing_receipt",
          reason: missingReason.trim(),
          confirmation: "MISSING_SOURCE_DOCUMENT_CONFIRMED"
        };
      } else {
        if (!sourceDocumentNumber.trim()) throw new Error("Enter the supplier receipt or invoice number");
        if (!file) throw new Error("Upload the supplier receipt or invoice");
        document = { mode: "upload", file: await uploadExpenseDocument(apiBase, file, documentKind) };
      }
      await onCreateExpense({
        recordType: transaction ? "paid_expense" : "supplier_bill",
        paymentStatus: transaction ? "paid" : "unpaid",
        transactionId: transaction?.id,
        providerId: providerId || undefined,
        teamId: teamId || undefined,
        supplierName: supplierName.trim(),
        supplierRegistrationNumber: supplierRegistrationNumber.trim() || undefined,
        supplierVatNumber: supplierVatNumber.trim() || undefined,
        sourceDocumentNumber: sourceDocumentNumber.trim() || undefined,
        issueDate,
        transactionDate,
        dueDate: transaction ? undefined : dueDate,
        category,
        businessPurpose: businessPurpose.trim(),
        description: description.trim(),
        netAmount: documentMode === "missing" ? gross : net,
        vatAmount: documentMode === "missing" ? 0 : vat,
        grossAmount: gross,
        vatRate: documentMode === "missing"
          ? undefined
          : vatTreatment === "standard" || vatTreatment === "reduced"
            ? Number(vatRate)
            : vatTreatment === "zero"
              ? 0
              : undefined,
        vatTreatment: documentMode === "missing" ? "not_applicable" : vatTreatment,
        currency,
        document
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Expense record could not be saved");
      setSubmitting(false);
    }
  }

  const title = transaction ? "Review outgoing expense" : "Record unpaid supplier bill";
  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal expense-editor-modal" role="dialog" aria-modal="true" aria-labelledby="expense-editor-title" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div><p className="eyebrow">Estonian accounting source document</p><h2 id="expense-editor-title">{title}</h2></div>
          <Button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>
        {transaction && (
          <div className="transaction-summary"><span>{transaction.counterparty}</span><strong>{money(transaction.amount, transaction.currency)}</strong><small>{transaction.date} · {transaction.accountName}</small></div>
        )}
        {matchCandidates.length > 0 && transaction && (
          <div className="segmented-control expense-mode-control" aria-label="Expense action">
            <button className={mode === "match" ? "active" : ""} type="button" onClick={() => setMode("match")}>Match existing bill</button>
            <button className={mode === "record" ? "active" : ""} type="button" onClick={() => setMode("record")}>Record paid expense</button>
          </div>
        )}
        {error && <div className="inline-error">{error}</div>}
        {mode === "match" ? (
          <>
            <div className="income-callout"><Check size={16} /><span>These unpaid bills have the same currency and gross amount as the outgoing transaction.</span></div>
            <label>Supplier bill<NativeSelect value={matchingExpenseId} onValueChange={setMatchingExpenseId}>{matchCandidates.map((expense) => <NativeSelectOption key={expense.id} value={expense.id}>{expense.recordNumber} · {expense.supplierName} · due {expense.dueDate}</NativeSelectOption>)}</NativeSelect></label>
          </>
        ) : (
          <>
            <section className="form-section">
              <div className="form-section-header"><div><h3>Supplier identity</h3><p>Party information for the accounting source document and VAT review.</p></div></div>
              <label>Supplier company<NativeSelect value={providerId} onValueChange={(value) => applyProvider(supplierOptions.find((provider) => provider.id === value))}><NativeSelectOption value="">No saved supplier</NativeSelectOption>{supplierOptions.map((provider) => <NativeSelectOption key={provider.id} value={provider.id}>{provider.name}</NativeSelectOption>)}</NativeSelect></label>
              <label>Supplier name<Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
              <div className="form-grid"><label>Registry number<Input value={supplierRegistrationNumber} onChange={(event) => setSupplierRegistrationNumber(event.target.value)} placeholder="Optional" /></label><label>VAT number<Input value={supplierVatNumber} onChange={(event) => setSupplierVatNumber(event.target.value.toUpperCase())} placeholder="EE123456789 or foreign VAT ID" /></label></div>
            </section>

            <section className="form-section">
              <div className="form-section-header"><div><h3>Source document</h3><p>Document number, dates, economic content, and business purpose.</p></div></div>
              <div className="form-grid"><label>Supplier document number<Input value={sourceDocumentNumber} onChange={(event) => setSourceDocumentNumber(event.target.value)} placeholder="Required receipt or invoice number" /></label><label>Issue date<Input type="date" value={issueDate} onChange={(event) => { setIssueDate(event.target.value); if (!transaction) setDueDate(dueDateFrom(event.target.value, supplierOptions.find((provider) => provider.id === providerId)?.paymentTermsDays ?? 30)); }} /></label></div>
              <div className="form-grid"><label>Transaction / supply date<Input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} /></label>{!transaction && <label>Due date<Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>}</div>
              <label>Economic content<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Goods or services purchased" /></label>
              <label>Business purpose<Textarea rows={2} value={businessPurpose} onChange={(event) => setBusinessPurpose(event.target.value)} placeholder="Why this cost was incurred for the business" /></label>
              <div className="form-grid"><label>Category<NativeSelect value={category} onValueChange={setCategory}>{categories.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect></label><label>Owner<NativeSelect value={teamId} onValueChange={setTeamId}><NativeSelectOption value="">No owner</NativeSelectOption>{dashboard.teams.map((team) => <NativeSelectOption key={team.id} value={team.id}>{team.name}</NativeSelectOption>)}</NativeSelect></label></div>
            </section>

            <section className="form-section">
              <div className="form-section-header"><div><h3>Amount and VAT</h3><p>Estonian standard VAT is 24%; use the treatment shown on the supplier document.</p></div></div>
              <div className="form-grid"><label>Gross amount<Input type="number" min="0" step="0.01" value={grossAmount} readOnly={Boolean(transaction)} onChange={(event) => { setGrossAmount(event.target.value); recalculate(event.target.value); }} /></label><label>Currency<Input value={currency} readOnly={Boolean(transaction)} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label></div>
              <label>VAT treatment<NativeSelect value={documentMode === "missing" ? "not_applicable" : vatTreatment} disabled={documentMode === "missing"} onValueChange={(value) => { const treatment = value as ExpenseVatTreatment; const nextRate = treatment === "standard" ? "24" : treatment === "reduced" ? "13" : treatment === "zero" ? "0" : vatRate; setVatTreatment(treatment); setVatRate(nextRate); recalculate(grossAmount, treatment, nextRate); }}><NativeSelectOption value="not_applicable">No input VAT recorded</NativeSelectOption><NativeSelectOption value="standard">Standard VAT</NativeSelectOption><NativeSelectOption value="reduced">Reduced VAT</NativeSelectOption><NativeSelectOption value="zero">0% VAT</NativeSelectOption><NativeSelectOption value="exempt">VAT exempt</NativeSelectOption><NativeSelectOption value="reverse_charge">Reverse charge</NativeSelectOption></NativeSelect></label>
              {(vatTreatment === "standard" || vatTreatment === "reduced") && documentMode !== "missing" && <label>VAT rate (%)<Input type="number" min="0.01" max="100" step="0.01" value={vatRate} onChange={(event) => { setVatRate(event.target.value); recalculate(grossAmount, vatTreatment, event.target.value); }} /></label>}
              <div className="form-grid"><label>Net amount<Input type="number" min="0" step="0.01" value={documentMode === "missing" ? grossAmount : netAmount} readOnly={documentMode === "missing"} onChange={(event) => setNetAmount(event.target.value)} /></label><label>VAT amount<Input type="number" min="0" step="0.01" value={documentMode === "missing" ? "0" : vatAmount} readOnly={documentMode === "missing"} onChange={(event) => setVatAmount(event.target.value)} /></label></div>
            </section>

            <section className="form-section">
              <div className="form-section-header"><div><h3>Evidence</h3><p>Keep the supplier-issued file whenever it is available.</p></div></div>
              {transaction && <div className="segmented-control expense-document-mode"><button className={documentMode === "upload" ? "active" : ""} type="button" onClick={() => setDocumentMode("upload")}><Upload size={14} /> Upload source document</button><button className={documentMode === "missing" ? "active" : ""} type="button" onClick={() => { setDocumentMode("missing"); setVatTreatment("not_applicable"); setVatAmount("0"); setNetAmount(grossAmount); }}><ShieldAlert size={14} /> Document missing</button></div>}
              {documentMode === "upload" ? (
                <>
                  <label>Document type<NativeSelect value={documentKind} onValueChange={(value) => setDocumentKind(value as typeof documentKind)}><NativeSelectOption value="vendor_receipt">Supplier receipt</NativeSelectOption><NativeSelectOption value="vendor_invoice">Supplier invoice</NativeSelectOption></NativeSelect></label>
                  <label className="expense-file-picker"><Upload size={16} /><span>{file ? file.name : "Choose PDF or image up to 10 MB"}</span><input type="file" accept={acceptedDocumentTypes} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
                </>
              ) : (
                <>
                  <div className="income-callout warning"><CircleAlert size={17} /><span>The generated PDF is an internal declaration, not a supplier receipt or VAT invoice. Input VAT will be recorded as zero.</span></div>
                  <label>Why is the original unavailable?<Textarea rows={3} value={missingReason} onChange={(event) => setMissingReason(event.target.value)} placeholder="Describe attempts to obtain the supplier document and why it is unavailable" /></label>
                  <label className="merit-confirmation-check"><Checkbox checked={declarationConfirmed} onCheckedChange={(checked) => setDeclarationConfirmed(checked === true)} />I confirm that the linked bank payment and the details entered above truthfully describe this business transaction.</label>
                </>
              )}
            </section>
          </>
        )}
        <div className="modal-actions">
          <Button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : mode === "match" ? <Check size={16} /> : <ReceiptText size={16} />}
            {mode === "match" ? "Match payment" : transaction ? "Save paid expense" : "Save supplier bill"}
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}
