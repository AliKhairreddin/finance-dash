import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { buildDocumentZip, documentArchivePaths } from "./documentZip";
import type { FinancialDocument } from "./financialDocuments";

const pdf = new TextEncoder().encode("%PDF-1.7\noriginal test document\n%%EOF");
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const document = (id: string, fileName = "receipt.pdf"): FinancialDocument => ({
  _id: id, fileName, contentType: "application/pdf", size: pdf.length, source: "upload", status: "unmatched", kind: "expense", entity: "dn", month: "2026-08", createdAt: "2026-08-01T00:00:00Z"
});

test("ZIP preserves every selected original byte, folders, and duplicate filenames", async t => {
  const originals = [document("1"), document("2"), { ...document("3", "image.png"), entity: "lmd" as const, contentType: "image/png", size: png.length }];
  const urls: string[] = [], progress: number[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => { urls.push(url); return new Response(url.includes("/3/") ? png : pdf); });
  const blob = await buildDocumentZip(originals, { apiBase: "/api", signal: new AbortController().signal, onProgress: value => progress.push(value) });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(Object.keys(entries), ["Expenses/Digital Nudge/2026-08/receipt.pdf", "Expenses/Digital Nudge/2026-08/receipt (2).pdf", "Expenses/Love Me Do/2026-08/image.png"]);
  assert.deepEqual(entries[Object.keys(entries)[0]], pdf);
  assert.deepEqual(entries[Object.keys(entries)[1]], pdf);
  assert.deepEqual(entries[Object.keys(entries)[2]], png);
  assert.deepEqual(urls, ["/api/documents/1/file", "/api/documents/2/file", "/api/documents/3/file"]);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(blob.type, "application/zip");
});

test("archive paths cannot escape folders or overwrite names on case-insensitive systems", () => {
  const paths = documentArchivePaths([document("1", "../Receipt.pdf"), document("2", "../receipt.pdf"), document("3", "CON.pdf"), document("4", "receipt (2).pdf"), document("5"), document("6")]);
  assert.equal(new Set(paths.map(path => path.toLowerCase())).size, paths.length);
  assert.ok(paths.every(path => path.split("/").length === 4 && !path.includes("..")));
  assert.ok(paths[2].endsWith("/_CON.pdf"));
});

test("a missing original fails the whole export without returning an incomplete ZIP", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 404 }));
  await assert.rejects(buildDocumentZip([document("1")], { apiBase: "/api", signal: new AbortController().signal, onProgress: () => assert.fail("No original completed") }), /Could not download receipt.pdf/);
});

test("truncated originals and HTML sign-in pages are rejected", async t => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(pdf.slice(0, 8)));
  const options = { apiBase: "/api", signal: new AbortController().signal, onProgress: () => assert.fail("No original completed") };
  await assert.rejects(buildDocumentZip([document("1")], options), /incomplete/);
  const html = new TextEncoder().encode("<html>sign in</html>");
  fetchMock.mock.mockImplementation(async () => new Response(html));
  await assert.rejects(buildDocumentZip([{ ...document("1"), size: html.length }], options), /contents do not match/);
});

test("cancel stops before fetching the next document", async t => {
  const controller = new AbortController();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(pdf));
  await assert.rejects(buildDocumentZip([document("1"), document("2")], { apiBase: "/api", signal: controller.signal, onProgress: () => controller.abort() }), { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 1);
});
