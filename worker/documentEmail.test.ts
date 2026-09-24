import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { receiveDocumentEmail } from "./documentIntake";

const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", OPENROUTER_API_KEY: "test", PUBLIC_APP_URL: "https://finance.example", DOCUMENT_AI_MODEL: "test-model" };

test("email intake saves every supported attachment when a forward contains more than 15", async t => {
  const saved: string[] = [];
  t.mock.method(ConvexHttpClient.prototype, "query", async () => ({ allowedSenders: [] }));
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    if (getFunctionName(fn) === "dashboard:generateExpenseDocumentUploadUrl") return "https://storage.example/upload";
    if (getFunctionName(fn) === "documents:ingest") { saved.push(args.fileName as string); return { id: `document-${saved.length}`, duplicate: false }; }
    throw new Error(`Unexpected mutation: ${getFunctionName(fn)}`);
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ storageId: "stored-file" }));

  const boundary = "forwarded-financial-documents";
  const parts = Array.from({ length: 16 }, (_, index) => [
    `--${boundary}`,
    `Content-Type: application/pdf; name="receipt-${index + 1}.pdf"`,
    `Content-Disposition: attachment; filename="receipt-${index + 1}.pdf"`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(`%PDF-1.7\nReceipt ${index + 1}`).toString("base64")
  ].join("\r\n"));
  const raw = new TextEncoder().encode([
    "From: Ali <ali@example.com>",
    "To: receipts@finance.thatcanadian.dev",
    "Subject: Forwarded receipts",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts,
    `--${boundary}--`,
    ""
  ].join("\r\n"));
  const rejects: string[] = [];
  const message = {
    from: "ali@example.com",
    to: "receipts@finance.thatcanadian.dev",
    rawSize: raw.byteLength,
    raw: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(raw); controller.close(); } }),
    setReject(reason: string) { rejects.push(reason); }
  } as ForwardableEmailMessage;

  await receiveDocumentEmail(message, env);
  assert.deepEqual(rejects, []);
  assert.equal(saved.length, 16);
  assert.deepEqual(saved.sort(), Array.from({ length: 16 }, (_, index) => `receipt-${index + 1}.pdf`).sort());
});
