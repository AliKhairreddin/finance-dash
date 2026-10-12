import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { receiveContractEmail } from "./companyDocuments";
import { financeOperatorCanAccess, mediaSpendReviewerCanAccess } from "../shared/dashboardAccess";
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", OPENROUTER_API_KEY: "test", PUBLIC_APP_URL: "https://finance.example", DOCUMENT_AI_MODEL: "test-model" };
function email(parts: { name: string; content: string; type: string; disposition?: string }[], sender = "ali@example.com") {
  const boundary = "contract-files";
  const raw = new TextEncoder().encode(["From: Ali <ali@example.com>", "To: contracts@finance.thatcanadian.dev", "Subject: Fwd: Acme agreement", "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts.map(p => [`--${boundary}`, `Content-Type: ${p.type}`, `Content-Disposition: ${p.disposition ?? "attachment"}; filename="${p.name}"`, "Content-Transfer-Encoding: base64", "", Buffer.from(p.content).toString("base64")].join("\r\n")), `--${boundary}--`].join("\r\n"));
  const rejected: string[] = [];
  return { rejected, message: { from: sender, to: "contracts@finance.thatcanadian.dev", rawSize: raw.length, raw: new ReadableStream({ start(c) { c.enqueue(raw); c.close(); } }), setReject(reason: string) { rejected.push(reason); } } as ForwardableEmailMessage };
}
const pdf = { name: "Acme.pdf", content: "%PDF-1.7\nAcme agreement", type: "application/pdf" };
test("forwarded contracts save all attachments with email context, including inline PDFs, and never enter receipts", async t => {
  const saved: Record<string, unknown>[] = [];
  t.mock.method(ConvexHttpClient.prototype, "query", async () => ({ allowedSenders: ["ali@example.com"] }));
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    if (getFunctionName(fn) === "dashboard:generateExpenseDocumentUploadUrl") return "https://storage.example/upload";
    assert.equal(getFunctionName(fn), "companyDocuments:ingest"); saved.push(args); return { id: "contract", duplicate: false };
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ storageId: "blob" }));
  const received = email([pdf, { ...pdf, name: "appendix.pdf", disposition: "inline" }, { name: "terms.txt", type: "text/plain", content: "Acme terms" }]);
  await receiveContractEmail(received.message, env);
  assert.deepEqual(received.rejected, []); assert.equal(saved.length, 3);
  assert.match(saved[0].sourceContext as string, /Fwd: Acme agreement/); assert.equal(saved[0].source, "email"); assert.equal(saved[0].sender, "ali@example.com");
});
test("unsupported or oversized contracts are rejected before any attachment is saved", async t => {
  let writes = 0;
  t.mock.method(ConvexHttpClient.prototype, "query", async () => ({ allowedSenders: [] }));
  t.mock.method(ConvexHttpClient.prototype, "mutation", async () => { writes++; });
  const received = email([pdf, { name: "bad.exe", content: "binary", type: "application/octet-stream" }]);
  await receiveContractEmail(received.message, env); assert.equal(writes, 0); assert.equal(received.rejected.length, 1);
  const large = email([pdf]); Object.assign(large.message, { rawSize: 26 * 1024 * 1024 });
  await receiveContractEmail(large.message, env); assert.match(large.rejected[0], /25 MB/);
});
test("empty emails and blocked senders are explicitly rejected", async t => {
  t.mock.method(ConvexHttpClient.prototype, "query", async () => ({ allowedSenders: ["ali@example.com"] }));
  const empty = email([]); await receiveContractEmail(empty.message, env); assert.match(empty.rejected[0], /Attach a contract/);
  const blocked = email([pdf], "blocked@example.com"); await receiveContractEmail(blocked.message, env); assert.match(blocked.rejected[0], /Sender is not allowed/);
});
test("storage failures are propagated so a forwarded contract is not silently acknowledged", async t => {
  t.mock.method(ConvexHttpClient.prototype, "query", async () => ({ allowedSenders: [] }));
  t.mock.method(ConvexHttpClient.prototype, "mutation", async () => { throw new Error("Storage unavailable"); });
  const received = email([pdf]); await assert.rejects(receiveContractEmail(received.message, env), /Storage unavailable/);
});
test("contracts remain private to administrator accounts like the company directory", () => {
  for (const path of ["/api/contracts", "/api/contracts/id/file", "/api/contracts/upload", "/api/contracts/id/assign"]) for (const method of ["GET", "POST"]) {
    const request = new Request(`https://finance.example${path}`, { method });
    assert.equal(financeOperatorCanAccess(request), false); assert.equal(mediaSpendReviewerCanAccess(request), false);
  }
});
