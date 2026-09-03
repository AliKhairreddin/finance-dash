export type TelegramCommandAccess = "read" | "action";

export interface FinanceTelegramCommand {
  command: string;
  description: string;
  access: TelegramCommandAccess;
}

export const financeTelegramCommands: readonly FinanceTelegramCommand[] = [
  { command: "menu", description: "Browse Finance Dash commands", access: "read" },
  { command: "help", description: "Show command help and examples", access: "read" },
  { command: "whoami", description: "Show your Finance Dash identity and role", access: "read" },
  { command: "cancel", description: "Cancel an unfinished action", access: "read" },
  { command: "ask", description: "Ask a natural-language finance question", access: "read" },
  { command: "overview", description: "Show the finance overview", access: "read" },
  { command: "balances", description: "Show bank and asset balances", access: "read" },
  { command: "cashflow", description: "Show cash-flow totals", access: "read" },
  { command: "receivables", description: "Show current receivables", access: "read" },
  { command: "payables", description: "Show current payables", access: "read" },
  { command: "holdings", description: "Show cash, exchange, and wallet holdings", access: "read" },
  { command: "fx", description: "Show current FX rates", access: "read" },
  { command: "transactions", description: "List filtered transactions", access: "read" },
  { command: "transaction", description: "Show one transaction", access: "read" },
  { command: "needs_review", description: "Show transactions needing review", access: "read" },
  { command: "search", description: "Search transactions", access: "read" },
  { command: "cashback", description: "Show Slash cashback", access: "read" },
  { command: "export_transactions", description: "Export transactions as CSV", access: "read" },
  { command: "analytics", description: "Show period analytics", access: "read" },
  { command: "spend", description: "Show spend totals", access: "read" },
  { command: "income", description: "Show income totals", access: "read" },
  { command: "top_companies", description: "Show top companies", access: "read" },
  { command: "top_categories", description: "Show top categories", access: "read" },
  { command: "revenue", description: "Show revenue summary", access: "read" },
  { command: "revenue_runs", description: "Show recent revenue runs", access: "read" },
  { command: "revenue_pull", description: "Pull partner revenue", access: "action" },
  { command: "draft_revenue", description: "Prepare revenue invoice drafts", access: "action" },
  { command: "invoices", description: "List invoices", access: "read" },
  { command: "invoice", description: "Show one invoice", access: "read" },
  { command: "overdue", description: "Show overdue invoices", access: "read" },
  { command: "due_soon", description: "Show invoices due soon", access: "read" },
  { command: "invoice_pdf", description: "Receive an invoice PDF", access: "read" },
  { command: "payment_candidates", description: "Show possible invoice payments", access: "read" },
  { command: "expenses", description: "List expenses and supplier bills", access: "read" },
  { command: "expense", description: "Show one expense", access: "read" },
  { command: "unpaid_bills", description: "Show unpaid supplier bills", access: "read" },
  { command: "missing_documents", description: "Show expenses missing evidence", access: "read" },
  { command: "expense_document", description: "Receive an expense document", access: "read" },
  { command: "media_spend", description: "Show media spend", access: "read" },
  { command: "provider_funds", description: "Show provider funding", access: "read" },
  { command: "distribution", description: "Show profit distribution", access: "read" },
  { command: "management", description: "Show management reporting", access: "read" },
  { command: "companies", description: "List companies", access: "read" },
  { command: "teams", description: "List teams", access: "read" },
  { command: "health", description: "Show integration health", access: "read" },
  { command: "sync", description: "Run bank and Merit synchronization", access: "action" },
  { command: "categorize", description: "Categorize a transaction", access: "action" },
  { command: "assign_company", description: "Assign a transaction company", access: "action" },
  { command: "assign_team", description: "Assign a transaction owner", access: "action" },
  { command: "create_invoice", description: "Create an invoice draft", access: "action" },
  { command: "edit_invoice", description: "Edit an invoice draft", access: "action" },
  { command: "duplicate_invoice", description: "Duplicate an invoice draft", access: "action" },
  { command: "delete_draft", description: "Delete an invoice draft", access: "action" },
  { command: "match_invoice", description: "Match an invoice payment", access: "action" },
  { command: "record_payment", description: "Record an invoice payment", access: "action" },
  { command: "send_invoice", description: "Save or deliver through Merit", access: "action" },
  { command: "create_expense", description: "Create an expense or supplier bill", access: "action" },
  { command: "upload_receipt", description: "Attach expense evidence", access: "action" },
  { command: "match_expense", description: "Match an expense payment", access: "action" },
  { command: "add_receivable", description: "Add a receivable", access: "action" },
  { command: "add_holding", description: "Add a holding", access: "action" },
  { command: "update_holding", description: "Update a holding", access: "action" },
  { command: "save_cashflow", description: "Save a cash-flow snapshot", access: "action" },
  { command: "alerts", description: "Show notification rules", access: "read" },
  { command: "alert_add", description: "Add a notification rule", access: "action" },
  { command: "alert_remove", description: "Remove a notification rule", access: "action" },
  { command: "alert_pause", description: "Pause a notification rule", access: "action" },
  { command: "alert_resume", description: "Resume a notification rule", access: "action" },
  { command: "alert_test", description: "Test a notification rule", access: "action" },
  { command: "alert_history", description: "Show recent alert deliveries", access: "read" },
  { command: "digest", description: "Configure summary messages", access: "action" },
  { command: "screenshot", description: "Receive a dashboard screenshot", access: "read" },
  { command: "open", description: "Open a dashboard page", access: "read" }
] as const;

export const readOnlyFinanceTelegramCommands = financeTelegramCommands.filter(
  (command) => command.access === "read"
);

export function parseTelegramCommandUsers(value: string | undefined, field: string): string[] {
  const users = value?.split(",").map((user) => user.trim().replace(/\s+/gu, " ")).filter(Boolean) ?? [];
  if (users.length === 0 || users.length > 20) throw new Error(`${field} must contain 1-20 users`);
  const normalized = users.map((user) => user.toLowerCase());
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} contains duplicate users`);
  return users;
}
