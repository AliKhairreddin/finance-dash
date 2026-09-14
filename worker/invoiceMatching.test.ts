import assert from "node:assert/strict";
import test from "node:test";
import { initialTransactionCategories } from "../shared/categories";
import type { Invoice, PaymentAllocation, Transaction } from "../shared/types";
import { runInvoicePaymentMatching } from "./handler";

const invoice: Invoice = {
  id: "invoice-exact", invoiceNumber: "INV-100", providerId: "client", customerName: "Client Ltd",
  amount: 1000, currency: "EUR", documentType: "sales_invoice", origin: "merit", status: "open",
  source: "merit", meritDeliveryStatus: "saved", description: "Services", issueDate: "2026-09-01",
  dueDate: "2026-09-10", revenueRunIds: [], createdAt: "2026-09-01", updatedAt: "2026-09-01"
};
const transaction: Transaction = {
  id: "payment-exact", source: "revolut", accountName: "Main", date: "2026-09-10", amount: 1000,
  currency: "EUR", direction: "in", status: "settled", description: "INV-100", counterparty: "Client Ltd",
  rawName: "Client Ltd", category: "Partner network revenue"
};

test("automatic matching persists exact payments before AI and rechecks manual decisions after AI", async () => {
  const originalFetch = globalThis.fetch;
  const aiInvoice = { ...invoice, id: "invoice-ai", invoiceNumber: "INV-200", amount: 2000 };
  let transactions = [transaction, {
    ...transaction, id: "payment-ai", amount: 2000, description: "Service payment", counterparty: "Unfamiliar sender",
    rawName: "Unfamiliar sender", matchedProviderId: "client", companyMatchSource: "ai" as const, companyConfidence: 0.82
  }];
  let invoices: Invoice[] = [invoice, aiInvoice];
  let paymentAllocations: PaymentAllocation[] = [];
  let updatedAt = "revision-1";
  let stateWrites = 0;
  let aiCalls = 0;
  const seenPaths: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("openrouter.ai")) {
      aiCalls += 1;
      assert.equal(stateWrites, 1, "Exact link must be durable before starting AI");
      assert.equal(invoices[0].transactionId, transaction.id);
      assert.equal(transactions[0].matchedInvoiceId, invoice.id);
      // Someone explicitly excludes this transaction while AI is running.
      transactions = transactions.map(item => item.id === "payment-ai" ? { ...item, invoiceMatchSource: "manual" } : item);
      updatedAt = "manual-revision";
      return Response.json({ choices: [{ message: { content: JSON.stringify({ matches: [
        { transactionId: "payment-ai", invoiceId: "invoice-ai", confidence: 0.98, reason: "Client identity matches" }
      ] }) } }] });
    }
    const body = JSON.parse(String(init?.body)) as { path: string; args: Array<Record<string, unknown>> };
    seenPaths.push(body.path);
    const args = body.args[0];
    let value: unknown;
    switch (body.path) {
      case "dashboard:getState": value = {
        invoices, updatedAt, paymentAllocations, providers: [{ id: "client", name: "Client Ltd", type: "client", aliases: [], tags: [], source: "manual", createdAt: "2026-09-01" }],
        expenses: [], transactionCategories: initialTransactionCategories, transactionCategoryRules: [], wiseStatementImports: []
      }; break;
      case "banking:getActivityMetadata": value = { syncStates: [], syncHealth: [], accounts: [] }; break;
      case "banking:getInvoicePaymentCandidates": value = { transactions, hasMore: false, continueCursor: null }; break;
      case "dashboard:saveState":
        assert.equal(args.expectedUpdatedAt, updatedAt);
        paymentAllocations = args.paymentAllocations as PaymentAllocation[];
        assert.equal(paymentAllocations.length, 1);
        assert.equal(paymentAllocations[0].transactionId, transaction.id);
        assert.equal(paymentAllocations[0].source, "revolut");
        assert.equal(paymentAllocations[0].paidAt, transaction.date);
        invoices = args.invoices as Invoice[];
        assert.equal(invoices[0].status, "paid");
        assert.equal(invoices[1].status, "open");
        stateWrites += 1;
        updatedAt = `revision-${stateWrites + 1}`;
        value = { updatedAt }; break;
      case "banking:saveTransactionUpdates":
      case "banking:applyTeamAssignmentsBatch": value = null; break;
      case "banking:applyMatchedInvoiceAssignmentsBatch":
        for (const assignment of args.assignments as Array<{ transactionId: string; matchedInvoiceId: string }>) {
          transactions = transactions.map(item => item.id === assignment.transactionId ? { ...item, matchedInvoiceId: assignment.matchedInvoiceId } : item);
        }
        value = null; break;
      default: throw new Error(`Unexpected call: ${body.path}`);
    }
    return Response.json({ status: "success", value });
  };
  try {
    const env = { CONVEX_URL: "https://invoice-matching-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-token", OPENROUTER_API_KEY: "test-key" } as Parameters<typeof runInvoicePaymentMatching>[0];
    const result = await runInvoicePaymentMatching(env);
    assert.equal(result.exactMatches, 1);
    assert.equal(result.paidInvoices, 1);
    assert.equal(result.aiMatches, 0);
    assert.equal(aiCalls, 1);
    assert.equal(stateWrites, 1);
    assert.equal(invoices[1].transactionId, undefined);
    const again = await runInvoicePaymentMatching(env, false);
    assert.equal(again.exactMatches, 0);
    assert.equal(again.paidInvoices, 0);
    assert.equal(paymentAllocations.length, 1);
    assert.equal(stateWrites, 1, "The scheduled rerun must not duplicate a saved link");
    assert.equal(seenPaths.some(path => path.includes("Profit") || path.includes("Snapshot")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automatic matching records nothing when candidate history cannot be completely checked", async () => {
  const originalFetch = globalThis.fetch;
  let pages = 0;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { path: string };
    let value: unknown;
    switch (body.path) {
      case "dashboard:getState": value = {
        invoices: [invoice], updatedAt: "revision-1", paymentAllocations: [], providers: [], expenses: [],
        transactionCategories: initialTransactionCategories, transactionCategoryRules: [], wiseStatementImports: []
      }; break;
      case "banking:getActivityMetadata": value = { syncStates: [], syncHealth: [], accounts: [] }; break;
      case "banking:getInvoicePaymentCandidates":
        pages += 1;
        value = { transactions: [transaction], hasMore: true, continueCursor: `page-${pages}` }; break;
      default: throw new Error(`No writes expected with incomplete history: ${body.path}`);
    }
    return Response.json({ status: "success", value });
  };
  try {
    const env = { CONVEX_URL: "https://invoice-history-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-token" } as Parameters<typeof runInvoicePaymentMatching>[0];
    await assert.rejects(runInvoicePaymentMatching(env, false), /could not cover all candidate history; no payments were recorded/);
    assert.ok(pages > 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
