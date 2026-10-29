import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { handleStatementResearch, researchMerchant } from "./statementResearch";

const profile = {
  canonicalName: "Synthetic Hosting", website: "https://merchant.example", category: "hosting",
  address: "", addressType: "unknown", country: "", logoSource: "", description: "Web hosting services",
  sources: ["https://merchant.example/about"], confidence: 0.7, conflicts: [],
};
const answer = (sources: string[] = profile.sources, finish_reason = "stop") => ({ choices: [{ finish_reason, message: {
  content: JSON.stringify(profile), annotations: sources.map(url => ({ type: "url_citation", url_citation: { url, title: "Official company", content: "Synthetic Hosting provides web hosting services." } })),
} }] });
const env = { OPENROUTER_API_KEY: "synthetic-key", CONVEX_SERVICE_TOKEN: "synthetic-service", CONVEX_URL: "https://fixture.convex.cloud" };

test("merchant research reuses OpenRouter with bounded explicit search and only sends the merchant name", async context => {
  context.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-key");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "saved-model");
    if (body.tools) {
      assert.equal(body.tools[0].type, "openrouter:web_search");
      assert.equal(body.tools[0].parameters.engine, "exa");
      assert.equal(body.tools[0].parameters.max_uses, 1);
      assert.equal(body.tools[0].parameters.max_total_results, 5);
      assert.equal(body.max_tool_calls, 2);
      assert.deepEqual(JSON.parse(body.messages[1].content), { merchant: "Synthetic Hosting" });
    } else {
      assert.equal(body.response_format.type, "json_object");
      assert.deepEqual(JSON.parse(body.messages[1].content), { merchant: "Synthetic Hosting", evidence: [{ url: profile.sources[0], title: "Official company", content: "Synthetic Hosting provides web hosting services." }] });
    }
    assert.deepEqual(body.provider, { data_collection: "deny", zdr: true, allow_fallbacks: false });
    return Response.json(answer());
  });
  const result = await researchMerchant(env.OPENROUTER_API_KEY, "saved-model", "Synthetic Hosting");
  assert.deepEqual(result.suggestion, profile);
  assert.deepEqual(result.sources, profile.sources);
});

test("merchant research rejects model-invented sources, absent citations, and unfinished output", async context => {
  const mock = context.mock.method(globalThis, "fetch", async () => Response.json(answer([])));
  await assert.rejects(researchMerchant("fixture", "model", "Merchant"), /retrieved source/);
  mock.mock.mockImplementation(async () => Response.json(answer(["https://different.example"])));
  await assert.rejects(researchMerchant("fixture", "model", "Merchant"), /retrieved source/);
  mock.mock.mockImplementation(async () => Response.json(answer(profile.sources, "length")));
  await assert.rejects(researchMerchant("fixture", "model", "Merchant"), /did not finish/);
});

test("credentials, authentication and request shape are checked before research", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Unexpected network request"); });
  await assert.rejects(researchMerchant("", "model", "Merchant"), /OPENROUTER_API_KEY/);
  await assert.rejects(researchMerchant("fixture", "", "Merchant"), /model in Settings/);
  const url = "https://statements.thatcanadian.dev/api/internal/statements/research";
  assert.equal((await handleStatementResearch(new Request(url, { method: "POST" }), env)).status, 401);
  const headers = { Authorization: `Bearer ${env.CONVEX_SERVICE_TOKEN}` };
  assert.equal((await handleStatementResearch(new Request(url, { headers }), env)).status, 405);
  assert.equal((await handleStatementResearch(new Request(url, { method: "POST", headers, body: "x".repeat(2050) }), env)).status, 400);
  assert.equal(calls, 0);
});

test("rate limits retain retry guidance and credential errors do not expose provider bodies", async context => {
  const mock = context.mock.method(globalThis, "fetch", async () => new Response("sensitive provider diagnostic", { status: 429, headers: { "Retry-After": "3600" } }));
  await assert.rejects(researchMerchant("fixture", "model", "Merchant"), error => {
    assert.equal((error as { retryAfter: number }).retryAfter, 3600);
    assert.equal((error as { blocked: boolean }).blocked, false);
    assert.doesNotMatch(String(error), /sensitive/); return true;
  });
  mock.mock.mockImplementation(async () => new Response("sensitive provider diagnostic", { status: 401 }));
  await assert.rejects(researchMerchant("fixture", "model", "Merchant"), error => {
    assert.equal((error as { blocked: boolean }).blocked, true);
    assert.doesNotMatch(String(error), /sensitive/); return true;
  });
});

test("processor resolves leased jobs on the server and the verification request uses a fixed public company", async context => {
  const queries: unknown[][] = [];
  context.mock.method(ConvexHttpClient.prototype, "query", async (...args: unknown[]) => {
    queries.push(args);
    if ((args[1] as { id?: string }).id) return { name: "Synthetic Hosting", model: "saved-model" };
    return { aiSettingsJson: JSON.stringify({ provider: "openrouter", model: "saved-model" }) };
  });
  const names: string[] = [];
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    names.push(JSON.parse(JSON.parse(String(init?.body)).messages[1].content).merchant);
    return Response.json(answer());
  });
  const request = () => new Request("https://statements.thatcanadian.dev/api/internal/statements/research", { method: "POST", headers: { Authorization: `Bearer ${env.CONVEX_SERVICE_TOKEN}` }, body: JSON.stringify({ id: "fixture-id", token: "lease", name: "ignore this untrusted name", amount: "1000" }) });
  assert.equal((await handleStatementResearch(request(), env)).status, 200);
  assert.deepEqual(queries[0][1], { serviceToken: env.CONVEX_SERVICE_TOKEN, id: "fixture-id", token: "lease" });
  assert.equal((await handleStatementResearch(request(), env, true)).status, 200);
  assert.deepEqual(names, ["Synthetic Hosting", "Synthetic Hosting", "Cloudflare Inc.", "Cloudflare Inc."]);
});

test("search prose and citation markers are kept separate from structured profile extraction", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    if (calls === 1) {
      assert.equal(body.response_format, undefined);
      const response = answer();
      response.choices[0].message.content = "Official company information [1](https://merchant.example/about). This is not JSON.";
      return Response.json(response);
    }
    assert.equal(body.tools, undefined);
    assert.doesNotMatch(body.messages[1].content, /This is not JSON/);
    return Response.json(answer());
  });
  assert.deepEqual((await researchMerchant("fixture", "model", "Merchant")).suggestion, profile);
  assert.equal(calls, 2);
});
