import test from "node:test";
import assert from "node:assert/strict";
import puppeteer from "@cloudflare/puppeteer";
import { extractStatementText, parseStatementOcrResult, statementOcrHtml, StatementOcrError } from "./statementOcr";

test("OCR requires every page and preserves confidence warnings", () => {
  const payload = { pages: [{ page: 1, text: "Card ending 5196" }, { page: 2, text: "EUR 123.45" }], method: "ocr", warnings: ["Low OCR confidence"] };
  assert.deepEqual(parseStatementOcrResult(payload), payload);
  assert.throws(() => parseStatementOcrResult({ ...payload, pages: [payload.pages[1]] }), /incomplete/);
  assert.throws(() => parseStatementOcrResult({ error: "Password protected PDF" }), /Password protected/);
  assert.throws(() => parseStatementOcrResult(null), /Invalid/);
});
test("OCR document bytes are inert and network access stays on our assets", () => {
  const text = '</script><script>fetch("https://attacker.invalid")</script>';
  const html = statementOcrHtml(new TextEncoder().encode(text), "application/pdf");
  assert.ok(!html.includes(text));
  assert.ok(html.includes("isEvalSupported:false"));
  assert.ok(html.includes("cacheMethod:'none'"));
  assert.ok(html.includes("connect-src https://finance.thatcanadian.dev"));
  assert.ok(!html.includes("cdn.jsdelivr"));
});
test("OCR rejects unsupported or oversized input before using a browser", async () => {
  const unexpected = async () => { throw new Error("Unexpected browser call"); };
  const env = { BROWSER: { quickAction: unexpected, fetch: unexpected } };
  await assert.rejects(extractStatementText(env, new Uint8Array(0), "application/pdf"), /15 MB/);
  await assert.rejects(extractStatementText(env, new Uint8Array(1), "text/html"), /Use a PDF/);
  assert.deepEqual(await extractStatementText(env, new TextEncoder().encode("Statement text"), "text/plain"), { pages: [{ page: 1, text: "Statement text" }], method: "text", warnings: [] });
});

test("OCR waits for asynchronous page completion and closes the private browser session", async t => {
  let finished = false, closed = false;
  t.mock.method(puppeteer, "launch", async () => ({ newPage: async () => ({
    setCacheEnabled: async () => {}, setContent: async () => {},
    waitForSelector: async () => { await new Promise(resolve => setTimeout(resolve, 5)); finished = true; },
    $eval: async () => { assert.equal(finished, true); return JSON.stringify({ pages: [{ page: 1, text: "Total EUR 123.45" }], method: "pdf-text", warnings: [] }); }
  }), close: async () => { closed = true; } }) as unknown as Awaited<ReturnType<typeof puppeteer.launch>>);
  const result = await extractStatementText({ BROWSER: {} as WorkerEnv["BROWSER"] }, new Uint8Array([1]), "application/pdf");
  assert.equal(result.pages[0].text, "Total EUR 123.45"); assert.equal(closed, true);
});

test("OCR failure closes its browser session and never returns partial output", async t => {
  let closed = false;
  t.mock.method(puppeteer, "launch", async () => ({ newPage: async () => ({
    setCacheEnabled: async () => {}, setContent: async () => {}, waitForSelector: async () => { throw new Error("Extraction timed out"); }
  }), close: async () => { closed = true; } }) as unknown as Awaited<ReturnType<typeof puppeteer.launch>>);
  await assert.rejects(extractStatementText({ BROWSER: {} as WorkerEnv["BROWSER"] }, new Uint8Array([1]), "application/pdf"), /timed out/);
  assert.equal(closed, true);
});

test("browser capacity limits preserve the provider retry deadline", async t => {
  t.mock.method(puppeteer, "launch", async (binding: Parameters<typeof puppeteer.launch>[0]) => {
    await binding.fetch("https://browser.invalid/v1/acquire");
    throw new Error("Rate-limited browser should not launch");
  });
  const env = { BROWSER: { fetch: async () => new Response("Busy", { status: 429, headers: { "Retry-After": "90" } }), quickAction: async () => { throw new Error("Not used"); } } };
  await assert.rejects(extractStatementText(env, new Uint8Array([1]), "application/pdf"), error => error instanceof StatementOcrError && error.retryAfterMs === 90000);
});

test("browser retry delays beyond one hour are preserved for seconds and HTTP dates", async t => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  t.mock.method(puppeteer, "launch", async (binding: Parameters<typeof puppeteer.launch>[0]) => {
    await binding.fetch("https://browser.invalid/v1/acquire");
    throw new Error("Rate-limited browser should not launch");
  });
  for (const retryAfter of ["7200", "Sun, 25 Oct 2026 14:00:00 GMT"]) {
    const env = { BROWSER: { fetch: async () => new Response("Busy", { status: 503, headers: { "Retry-After": retryAfter } }), quickAction: async () => { throw new Error("Not used"); } } };
    await assert.rejects(extractStatementText(env, new Uint8Array([1]), "application/pdf"), error => error instanceof StatementOcrError && error.retryAfterMs === 7_200_000);
  }
});
