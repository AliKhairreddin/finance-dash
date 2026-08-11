import assert from "node:assert/strict";
import test from "node:test";
import {
  listOpenRouterZdrModels,
  requireOpenRouterZdrModel,
  runOpenRouterInvoicePaymentMatching,
  runOpenRouterPrompt,
  runOpenRouterTransactionCategorization
} from "./ai";
import type { Invoice, Provider, Transaction } from "./types";

test("OpenRouter requests always require Zero Data Retention routing", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      choices: [{ message: { content: "ZDR response" } }],
      model: "openai/gpt-5.6-sol"
    });
  };

  try {
    const result = await runOpenRouterPrompt(
      {
        provider: "openrouter",
        model: "openai/gpt-5.6-sol",
        openRouterApiKey: "test-key"
      },
      { prompt: "Summarize this transaction" }
    );

    assert.equal(result.output, "ZDR response");
    assert.deepEqual(requestBody?.provider, { zdr: true, data_collection: "deny" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the OpenRouter model catalog exposes only text-capable ZDR model options", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.match(String(input), /models\?zdr=true&output_modalities=text/);
    return Response.json({
      data: [
        {
          id: "openai/gpt-5.6-sol",
          name: "OpenAI: GPT-5.6 Sol",
          context_length: 1_050_000,
          architecture: { output_modalities: ["text"] }
        },
        {
          id: "example/image-only",
          name: "Image only",
          architecture: { output_modalities: ["image"] }
        }
      ]
    });
  };

  try {
    assert.deepEqual(await listOpenRouterZdrModels(), [
      {
        id: "openai/gpt-5.6-sol",
        name: "OpenAI: GPT-5.6 Sol",
        contextLength: 1_050_000
      }
    ]);
    assert.equal(await requireOpenRouterZdrModel(" openai/gpt-5.6-sol "), "openai/gpt-5.6-sol");
    await assert.rejects(
      () => requireOpenRouterZdrModel("openrouter/auto"),
      /Choose a Zero Data Retention model/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const aiTransaction: Transaction = {
  id: "slash-pizza-1",
  source: "slash",
  accountName: "Slash USD",
  date: "2026-07-30",
  description: "POS 10983 PIZZA HUT #442 TORONTO",
  rawName: "POS 10983 PIZZA HUT #442 TORONTO",
  counterparty: "PIZZA HUT #442",
  amount: 25,
  currency: "USD",
  direction: "out",
  status: "posted",
  category: "Uncategorized"
};

test("transaction AI requires one category and normalized merchant for every successful row", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const errors: string[] = [];
  console.error = (...values) => errors.push(values.map(String).join(" "));
  let output = JSON.stringify({
    matches: [{
      transactionId: aiTransaction.id,
      providerId: null,
      category: " food_and-meals ",
      merchantName: "Pizza Hut",
      confidence: 0.84,
      reason: "Restaurant merchant"
    }]
  });
  globalThis.fetch = async () => Response.json({
    choices: [{ message: { content: output } }],
    model: "openai/gpt-5.6-sol"
  });

  try {
    assert.deepEqual(
      await runOpenRouterTransactionCategorization(
        {
          provider: "openrouter",
          model: "openai/gpt-5.6-sol",
          openRouterApiKey: "test-key"
        },
        [aiTransaction],
        []
      ),
      [{
        transactionId: aiTransaction.id,
        category: "Food and meals",
        merchantName: "Pizza Hut",
        confidence: 0.84,
        reason: "Restaurant merchant"
      }]
    );

    output = JSON.stringify({ matches: [] });
    assert.deepEqual(
      await runOpenRouterTransactionCategorization(
        {
          provider: "openrouter",
          model: "openai/gpt-5.6-sol",
          openRouterApiKey: "test-key"
        },
        [aiTransaction],
        []
      ),
      []
    );
    assert.match(errors.at(-1) ?? "", /transaction_ai_categorization_batch_failed/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("transaction AI isolates an invalid multi-row response and retries smaller batches", async () => {
  const originalFetch = globalThis.fetch;
  const secondTransaction: Transaction = {
    ...aiTransaction,
    id: "slash-cursor-1",
    description: "CURSOR AI SUBSCRIPTION 8842",
    rawName: "CURSOR AI SUBSCRIPTION 8842",
    counterparty: "CURSOR AI"
  };
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = JSON.parse(body.messages.at(-1)?.content ?? "{}") as {
      transactions?: Array<{ id: string }>;
    };
    const transactions = prompt.transactions ?? [];
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            matches: transactions.length > 1
              ? []
              : transactions.map((transaction) => ({
                  transactionId: transaction.id,
                  providerId: null,
                  category: transaction.id === aiTransaction.id ? "Food and meals" : "Software",
                  merchantName: transaction.id === aiTransaction.id ? "Pizza Hut" : "Cursor",
                  confidence: 0.8,
                  reason: "Merchant evidence"
                }))
          })
        }
      }],
      model: "openai/gpt-5.6-sol"
    });
  };

  try {
    const results = await runOpenRouterTransactionCategorization(
      {
        provider: "openrouter",
        model: "openai/gpt-5.6-sol",
        openRouterApiKey: "test-key"
      },
      [aiTransaction, secondTransaction],
      []
    );
    assert.deepEqual(results.map((result) => result.transactionId).sort(), [
      aiTransaction.id,
      secondTransaction.id
    ].sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transaction AI preserves valid classifications when one isolated row keeps failing", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => undefined;
  const invalidTransaction: Transaction = {
    ...aiTransaction,
    id: "slash-invalid-1",
    description: "UNKNOWN MERCHANT 4812",
    rawName: "UNKNOWN MERCHANT 4812",
    counterparty: "UNKNOWN MERCHANT"
  };
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = JSON.parse(body.messages.at(-1)?.content ?? "{}") as {
      transactions?: Array<{ id: string }>;
    };
    const transactions = prompt.transactions ?? [];
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            matches: transactions
              .filter((transaction) => transaction.id !== invalidTransaction.id)
              .map((transaction) => ({
                transactionId: transaction.id,
                providerId: null,
                category: "Food and meals",
                merchantName: "Pizza Hut",
                confidence: 0.8,
                reason: "Merchant evidence"
              }))
          })
        }
      }],
      model: "openai/gpt-5.6-sol"
    });
  };

  try {
    const results = await runOpenRouterTransactionCategorization(
      {
        provider: "openrouter",
        model: "openai/gpt-5.6-sol",
        openRouterApiKey: "test-key"
      },
      [aiTransaction, invalidTransaction],
      []
    );
    assert.deepEqual(results.map((result) => result.transactionId), [aiTransaction.id]);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("invoice AI can select only an exact server-approved candidate", async () => {
  const originalFetch = globalThis.fetch;
  const provider: Provider = {
    id: "client",
    name: "Client Co",
    type: "client",
    tags: [],
    aliases: [],
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const invoice: Invoice = {
    id: "invoice-1",
    providerId: provider.id,
    documentType: "sales_invoice",
    origin: "manual",
    customerName: provider.name,
    amount: 1000,
    currency: "USD",
    status: "open",
    meritStatus: "open",
    meritDeliveryStatus: "saved",
    invoiceNumber: "2026/1001",
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    source: "merit",
    description: "Weekly services",
    revenueRunIds: [],
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z"
  };
  const transaction: Transaction = {
    id: "wise-income-1",
    source: "wise",
    accountName: "Wise USD",
    date: "2026-07-10",
    description: "Weekly services from Client Co",
    rawName: "Client Co",
    counterparty: "Client Co",
    amount: 1000,
    currency: "USD",
    direction: "in",
    status: "settled",
    category: "Partner network revenue",
    matchedProviderId: provider.id,
    companyMatchSource: "ai",
    companyConfidence: 0.9
  };
  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as {
      provider: unknown;
      messages: Array<{ content: string }>;
    };
    assert.deepEqual(request.provider, { zdr: true, data_collection: "deny" });
    const prompt = JSON.parse(request.messages.at(-1)?.content ?? "{}") as {
      payment_candidates: Array<{ transaction: { id: string }; invoices: Array<{ id: string }> }>;
    };
    assert.equal(prompt.payment_candidates[0].transaction.id, transaction.id);
    assert.deepEqual(prompt.payment_candidates[0].invoices.map((item) => item.id), [invoice.id]);
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ matches: [{
        transactionId: transaction.id,
        invoiceId: invoice.id,
        confidence: 0.97,
        reason: "Client and service description agree"
      }] }) } }],
      model: "deepseek/deepseek-v4-flash"
    });
  };

  try {
    assert.deepEqual(await runOpenRouterInvoicePaymentMatching(
      {
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
        openRouterApiKey: "test-key"
      },
      [transaction],
      [invoice],
      [],
      [provider]
    ), [{
      transactionId: transaction.id,
      invoiceId: invoice.id,
      confidence: 0.97,
      reason: "Client and service description agree"
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
