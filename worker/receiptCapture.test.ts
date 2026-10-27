import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { routeReceiptCapture, receiptCaptureHostname } from "./receiptCapture";
import { routeStatementSurface } from "./statementRouting";
const origin = `https://${receiptCaptureHostname}`;
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "test", ASSETS: { fetch: async (request: Request) => new Response(new URL(request.url).pathname) } } as unknown as WorkerEnv;
const key = "a".repeat(64);
function request(path: string, init?: RequestInit) { return new Request(`${origin}${path}`, init); }
function post(bytes: Uint8Array, token = key, from = origin) { return request("/api/capture", { method: "POST", headers: { Authorization: `Bearer ${token}`, Origin: from, "Content-Type": "application/pdf" }, body: new Uint8Array(bytes) }); }
const success = (value: unknown) => Response.json({ status: "success", value });
test("camera host opens without a session and blocks every dashboard/internal API", async () => {
  const response = await routeStatementSurface(request("/"), env);
  assert.equal(response?.status, 200); assert.equal(await response?.text(), "/receipt-capture");
  assert.match(response!.headers.get("Permissions-Policy")!, /camera=\(self\)/);
  assert.equal(response!.headers.get("Referrer-Policy"), "no-referrer");
  for (const path of ["/api/session", "/api/snapshot", "/api/statements/documents", "/api/internal/statements/setup", "/login", "/top-up"]) {
    assert.equal((await routeStatementSurface(request(path), env))?.status, 404, path);
  }
  assert.equal((await routeReceiptCapture(request("/receipt-capture.webmanifest"), env))?.status, 200);
  for (const path of ["/receipt-icons/camera-receipt-v1.svg", "/receipt-icons/camera-receipt-180-v1.png", "/receipt-icons/camera-receipt-192-v1.png", "/receipt-icons/camera-receipt-512-v1.png"]) {
    assert.equal(await (await routeReceiptCapture(request(path), env))?.text(), path);
  }
  assert.equal(await routeReceiptCapture(new Request("https://finance.thatcanadian.dev/"), env), null);
});
test("uploads require an upload key and same origin, never a dashboard cookie", async () => {
  const bytes = new TextEncoder().encode("%PDF-");
  assert.equal((await routeReceiptCapture(post(bytes, "", origin), env))?.status, 401);
  assert.equal((await routeReceiptCapture(post(bytes, key, "https://evil.invalid"), env))?.status, 403);
  assert.equal((await routeReceiptCapture(request("/api/capture"), env))?.status, 404);
});
test("confirmed mobile upload uses existing durable PDF intake and hides private document IDs", async () => {
  const original = globalThis.fetch, calls: Array<{ path: string; args: Record<string, unknown>[] }> = [];
  const document = await PDFDocument.create(); document.addPage([300, 600]); const bytes = await document.save();
  let stored: Blob | undefined;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://storage.invalid/upload") { stored = init?.body as Blob; return Response.json({ storageId: "file1" }); }
    const call = JSON.parse(String(init?.body)); calls.push(call);
    return success(call.path.endsWith(":acceptUpload") ? { actor: "Ali", retryAfter: 0 } : call.path.endsWith(":generateUploadUrl") ? "https://storage.invalid/upload" : { id: "private-doc-id", duplicate: false });
  };
  try {
    const response = await routeReceiptCapture(post(bytes), env);
    assert.equal(response?.status, 202); assert.deepEqual(await response?.json(), { saved: true, duplicate: false });
    assert.deepEqual(new Uint8Array(await stored!.arrayBuffer()), bytes);
    const ingest = calls.find(call => call.path.endsWith(":ingestDocument"))!.args[0];
    assert.equal(ingest.actor, "Ali"); assert.equal(ingest.contentType, "application/pdf"); assert.equal(ingest.quarantined, false);
    assert.match(String(ingest.sourceContext), /photograph/);
    assert.equal(JSON.stringify(calls).includes(key), false);
  } finally { globalThis.fetch = original; }
});
test("revocation, rate limits, invalid files and uncertain storage never report success", async () => {
  const original = globalThis.fetch;
  const document = await PDFDocument.create(); document.addPage(); const bytes = await document.save();
  try {
    globalThis.fetch = async () => success({ actor: null, retryAfter: 0 });
    assert.equal((await routeReceiptCapture(post(bytes), env))?.status, 401);
    globalThis.fetch = async () => success({ actor: null, retryAfter: 55 });
    const limited = await routeReceiptCapture(post(bytes), env);
    assert.equal(limited?.status, 429); assert.equal(limited?.headers.get("Retry-After"), "55");
    globalThis.fetch = async () => success({ actor: "Ali", retryAfter: 0 });
    assert.equal((await routeReceiptCapture(post(new TextEncoder().encode("invalid")), env))?.status, 400);
    document.addPage(); assert.equal((await routeReceiptCapture(post(await document.save()), env))?.status, 400);
    globalThis.fetch = async () => { throw new Error("network failed"); };
    const failed = await routeReceiptCapture(post(bytes), env);
    assert.equal(failed?.status, 502); assert.equal((await failed?.json() as { saved?: boolean }).saved, undefined);
  } finally { globalThis.fetch = original; }
});
