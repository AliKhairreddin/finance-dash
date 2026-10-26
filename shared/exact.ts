// Exact's division IDs are independent of the manually maintained statement companies.
export const exactOrigin = "https://start.exactonline.nl";
export const exactRedirectUri = "https://statements.thatcanadian.dev/api/statements/exact/callback";
export const exactResources = {
  accounts: { label: "Customers & suppliers", path: "sync/CRM/Accounts", key: "ID", sync: true, fields: "ID,Timestamp,Code,Name,Email,Phone,AddressLine1,AddressLine2,City,Postcode,Country,Currency,IsSales,IsSupplier,Status,Modified" },
  invoices: { label: "Customer invoices", path: "sync/SalesInvoice/SalesInvoices", key: "ID", sync: true, fields: "ID,Timestamp,InvoiceID,LineNumber,InvoiceNumber,InvoiceDate,DueDate,Description,InvoiceTo,InvoiceToName,OrderedBy,Journal,Currency,AmountFC,Status,StatusDescription,YourRef,Modified,Document,Item,GLAccount,Quantity,UnitPrice,VATCode" },
  purchases: { label: "Supplier bills", path: "sync/Financial/PurchaseEntries", key: "ID", sync: true, fields: "ID,Timestamp,EntryID,LineNumber,EntryNumber,InvoiceNumber,EntryDate,DueDate,Description,Supplier,SupplierName,Journal,Currency,AmountFC,Status,StatusDescription,YourRef,Modified,Document,GLAccount,VATCode" },
  transactions: { label: "Transactions in Exact", path: "sync/Financial/TransactionLines", key: "ID", sync: true, fields: "ID,Timestamp,EntryID,LineNumber,EntryNumber,Date,DueDate,Description,Account,AccountName,GLAccount,GLAccountCode,GLAccountDescription,JournalCode,JournalDescription,Currency,AmountFC,AmountDC,Status,Modified,Document,InvoiceNumber,YourRef" },
  receivables: { label: "Money to collect", path: "read/financial/ReceivablesList", key: "HID", sync: false, fields: "HID,AccountId,AccountName,AccountCode,Amount,AmountInTransit,CurrencyCode,Description,DueDate,InvoiceDate,InvoiceNumber,YourRef" },
  payables: { label: "Bills to pay", path: "read/financial/PayablesList", key: "HID", sync: false, fields: "HID,AccountId,AccountName,AccountCode,Amount,AmountInTransit,CurrencyCode,Description,DueDate,InvoiceDate,InvoiceNumber,YourRef,ApprovalStatus" },
  documents: { label: "Documents", path: "sync/Documents/Documents", key: "ID", sync: true, fields: "ID,Timestamp,Subject,DocumentDate,Account,AccountName,Type,TypeDescription,AmountFC,Currency,Modified" },
  documentTypes: { label: "Document types", path: "documents/DocumentTypes", key: "ID", sync: false, fields: "ID,Description,DocumentIsCreatable,DocumentIsUpdatable" },
  attachments: { label: "Files", path: "sync/Documents/DocumentAttachments", key: "ID", sync: true, fields: "ID,Timestamp,Document,FileName,FileSize" },
  glAccounts: { label: "Income & expense categories", path: "sync/Financial/GLAccounts", key: "ID", sync: true, fields: "ID,Timestamp,Code,Description,Type,TypeDescription,BalanceSide,BalanceType,IsBlocked,Modified,VATCode" },
  journals: { label: "Account books & bank accounts", path: "financial/Journals", key: "ID", sync: false, fields: "ID,Code,Description,Type,Currency,GLAccount,IsBlocked,BankAccountIBAN,BankName,Modified" },
  vatCodes: { label: "Tax codes", path: "vat/VATCodes", key: "ID", sync: false, fields: "ID,Code,Description,Percentage,Type,IsBlocked,Modified" },
  items: { label: "Products & services", path: "sync/Logistics/Items", key: "ID", sync: true, fields: "ID,Timestamp,Code,Description,GLRevenue,SalesVatCode,IsSalesItem,Modified" },
  deleted: { label: "Deletion reconciliation", path: "sync/Deleted", key: "ID", sync: true, fields: "ID,Timestamp,EntityKey,EntityType,DeletedDate" }
} as const;
export type ExactKind = keyof typeof exactResources;
export const exactKinds = Object.keys(exactResources) as ExactKind[];
export const exactVisibleKinds = exactKinds.filter(kind => kind !== "deleted");
export const isExactKind = (value: unknown): value is ExactKind => typeof value === "string" && exactKinds.includes(value as ExactKind);
export type ExactData = Record<string, string | number | boolean | null>;
export interface ExactCompany { division: number; name: string; code: string; currency: string; active: boolean }
export interface ExactDataset { division: number; kind: ExactKind; state: string; lastCompletedAt?: number; error?: string; nextRunAt: number }
export interface ExactConnectionStatus { configured: boolean; connected: boolean; state: string; error?: string; user?: string; lastDiscoveryAt?: number; companies: ExactCompany[]; datasets: ExactDataset[] }
export interface ExactRecord { id: string; division: number; kind: ExactKind; providerId: string; parentId: string; data: ExactData; updatedAt: number }
export interface ExactPage { records: ExactRecord[]; truncated: boolean; datasets: ExactDataset[] }
export const exactSortKeys = ["company", "date", "number", "name", "description", "amount", "currency", "status", "dueDate"] as const;
export type ExactSortKey = typeof exactSortKeys[number];
export function exactDate(value: unknown): string {
  if (!value) return "";
  const match = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(String(value));
  const date = new Date(match ? Number(match[1]) : String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}
export function exactValue(row: ExactRecord, key: ExactSortKey, companies: ExactCompany[]): string | number {
  const d = row.data;
  switch (key) {
    case "company": return companies.find(c => c.division === row.division)?.name ?? String(row.division);
    case "date": return exactDate(d.InvoiceDate ?? d.EntryDate ?? d.Date ?? d.DocumentDate ?? d.Modified);
    case "dueDate": return exactDate(d.DueDate);
    case "number": return String(d.InvoiceNumber ?? d.EntryNumber ?? d.Code ?? "");
    case "name": return String(d.Name ?? d.InvoiceToName ?? d.SupplierName ?? d.AccountName ?? d.FileName ?? "");
    case "description": return String(d.Description ?? d.Subject ?? d.BankName ?? "");
    case "amount": return typeof (d.AmountFC ?? d.Amount) === "number" ? Number(d.AmountFC ?? d.Amount) : "";
    case "currency": return String(d.Currency ?? d.CurrencyCode ?? "");
    case "status": return String(d.StatusDescription ?? d.TypeDescription ?? d.Status ?? "");
  }
}
export function exactInitialUrl(division: number, kind: ExactKind, cursor = "1"): string {
  if (!Number.isSafeInteger(division) || division <= 0 || !/^\d+$/.test(cursor)) throw new Error("Invalid Exact company or cursor");
  const resource = exactResources[kind];
  const url = new URL(`/api/v1/${division}/${resource.path}`, exactOrigin);
  url.searchParams.set("$select", resource.fields);
  if (resource.sync) url.searchParams.set("$filter", `Timestamp gt ${cursor}L`);
  return url.href;
}
export function exactSafeUrl(value: string, expectedPath: string): string {
  const url = new URL(value, exactOrigin);
  if (url.origin !== exactOrigin || url.pathname !== expectedPath || url.username || url.password || url.hash) throw new Error("Exact returned an unsafe continuation URL");
  return url.href;
}
export function exactRows(value: unknown): { rows: Record<string, unknown>[]; next: string | null } {
  if (!value || typeof value !== "object" || !("d" in value)) throw new Error("Exact response is incomplete");
  const d = (value as { d: unknown }).d;
  const container = d && typeof d === "object" && !Array.isArray(d) ? d as Record<string, unknown> : null;
  const rows = Array.isArray(d) ? d : container?.results;
  if (!Array.isArray(rows) || rows.length > 1000 || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Exact returned an invalid page");
  if (container?.__next !== undefined && typeof container.__next !== "string") throw new Error("Invalid Exact page cursor");
  return { rows, next: typeof container?.__next === "string" ? container.__next : null };
}
export function exactCursor(value: unknown): string {
  if ((typeof value === "string" && /^\d+$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) return String(value);
  throw new Error("Exact returned an invalid or imprecise timestamp");
}
export function exactCleanRow(kind: ExactKind, row: Record<string, unknown>): ExactData {
  const result: ExactData = {};
  for (const field of exactResources[kind].fields.split(",")) {
    const value = row[field];
    if (value === undefined) continue;
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Invalid Exact ${field}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid Exact amount");
    if (typeof value === "string" && value.length > 10000) throw new Error("Exact field exceeds supported size");
    result[field] = value as ExactData[string];
  }
  const id = result[exactResources[kind].key];
  if (typeof id !== "string" && !(typeof id === "number" && Number.isSafeInteger(id))) throw new Error("Exact record has no reliable identifier");
  if (exactResources[kind].sync) result.Timestamp = exactCursor(row.Timestamp);
  return result;
}
export const exactDeleteKinds: Record<number, ExactKind> = { 1: "transactions", 2: "accounts", 4: "attachments", 6: "documents", 7: "glAccounts", 9: "items", 13: "invoices", 60: "purchases" };
export const exactWriteKinds = ["accounts", "invoices", "purchases", "documents"] as const;
export type ExactWriteKind = typeof exactWriteKinds[number];
export const exactWritePaths: Record<ExactWriteKind, string> = { accounts: "crm/Accounts", invoices: "salesinvoice/SalesInvoices", purchases: "purchaseentry/PurchaseEntries", documents: "documents/Documents" };
export function exactGuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Select a saved Exact record");
  return value.toLowerCase();
}
const textField = (v: unknown, name: string, required = false, max = 240) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) throw new Error(`Enter a valid ${name}`);
  return v.trim();
};
const dateField = (v: unknown) => { const s = textField(v, "date", true, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || exactDate(s) !== s) throw new Error("Enter a valid date"); return s; };
export function exactWritePayload(kind: ExactWriteKind, input: Record<string, unknown>, editing: boolean): Record<string, unknown> {
  // Build an allowlisted payload. Browser-supplied provider IDs, statuses, posting flags and URLs are never forwarded.
  if (kind === "accounts") {
    const result: Record<string, unknown> = { Name: textField(input.Name, "name", true, 100) };
    for (const key of ["Email", "Phone", "AddressLine1", "AddressLine2", "City", "Postcode", "Country"] as const) if (input[key] !== undefined) result[key] = textField(input[key], key, false, key === "Country" ? 2 : 100);
    if (result.Email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(result.Email))) throw new Error("Enter a valid email");
    if (result.Country && !/^[A-Z]{2}$/.test(String(result.Country))) throw new Error("Use a two-letter country code");
    if (!editing) { result.IsSales = input.IsSales === true; result.IsSupplier = input.IsSupplier === true; }
    return result;
  }
  if (kind === "documents") {
    const result: Record<string, unknown> = { Subject: textField(input.Subject, "subject", true) };
    if (!editing) { result.Type = Number(input.Type); if (!Number.isSafeInteger(result.Type) || Number(result.Type) < 1) throw new Error("Choose an Exact document type"); result.DocumentDate = dateField(input.DocumentDate); if (input.Account) result.Account = exactGuid(input.Account); }
    return result;
  }
  const result: Record<string, unknown> = { Description: textField(input.Description, "description", true), YourRef: textField(input.YourRef ?? "", "reference") };
  if (editing) return result;
  result.Journal = textField(input.Journal, "journal", true, 20);
  result.Currency = textField(input.Currency, "currency", true, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(String(result.Currency))) throw new Error("Enter a three-letter currency");
  result[kind === "invoices" ? "OrderedBy" : "Supplier"] = exactGuid(input.Account);
  result[kind === "invoices" ? "InvoiceDate" : "EntryDate"] = dateField(input.Date);
  if (kind === "invoices") result.InvoiceTo = result.OrderedBy;
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 20) throw new Error("Add between 1 and 20 invoice lines");
  result[kind === "invoices" ? "SalesInvoiceLines" : "PurchaseEntryLines"] = input.lines.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid invoice line");
    const line = raw as Record<string, unknown>;
    const amount = Number(line.amount);
    if (typeof line.amount !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(line.amount) || !Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw new Error("Enter a positive line amount with up to two decimals");
    const value: Record<string, unknown> = { Description: textField(line.description, "line description", true), GLAccount: exactGuid(line.glAccount), VATCode: textField(line.vatCode, "VAT code", true, 20) };
    if (kind === "invoices") { value.Item = exactGuid(line.item); value.Quantity = 1; value.UnitPrice = amount; }
    else value.AmountFC = amount;
    return value;
  });
  return result;
}
