export const statementStatusLabels: Record<string, string> = {
  ai_generated: "AI generated", pending: "Needs checking", reconciled: "Checked", completed: "Completed", queued: "Waiting", processing: "Reading file", needs_review: "Needs checking", ready: "Ready", imported: "Added", importing: "Adding", failed: "Failed", duplicate: "Already saved", review: "Needs checking",
  syncing: "Updating", access_denied: "No access", access_removed: "Access removed", not_connected: "Not connected", connected: "Connected", reconnect_required: "Connect again", running: "Sending", succeeded: "Saved", uncertain: "Check result"
};
export const statementFieldNames: Record<string, string> = {
  counterparty: "Paid to / received from", companyId: "Company", documentType: "Document type", issueDate: "Document date", dueDate: "Due date", amountMinor: "Amount (smallest currency unit)", cardLastFour: "Last 4 card digits", providerId: "Bank transaction ID", reviewReasons: "Things to check", textMethod: "How the file was read", source: "Bank / service", origin: "Added from", generationId: "AI request ID", costUsd: "AI cost (USD)",
  Account: "Customer or supplier ID", AccountId: "Customer or supplier ID", AccountName: "Customer or supplier", AccountCode: "Customer or supplier code", AmountFC: "Amount", AmountDC: "Amount in company currency", AmountInTransit: "Payment on the way", CurrencyCode: "Currency", InvoiceTo: "Customer ID", InvoiceToName: "Customer name", OrderedBy: "Ordered by customer ID", Supplier: "Supplier ID", SupplierName: "Supplier name", Journal: "Account book", JournalCode: "Account book code", JournalDescription: "Account book name", GLAccount: "Income or expense category ID", GLAccountCode: "Income or expense category code", GLAccountDescription: "Income or expense category", GLRevenue: "Income category ID", IsSales: "Customer", IsSupplier: "Supplier", IsBlocked: "Blocked", IsSalesItem: "Can be sold", VATCode: "Tax code", SalesVatCode: "Sales tax code", YourRef: "Reference", Modified: "Last changed", Type: "Type code", TypeDescription: "Type", StatusDescription: "Status", Document: "Document ID", BalanceSide: "Account side code", BalanceType: "Account type code", DocumentIsCreatable: "Can add this type", DocumentIsUpdatable: "Can edit this type", HID: "Exact record number", LineNumber: "Row number (0 = summary)", EntryNumber: "Transaction number", EntryDate: "Transaction date", UnitPrice: "Price per item", Item: "Product or service ID", BankAccountIBAN: "Bank account (IBAN)", Percentage: "Tax rate", Subject: "Title", Country: "Country code"
};
export function statementFieldLabel(key: string): string { return statementFieldNames[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, c => c.toUpperCase()); }
export function statementOrigin(value: string): string { return ({ manual: "Added by hand", csv: "CSV file", pdf: "PDF file", email: "Email", file: "Uploaded file" } as Record<string, string>)[value] ?? value; }
// Older saved checks still contain the original system wording. Translate only
// system messages here; never change a customer's description or file contents.
export function simpleStatementText(value: string): string {
  const phrases: Record<string, string> = {
    "Assign the company and explicitly review outstanding issues before reconciliation": "Choose a company and check the problems shown before marking this checked",
    "Allocate reviewed supporting documents to the complete transaction amount": "Link checked receipts or invoices for the full transaction amount",
    "Reconcile the transaction before completing it": "Mark the transaction checked before marking it done",
    "Conflicting company evidence; assign this transaction after review": "More than one company matches. Check the transaction and choose its company",
    "Company is unassigned": "Choose a company",
    "Unlink document allocations before changing company, amount, currency or direction": "Remove linked documents before changing the company, amount, currency or money in/out",
    "Allocation exceeds the transaction's remaining amount": "The linked amount is more than the amount left on this transaction",
    "Allocation exceeds the document's remaining amount": "The linked amount is more than the amount left on this document",
    "Full Statements access is required for Exact": "Your user needs access to all companies to use Exact",
    "Exact request lease expired": "The Exact request timed out. Please try again",
    "Exact app credentials have not been configured": "The Exact connection keys have not been added yet"
  };
  let text = phrases[value] ?? value;
  for (const [word, replacement] of [["reconciliation", "checking"], ["reconciled", "checked"], ["reconcile", "check"], ["allocations", "linked amounts"], ["allocation", "linked amount"], ["allocating", "linking"], ["evidence", "supporting details"], ["synchronization", "update"], ["synchronize", "update"], ["synchronized", "saved"], ["authorization", "connection approval"], ["authorized", "connected"], ["dataset", "record list"], ["scope", "selected records"], ["unassigned", "not chosen"], ["quarantined", "waiting for approval"]]) text = text.replace(new RegExp(`\\b${word}\\b`, "gi"), replacement);
  return text;
}
export function statementActionLabel(value: string): string {
  return ({ reconcile: "Marked checked", complete: "Marked done", reopen: "Moved to Needs checking", trash: "Moved to Trash", restore: "Restored", document_allocated: "Document linked", document_unlinked: "Document removed", preview_corrected: "File preview corrected", processing_approved: "AI reading approved", created: "Added", updated: "Changed" } as Record<string, string>)[value] ?? statementFieldLabel(value);
}
