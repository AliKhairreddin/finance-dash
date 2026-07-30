import assert from "node:assert/strict";
import test from "node:test";
import {
  listOpenRouterZdrModels,
  requireOpenRouterZdrModel,
  runOpenRouterPrompt,
  runOpenRouterTransactionCategorization
} from "./ai";
import type { Transaction } from "./types";

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
    assert.deepEqual(requestBody?.provider, { zdr: true });
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

test("transaction AI requires one category and normalized merchant for every row", async () => {
  const originalFetch = globalThis.fetch;
  let output = JSON.stringify({
    matches: [{
      transactionId: aiTransaction.id,
      providerId: null,
      category: "Food and meals",
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
    await assert.rejects(
      () => runOpenRouterTransactionCategorization(
        {
          provider: "openrouter",
          model: "openai/gpt-5.6-sol",
          openRouterApiKey: "test-key"
        },
        [aiTransaction],
        []
      ),
      /one valid category and merchant for every transaction/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
