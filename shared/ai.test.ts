import assert from "node:assert/strict";
import test from "node:test";
import {
  listOpenRouterZdrModels,
  requireOpenRouterZdrModel,
  runOpenRouterPrompt
} from "./ai";

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
