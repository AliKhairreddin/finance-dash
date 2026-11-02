import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kissterraFixture } from "../shared/kissterraBilling.fixture";

test("weekly server automation and manual drafting share one Kissterra invoice", async t => {
  const f = kissterraFixture(), previousDirectory = process.cwd(), previousEnv = { ...process.env };
  const directory = await mkdtemp(join(tmpdir(), "kissterra-weekly-"));
  let pulls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    assert.ok(url.hostname.endsWith("api.hasoffers.com"), "only revenue reads are allowed");
    const id = url.searchParams.get("api_key");
    const payout = f.runs.find(r => r.partnerName.includes(`Account ID: ${id}`))!.revenue;
    const stat = { payout: String(payout), clicks: "1", conversions: "1" };
    pulls++;
    return Response.json({ response: { status: 1, data: { page: 1, current: 50, count: 1, pageCount: 1, totals: { Stat: stat }, data: [{ Stat: { ...stat, date: url.searchParams.get("data_start") } }] } } });
  });
  try {
    process.chdir(directory);
    await mkdir(".local");
    await writeFile(".local/finance-dashboard-store.json", JSON.stringify({ ...f.state, revenuePartners: f.partners, automationRuns: [], paymentAllocations: [], fxRates: [], holdings: [], expenses: [], manualReceivables: [] }));
    process.env.KISSTERRA_TUNE_NETWORK_ID = "fixture";
    for (const id of ["1777", "2036", "2205", "2230"]) process.env[`KEY_${id}`] = id;
    const store = await import("./store");
    await store.initializeStore();
    await store.runIncomeAutomation(f.now, true);
    const saved = JSON.parse(await readFile(".local/finance-dashboard-store.json", "utf8"));
    assert.equal(saved.invoices.length, 2);
    const invoice = saved.invoices.find((i: { origin: string }) => i.origin === "revenue");
    assert.equal(invoice.amount, 259024.93);
    assert.equal(invoice.revenueLines.length, 2);
    assert.equal(saved.automationRuns[0].status, "completed");
    assert.equal(pulls, 8, "four closed reports and four current accrual reports");
    const repeated = await store.draftRevenueRun({ partnerId: f.partners[1].id, ...f.period, timezone: "UTC" });
    assert.equal(repeated.id, invoice.id);
    assert.equal(pulls, 8);
    await store.deleteInvoiceDrafts([invoice.id]);
    const recreated = await store.draftRevenueRun({ partnerId: f.partners[0].id, ...f.period, timezone: "UTC" });
    assert.equal(recreated.revenueLines?.length, 2);
    assert.equal(recreated.id, invoice.id);
    assert.equal(pulls, 12);
  } finally {
    process.chdir(previousDirectory);
    for (const key of ["KISSTERRA_TUNE_NETWORK_ID", "KEY_1777", "KEY_2036", "KEY_2205", "KEY_2230"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
