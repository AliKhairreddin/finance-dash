import assert from "node:assert/strict";
import test from "node:test";
import { automateKissterraWeek, createMeritInvoice } from "./handler";
import { kissterraFixture } from "../shared/kissterraBilling.fixture";
import { createMeritInvoice as createServerInvoice } from "../server/integrations";

function report(amount: number, date: string) {
  const stat = { payout: String(amount), clicks: "1", conversions: "1" };
  return { response: { status: 1, data: { page: 1, current: 50, count: 1, pageCount: 1, totals: { Stat: stat }, data: [{ Stat: { ...stat, date } }] } } };
}
const env = { KISSTERRA_TUNE_NETWORK_ID: "fixture", KEY_1777: "1777", KEY_2036: "2036", KEY_2205: "2205", KEY_2230: "2230", MERIT_API_ID: "fixture", MERIT_API_KEY: "fixture", MERIT_WRITES_ENABLED: "true" };

test("Worker pulls each account once, saves one draft, and exports separate Merit rows in both backends", async t => {
  const f = kissterraFixture();
  const pulled: string[] = [], writes: Record<string, any>[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v2/sendinvoice")) {
      writes.push(JSON.parse(String(init?.body)));
      return Response.json({ InvoiceId: "fixture-invoice" });
    }
    const id = url.searchParams.get("api_key")!;
    pulled.push(id);
    assert.equal(url.searchParams.get("filters[Affiliate.id][values][0]"), id);
    const amount = f.runs.find(r => r.partnerName.includes(`Account ID: ${id}`))!.revenue;
    return Response.json(report(amount, f.period.periodStart));
  });
  const invoice = (await automateKissterraWeek(env as never, f.state as never, f.partners, f.period, f.now))!;
  assert.equal(invoice.amount, 259024.93);
  assert.equal(writes.length, 0, "automation only creates a local draft");
  assert.equal(f.state.invoices.length, 2);
  assert.equal(pulled.length, 4);
  assert.equal((await automateKissterraWeek(env as never, f.state as never, f.partners, f.period, f.now))?.id, invoice.id);
  assert.equal(pulled.length, 4, "already invoiced periods do not pull again");
  const tax = { id: "zero-tax", code: "VAT0", name: "Zero VAT", taxPct: 0 };
  await createMeritInvoice(env as never, invoice, tax, invoice.invoiceNumber, undefined, f.provider, invoice.revenueLines);
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { MERIT_API_ID: "fixture", MERIT_API_KEY: "fixture", MERIT_WRITES_ENABLED: "true" });
    await createServerInvoice(invoice, tax, { provider: f.provider });
  } finally {
    for (const name of ["MERIT_API_ID", "MERIT_API_KEY", "MERIT_WRITES_ENABLED"]) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  }
  for (const request of writes) {
    assert.equal(request.InvoiceRow.length, 2);
    assert.equal(request.TotalAmount, 259024.93);
    assert.deepEqual(request.InvoiceRow.map((r: any) => r.Price), [258845, 179.93]);
    assert.match(request.InvoiceRow[0].Item.Description, /Inch Media \(Account ID: 1777\)/);
    assert.match(request.InvoiceRow[1].Item.Description, /Inch Media \(DCPL\) \(Account ID: 2036\)/);
    assert.deepEqual(request.Customer, { Id: f.provider.meritCustomerId });
  }
  assert.equal(writes.length, 2);
});

test("one failed account blocks the combined draft while preserving good saved revenue, then recovery creates one draft", async t => {
  const f = kissterraFixture();
  let fail = true;
  f.state.revenueRuns[2].revenue = 22;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const id = new URL(String(input)).searchParams.get("api_key");
    if (fail && id === "2205") return Response.json({ response: { status: 0 } });
    const amount = f.runs.find(r => r.partnerName.includes(`Account ID: ${id}`))!.revenue;
    return Response.json(report(amount, f.period.periodStart));
  });
  await assert.rejects(automateKissterraWeek(env as never, f.state as never, f.partners, f.period, f.now), /complete successful/);
  assert.equal(f.state.invoices.length, 1);
  assert.ok(f.state.revenueRuns.some(r => r.partnerId === f.partners[2].id && r.revenue === 22 && r.status === "pulled"));
  assert.ok(f.state.revenueRuns.some(r => r.partnerId === f.partners[2].id && r.status === "failed"));
  fail = false;
  await automateKissterraWeek(env as never, f.state as never, f.partners, f.period, f.now);
  assert.equal(f.state.invoices.length, 2);
  assert.equal(f.state.invoices[0].amount, 259024.93);
});

test("all-zero reports create no draft or Merit request", async t => {
  const f = kissterraFixture();
  t.mock.method(globalThis, "fetch", async () => Response.json(report(0, f.period.periodStart)));
  assert.equal(await automateKissterraWeek(env as never, f.state as never, f.partners, f.period, f.now), undefined);
  assert.equal(f.state.invoices.length, 1);
});
