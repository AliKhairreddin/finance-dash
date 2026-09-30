import assert from "node:assert/strict";
import test from "node:test";
import { dashboardPageAllowed, financeOperatorCanAccess } from "./dashboardAccess";

test("finance operators can navigate exactly the requested pages", () => {
  for (const page of ["banks", "documents", "analytics", "management"]) {
    assert.equal(dashboardPageAllowed("finance-operator", page), true, page);
  }
  for (const page of ["overview", "media-spend", "media-funding", "distribution", "revenue", "invoices", "expenses", "cash-flow", "providers", "settings"]) {
    assert.equal(dashboardPageAllowed("finance-operator", page), false, page);
    assert.equal(dashboardPageAllowed("administrator", page), true, page);
  }
  assert.equal(dashboardPageAllowed("transaction-reviewer", "banks"), true);
  assert.equal(dashboardPageAllowed("transaction-reviewer", "documents"), false);
});

test("finance operator APIs allow complete banking, document and workbook workflows", () => {
  for (const [method, path] of [
    ["GET", "/api/session"], ["GET", "/api/dashboard"], ["GET", "/api/transactions?limit=100"],
    ["GET", "/api/transactions/summary"], ["GET", "/api/transactions/lookup?id=tx"],
    ["GET", "/api/analytics/category-companies"], ["GET", "/api/management-report"],
    ["POST", "/api/management-report/upload"], ["POST", "/api/sync"], ["POST", "/api/wise/import-statement"],
    ["POST", "/api/transactions/sync"], ["GET", "/api/transactions/sync"],
    ["POST", "/api/transactions/slash-metadata-repair"], ["POST", "/api/transactions/tx/category"],
    ["POST", "/api/transactions/tx/company"], ["POST", "/api/transactions/tx/team"],
    ["POST", "/api/transactions/tx/invoice-match"], ["POST", "/api/matches"],
    ["POST", "/api/holdings"], ["PUT", "/api/holdings/h"], ["DELETE", "/api/holdings/h"],
    ["POST", "/api/fx/refresh"], ["GET", "/api/amex/statements/accounts"],
    ["POST", "/api/amex/statements/upload"], ["POST", "/api/amex/statements/s/import"],
    ["DELETE", "/api/amex/statements/s"], ["GET", "/api/amex/statements/s/file"],
    ["GET", "/api/documents"], ["POST", "/api/documents/upload"], ["GET", "/api/documents/d/file"],
    ["POST", "/api/documents/d/review"], ["POST", "/api/documents/d/retry"],
    ["POST", "/api/documents/d/match"], ["POST", "/api/documents/d/candidates"],
    ["POST", "/api/documents/trash"], ["POST", "/api/documents/restore"], ["DELETE", "/api/documents/d"],
    ["PUT", "/api/documents/config"], ["GET", "/api/invoices/i/payment-suggestions"],
    ["POST", "/api/invoices"], ["PUT", "/api/invoices/i"], ["POST", "/api/expenses"],
    ["POST", "/api/expenses/e/match-payment"], ["POST", "/api/expense-documents/upload"],
    ["GET", "/api/expense-documents/d"], ["GET", "/api/invoices/i/pdf"]
  ]) {
    assert.equal(financeOperatorCanAccess(new Request(`https://finance.example${path}`, { method })), true, `${method} ${path}`);
  }
});

test("finance operator APIs deny unrelated administration and unknown routes or methods", () => {
  for (const [method, path] of [
    ["GET", "/api/partner-updates"], ["POST", "/api/partner-updates"],
    ["POST", "/api/settings/ai"], ["POST", "/api/settings/categories"],
    ["POST", "/api/telegram/configure"], ["POST", "/api/admin/wise/reset"],
    ["POST", "/api/providers"], ["DELETE", "/api/providers/p"],
    ["POST", "/api/revenue/draft"], ["POST", "/api/distribution/adjustments"],
    ["POST", "/api/receivables"], ["POST", "/api/invoices/send"],
    ["GET", "/api/internal/documents/process"], ["GET", "/api/documents-extra"],
    ["PATCH", "/api/documents/d"], ["DELETE", "/api/management-report"],
    ["POST", "/api/transactions/tx/unknown"], ["GET", "/api/analytics/private"]
  ]) {
    assert.equal(financeOperatorCanAccess(new Request(`https://finance.example${path}`, { method })), false, `${method} ${path}`);
  }
});
