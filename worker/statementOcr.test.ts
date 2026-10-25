import test from "node:test";
import assert from "node:assert/strict";
import { extractStatementText, parseStatementOcrResult, statementOcrHtml } from "./statementOcr";

const result = (payload: unknown) => ({ success: true, result: [{ selector: "#result", results: [{ text: JSON.stringify(payload) }] }] });
test("OCR requires every page and preserves confidence warnings", () => {
  const payload = { pages: [{ page: 1, text: "Card ending 5196" }, { page: 2, text: "EUR 123.45" }], method: "ocr", warnings: ["Low OCR confidence"] };
  assert.deepEqual(parseStatementOcrResult(result(payload)), payload);
  assert.throws(() => parseStatementOcrResult(result({ ...payload, pages: [payload.pages[1]] })), /incomplete/);
  assert.throws(() => parseStatementOcrResult(result({ error: "Password protected PDF" })), /Password protected/);
  assert.throws(() => parseStatementOcrResult({ success: false }), /failed/);
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
  const env = { BROWSER: { quickAction: async () => { throw new Error("Unexpected browser call"); } } };
  await assert.rejects(extractStatementText(env, new Uint8Array(0), "application/pdf"), /15 MB/);
  await assert.rejects(extractStatementText(env, new Uint8Array(1), "text/html"), /Use a PDF/);
  assert.deepEqual(await extractStatementText(env, new TextEncoder().encode("Statement text"), "text/plain"), { pages: [{ page: 1, text: "Statement text" }], method: "text", warnings: [] });
});
