import test from "node:test";
import assert from "node:assert/strict";
import { applySelectedBatches, changeSelectedPage, collectSelectedRows } from "./statementSelection";
const rows = Array.from({ length: 125 }, (_, i) => ({ _id: String(i), status: i % 2 ? "pending" : "reconciled" }));
test("selection preserves other pages, row metadata and unique IDs when selecting or clearing a page", () => {
  const first = changeSelectedPage([], rows.slice(0, 50), true);
  const both = changeSelectedPage(first, rows.slice(40, 100), true);
  assert.equal(both.length, 100);
  const remaining = changeSelectedPage(both, rows.slice(0, 50), false);
  assert.deepEqual(remaining, rows.slice(50, 100));
});
test("select all loads every matching page and rejects incomplete or changing lists", async () => {
  const result = await collectSelectedRows(async offset => ({ transactions: rows.slice(offset, offset + 50), total: rows.length, hasMore: offset + 50 < rows.length, truncated: false }), rows.length);
  assert.deepEqual(result, rows);
  await assert.rejects(collectSelectedRows(async () => ({ transactions: rows.slice(0, 50), total: 125, hasMore: true, truncated: true }), 125), /smaller date range/);
  await assert.rejects(collectSelectedRows(async () => ({ transactions: rows, total: 126, hasMore: false, truncated: false }), 125), /list changed/);
  await assert.rejects(collectSelectedRows(async () => ({ transactions: rows.slice(0, 50), total: 125, hasMore: true, truncated: false }), 125), /list changed/);
  await assert.rejects(collectSelectedRows(async () => ({ transactions: [], total: 125, hasMore: false, truncated: false }), 125), /could not be loaded/);
});
test("select all ignores a response after the user changes filters", async () => {
  const abort = new AbortController();
  await assert.rejects(collectSelectedRows(async () => { abort.abort(); return { transactions: rows, total: 125, hasMore: false, truncated: false }; }, 125, abort.signal), { name: "AbortError" });
});
test("bulk actions use bounded batches and report only confirmed changes on a partial failure", async () => {
  const calls: string[][] = [], confirmed: string[] = [];
  await assert.rejects(applySelectedBatches(rows.map(r => r._id), async batch => { calls.push(batch); if (calls.length === 2) throw new Error("response lost"); }, ids => confirmed.push(...ids)), /response lost/);
  assert.deepEqual(calls.map(c => c.length), [50, 50]);
  assert.deepEqual(confirmed, rows.slice(0, 50).map(r => r._id));
  const completed: string[][] = [];
  await applySelectedBatches([...rows.map(r => r._id), "0"], async () => {}, ids => completed.push(ids));
  assert.deepEqual(completed.map(c => c.length), [50, 50, 25]);
});
