import type { DashboardAccessRole } from "./types";

export const financeOperatorPages = ["banks", "documents", "analytics", "management"] as const;

export function dashboardPageAllowed(role: DashboardAccessRole, page: string): boolean {
  if (role === "administrator") return true;
  if (role === "transaction-reviewer") return page === "banks";
  if (role === "media-spend-reviewer") return page === "media-spend";
  return financeOperatorPages.some((allowed) => allowed === page);
}

export function dashboardHomePage(role: DashboardAccessRole): "overview" | "banks" | "media-spend" {
  if (role === "administrator") return "overview";
  return role === "media-spend-reviewer" ? "media-spend" : "banks";
}

export function mediaSpendReviewerCanAccess(request: Request): boolean {
  const path = new URL(request.url).pathname;
  if (request.method === "GET") {
    return ["/api/session", "/api/media-spend", "/api/media-spend/assignments",
      "/api/media-spend/wagner", "/api/media-spend/wagner/dimensions"].includes(path);
  }
  if (request.method === "POST") {
    return ["/api/media-spend/sync", "/api/media-funding/assignments", "/api/media-funding/payment-methods"].includes(path);
  }
  return false;
}

export function financeOperatorCanAccess(request: Request): boolean {
  const path = new URL(request.url).pathname;
  if (request.method === "GET") {
    return ["/api/session", "/api/dashboard", "/api/analytics", "/api/analytics/category-companies",
      "/api/transactions", "/api/transactions/lookup", "/api/transactions/summary", "/api/transactions/sync",
      "/api/management-report", "/api/documents", "/api/documents/config", "/api/documents/folders",
      "/api/amex/statements", "/api/amex/statements/accounts", "/api/invoice-payment-candidates"].includes(path)
      || /^\/api\/documents\/[^/]+(?:\/(?:file|candidates))?$/u.test(path)
      || /^\/api\/amex\/statements\/[^/]+(?:\/file)?$/u.test(path)
      || /^\/api\/expense-documents\/[^/]+$/u.test(path)
      || /^\/api\/invoices\/[^/]+\/pdf$/u.test(path)
      || /^\/api\/invoices\/[^/]+\/payment-suggestions$/u.test(path);
  }
  if (request.method === "POST") {
    return ["/api/sync", "/api/transactions/sync", "/api/transactions/slash-metadata-repair",
      "/api/transactions/auto-categorize", "/api/matches", "/api/invoices/auto-match-payments",
      "/api/wise/import-statement", "/api/holdings", "/api/fx/refresh", "/api/management-report/upload",
      "/api/documents/upload", "/api/documents/trash", "/api/documents/restore", "/api/amex/statements/upload",
      "/api/invoices", "/api/expenses", "/api/expense-documents/upload"].includes(path)
      || /^\/api\/transactions\/[^/]+\/(?:category|company|team|invoice-match)$/u.test(path)
      || /^\/api\/documents\/[^/]+\/(?:review|retry|match|candidates)$/u.test(path)
      || /^\/api\/amex\/statements\/[^/]+\/import$/u.test(path)
      || /^\/api\/expenses\/[^/]+\/match-payment$/u.test(path);
  }
  if (request.method === "PUT") {
    return path === "/api/documents/config" || /^\/api\/(?:holdings|invoices)\/[^/]+$/u.test(path);
  }
  if (request.method === "DELETE") {
    return /^\/api\/(?:holdings|documents)\/[^/]+$/u.test(path)
      || /^\/api\/amex\/statements\/[^/]+$/u.test(path);
  }
  return false;
}
