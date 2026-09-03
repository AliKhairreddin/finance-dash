import assert from "node:assert/strict";
import test from "node:test";
import {
  financeTelegramCommands,
  parseTelegramCommandUsers,
  readOnlyFinanceTelegramCommands
} from "./telegramCommandCatalog";

const requestedCommands = `
menu help whoami cancel ask overview balances cashflow receivables payables holdings fx
transactions transaction needs_review search cashback export_transactions analytics spend income
top_companies top_categories revenue revenue_runs revenue_pull draft_revenue invoices invoice overdue
due_soon invoice_pdf payment_candidates expenses expense unpaid_bills missing_documents expense_document
media_spend provider_funds distribution management companies teams health sync categorize assign_company
assign_team create_invoice edit_invoice duplicate_invoice delete_draft match_invoice record_payment
send_invoice create_expense upload_receipt match_expense add_receivable add_holding update_holding
save_cashflow alerts alert_add alert_remove alert_pause alert_resume alert_test alert_history digest
screenshot open
`.trim().split(/\s+/u).sort();

test("Telegram catalog contains every requested command exactly once", () => {
  const actual = financeTelegramCommands.map(({ command }) => command);
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual([...actual].sort(), requestedCommands);
  assert.ok(actual.length <= 100);
});

test("CEO command menu contains every data command and no action commands", () => {
  assert.ok(readOnlyFinanceTelegramCommands.length > 0);
  assert.ok(readOnlyFinanceTelegramCommands.every(({ access }) => access === "read"));
  assert.equal(readOnlyFinanceTelegramCommands.some(({ command }) => command === "sync"), false);
  assert.equal(readOnlyFinanceTelegramCommands.some(({ command }) => command === "overview"), true);
});

test("Telegram role lists normalize whitespace and reject duplicates", () => {
  assert.deepEqual(
    parseTelegramCommandUsers(" Ali, Ali   M ", "users"),
    ["Ali", "Ali M"]
  );
  assert.throws(() => parseTelegramCommandUsers("Ali, ali", "users"), /duplicate users/);
  assert.throws(() => parseTelegramCommandUsers(undefined, "users"), /must contain 1-20 users/);
});
