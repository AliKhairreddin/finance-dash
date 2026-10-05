import assert from "node:assert/strict";
import test from "node:test";
import { dashboardHomePage, dashboardPageAllowed, financeOperatorCanAccess, mediaSpendReviewerCanAccess } from "./dashboardAccess";

test("media spend reviewers land on Media Spend and cannot navigate other pages", () => {
  assert.equal(dashboardHomePage("media-spend-reviewer"), "media-spend");
  assert.equal(dashboardPageAllowed("media-spend-reviewer", "media-spend"), true);
  for (const page of ["overview", "banks", "documents", "analytics", "management", "media-funding", "distribution", "revenue", "invoices", "expenses", "cash-flow", "providers", "settings"]) {
    assert.equal(dashboardPageAllowed("media-spend-reviewer", page), false, page);
  }
});

test("media spend reviewer APIs allow the full spend page but deny other financial data and mutations", () => {
  for (const [method, path] of [
    ["GET", "/api/session"], ["GET", "/api/media-spend?fromDate=2026-10-01&toDate=2026-10-04"],
    ["GET", "/api/media-spend/assignments"], ["POST", "/api/media-spend/sync"],
    ["POST", "/api/media-funding/assignments"], ["POST", "/api/media-funding/payment-methods"]
  ]) {
    assert.equal(mediaSpendReviewerCanAccess(new Request(`https://finance.example${path}`, { method })), true, `${method} ${path}`);
  }
  for (const [method, path] of [
    ["GET", "/api/dashboard"], ["GET", "/api/media-funding"], ["GET", "/api/transactions"],
    ["GET", "/api/documents"], ["GET", "/api/analytics"], ["GET", "/api/management-report"],
    ["GET", "/api/media-spend/private"], ["POST", "/api/media-spend"], ["POST", "/api/sync"],
    ["POST", "/api/media-funding/providers"], ["POST", "/api/media-funding/entries"],
    ["DELETE", "/api/media-funding/assignments/a"], ["PATCH", "/api/media-funding/providers/p"],
    ["GET", "/api/media-funding/assignments"], ["PUT", "/api/media-spend/assignments"],
    ["POST", "/api/media-funding/assignments/extra"], ["POST", "/api/telegram/configure"]
  ]) {
    assert.equal(mediaSpendReviewerCanAccess(new Request(`https://finance.example${path}`, { method })), false, `${method} ${path}`);
  }
});

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
