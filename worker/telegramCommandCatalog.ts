export type TelegramCommandAccess = "read" | "action";
export type TelegramCommandInput = "tap" | "optional" | "required";

export interface FinanceTelegramCommand {
  command: string;
  description: string;
  access: TelegramCommandAccess;
  input: TelegramCommandInput;
  arguments?: string;
  example?: string;
}

export const financeTelegramCommands: readonly FinanceTelegramCommand[] = [
  { command: "menu", description: "Browse Finance Dash commands", access: "read", input: "tap" },
  { command: "help", description: "Show help or command syntax", access: "read", input: "optional", arguments: "[command]", example: "/help search" },
  { command: "whoami", description: "Show your identity and role", access: "read", input: "tap" },
  { command: "cancel", description: "Cancel an unfinished action", access: "read", input: "tap" },
  { command: "ask", description: "Ask a finance question", access: "read", input: "required", arguments: "<question>", example: "/ask How much did we spend on Meta last month?" },
  { command: "overview", description: "Show the finance overview", access: "read", input: "tap" },
  { command: "balances", description: "Show bank and asset balances", access: "read", input: "optional", arguments: "[all|slash|wise|revolut|amex|holdings]", example: "/balances slash" },
  { command: "cashflow", description: "Show cash-flow totals", access: "read", input: "tap" },
  { command: "receivables", description: "Show current receivables", access: "read", input: "tap" },
  { command: "payables", description: "Show current payables", access: "read", input: "tap" },
  { command: "holdings", description: "Show cash, exchange, and wallet holdings", access: "read", input: "tap" },
  { command: "fx", description: "Show current FX rates", access: "read", input: "tap" },
  { command: "transactions", description: "List recent or filtered transactions", access: "read", input: "optional", arguments: "[period] [bank] [search text]", example: "/transactions last-7-days slash Meta" },
  { command: "transaction", description: "Show one transaction", access: "read", input: "required", arguments: "<transaction ID>" },
  { command: "needs_review", description: "Show transactions needing review", access: "read", input: "optional", arguments: "[period] [bank]", example: "/needs_review last-7-days" },
  { command: "search", description: "Search this month's transactions", access: "read", input: "required", arguments: "<text>", example: "/search Meta" },
  { command: "cashback", description: "Show Slash cashback", access: "read", input: "optional", arguments: "[period]", example: "/cashback last-month" },
  { command: "export_transactions", description: "Export transactions as CSV", access: "read", input: "optional", arguments: "[period] [bank] [search text]", example: "/export_transactions this-month slash" },
  { command: "analytics", description: "Show period analytics", access: "read", input: "optional", arguments: "[period]", example: "/analytics last-month" },
  { command: "spend", description: "Show spend totals", access: "read", input: "optional", arguments: "[period]", example: "/spend last-7-days" },
  { command: "income", description: "Show income totals", access: "read", input: "optional", arguments: "[period]", example: "/income this-month" },
  { command: "top_companies", description: "Show top companies", access: "read", input: "optional", arguments: "[period]", example: "/top_companies last-month" },
  { command: "top_categories", description: "Show top categories", access: "read", input: "optional", arguments: "[period]", example: "/top_categories this-month" },
  { command: "revenue", description: "Show revenue summary", access: "read", input: "tap" },
  { command: "revenue_runs", description: "Show recent revenue runs", access: "read", input: "tap" },
  { command: "revenue_pull", description: "Pull partner revenue", access: "action", input: "required", arguments: "<JSON SyncRevenuePayload> CONFIRM" },
  { command: "draft_revenue", description: "Prepare revenue invoice drafts", access: "action", input: "required", arguments: "<JSON DraftRevenueRunPayload> CONFIRM" },
  { command: "invoices", description: "List invoices", access: "read", input: "tap" },
  { command: "invoice", description: "Show one invoice", access: "read", input: "required", arguments: "<invoice number or ID>", example: "/invoice INV-2026-001" },
  { command: "overdue", description: "Show overdue invoices", access: "read", input: "tap" },
  { command: "due_soon", description: "Show invoices due soon", access: "read", input: "tap" },
  { command: "invoice_pdf", description: "Receive an invoice PDF", access: "read", input: "required", arguments: "<invoice number or ID>", example: "/invoice_pdf INV-2026-001" },
  { command: "payment_candidates", description: "Show possible invoice payments", access: "read", input: "optional", arguments: "[currency]", example: "/payment_candidates USD" },
  { command: "expenses", description: "List expenses and supplier bills", access: "read", input: "tap" },
  { command: "expense", description: "Show one expense", access: "read", input: "required", arguments: "<record number or ID>", example: "/expense EXP-2026-001" },
  { command: "unpaid_bills", description: "Show unpaid supplier bills", access: "read", input: "tap" },
  { command: "missing_documents", description: "Show expenses missing evidence", access: "read", input: "tap" },
  { command: "expense_document", description: "Receive an expense document", access: "read", input: "required", arguments: "<record number or ID>", example: "/expense_document EXP-2026-001" },
  { command: "media_spend", description: "Show media spend", access: "read", input: "optional", arguments: "[period]", example: "/media_spend last-month" },
  { command: "provider_funds", description: "Show provider funding", access: "read", input: "tap" },
  { command: "distribution", description: "Show profit distribution", access: "read", input: "tap" },
  { command: "management", description: "Show management reporting", access: "read", input: "tap" },
  { command: "companies", description: "List companies", access: "read", input: "tap" },
  { command: "teams", description: "List teams", access: "read", input: "tap" },
  { command: "health", description: "Show integration health", access: "read", input: "tap" },
  { command: "sync", description: "Run bank and Merit synchronization", access: "action", input: "required", arguments: "CONFIRM", example: "/sync CONFIRM" },
  { command: "categorize", description: "Categorize a transaction", access: "action", input: "required", arguments: "<transaction ID> | <category> | <transaction|merchant> | CONFIRM" },
  { command: "assign_company", description: "Assign a transaction company", access: "action", input: "required", arguments: "<transaction ID> | <company ID> | <transaction|merchant> | CONFIRM" },
  { command: "assign_team", description: "Assign a transaction owner", access: "action", input: "required", arguments: "<transaction ID> | <team ID or none> | CONFIRM" },
  { command: "create_invoice", description: "Create an invoice draft", access: "action", input: "required", arguments: "<JSON CreateInvoicePayload> CONFIRM" },
  { command: "edit_invoice", description: "Edit an invoice draft", access: "action", input: "required", arguments: "<invoice number or ID> | <JSON UpdateInvoicePayload> | CONFIRM" },
  { command: "duplicate_invoice", description: "Duplicate an invoice draft", access: "action", input: "required", arguments: "<invoice number or ID> CONFIRM" },
  { command: "delete_draft", description: "Delete an invoice draft", access: "action", input: "required", arguments: "<invoice number or ID> CONFIRM" },
  { command: "match_invoice", description: "Match an invoice payment", access: "action", input: "required", arguments: "<transaction ID> | <invoice number or ID> | CONFIRM" },
  { command: "record_payment", description: "Record an invoice payment", access: "action", input: "required", arguments: "<invoice number or ID> | <JSON RecordInvoicePaymentPayload> | CONFIRM" },
  { command: "send_invoice", description: "Save or deliver through Merit", access: "action", input: "required", arguments: "<invoice number or ID> | <save|deliver> | CONFIRM" },
  { command: "create_expense", description: "Create an expense or supplier bill", access: "action", input: "required", arguments: "<JSON CreateExpensePayload> CONFIRM" },
  { command: "upload_receipt", description: "Open the secure receipt upload", access: "action", input: "required", arguments: "<expense number>", example: "/upload_receipt EXP-2026-001" },
  { command: "match_expense", description: "Match an expense payment", access: "action", input: "required", arguments: "<expense number or ID> | <transaction ID> | CONFIRM" },
  { command: "add_receivable", description: "Add a receivable", access: "action", input: "required", arguments: "<JSON CreateManualReceivablePayload> CONFIRM" },
  { command: "add_holding", description: "Add a holding", access: "action", input: "required", arguments: "<JSON CreateHoldingPayload> CONFIRM" },
  { command: "update_holding", description: "Update a holding", access: "action", input: "required", arguments: "<holding ID> | <JSON UpdateHoldingPayload> | CONFIRM" },
  { command: "save_cashflow", description: "Save a cash-flow snapshot", access: "action", input: "required", arguments: "<JSON SaveCashFlowSnapshotPayload> CONFIRM" },
  { command: "alerts", description: "Show notification rules", access: "read", input: "tap" },
  { command: "alert_add", description: "Add a notification rule", access: "action", input: "required", arguments: "<Slash virtual account> | <USD threshold> | CONFIRM", example: "/alert_add Wagner | 10000 | CONFIRM" },
  { command: "alert_remove", description: "Remove a notification rule", access: "action", input: "required", arguments: "<Slash virtual account> | CONFIRM" },
  { command: "alert_pause", description: "Pause a notification rule", access: "action", input: "required", arguments: "<Slash virtual account|all> | CONFIRM", example: "/alert_pause all | CONFIRM" },
  { command: "alert_resume", description: "Resume a notification rule", access: "action", input: "required", arguments: "<Slash virtual account|all> | CONFIRM", example: "/alert_resume all | CONFIRM" },
  { command: "alert_test", description: "Test a notification rule", access: "action", input: "required", arguments: "<Slash virtual account> | CONFIRM" },
  { command: "alert_history", description: "Show recent alert deliveries", access: "read", input: "tap" },
  { command: "digest", description: "Configure summary messages", access: "action", input: "required", arguments: "<HH:MM UTC|off> | CONFIRM", example: "/digest 14:00 | CONFIRM" },
  { command: "screenshot", description: "Receive a dashboard screenshot", access: "read", input: "optional", arguments: "[overview|bank|analytics|revenue|invoices|expenses|funding|distribution|management]", example: "/screenshot bank" },
  { command: "open", description: "Open a dashboard page", access: "read", input: "optional", arguments: "[overview|bank|analytics|revenue|invoices|expenses|funding|distribution|management]", example: "/open invoices" }
] as const;

export function telegramCommandUsage(command: FinanceTelegramCommand): string {
  return `/${command.command}${command.arguments ? ` ${command.arguments}` : ""}`;
}

export function telegramCommandMenuDescription(command: FinanceTelegramCommand): string {
  const prefix = command.input === "tap"
    ? "▶ TAP"
    : command.input === "optional"
      ? "⚙ OPTIONAL"
      : "✍ TYPE DETAILS";
  return `${prefix} · ${command.description}`;
}

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
