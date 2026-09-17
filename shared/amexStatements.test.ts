import assert from "node:assert/strict";
import test from "node:test";
import { amexStatementAmount, amexStatementDate, amexStatementOptions, amexStatementTransactions, parseAmexStatementCsv, validateAmexStatement } from "./amexStatements";
import { isCurrentBankTransactionId } from "./providerIdentity";
const options = { currency: "EUR", dateFormat: "dmy", cardLastFour: "1234" } as const;
const csv = 'Datum;Omschrijving;Bedrag;Kaartlid;Rekeningnummer\r\n15/09/2026;"META, ADS";"1.234,56";Ali;XXXX-XXXX-XXX1234\r\n14/09/2026;UW BETALING;-500,00;Ali;XXXX-XXXX-XXX1234\r\n13/09/2026;Refund;12,34 CR;Ali;XXXX-XXXX-XXX1234';

test("Dutch CSVs normalize dates, decimal commas, cardholders, charges and credits", async () => {
  const data = parseAmexStatementCsv(csv, options);
  assert.deepEqual(data.rows.map(row => row.amount), [1234.56, -500, -12.34]);
  const rows = await amexStatementTransactions(data);
  assert.equal(rows[0].date, "2026-09-15"); assert.equal(rows[0].cardHolderName, "Ali");
  assert.equal(rows[0].category, "Uncategorized"); assert.equal(rows[0].direction, "out");
  assert.equal(rows[1].category, "Internal transfer"); assert.equal(rows[1].direction, "in");
  assert.equal(rows[2].category, "Uncategorized"); assert.equal(rows[2].direction, "in");
  assert.ok(rows.every(row => isCurrentBankTransactionId("amex", row.id)));
  assert.ok(!JSON.stringify(rows).includes("XXXX-XXXX"));
});
test("English CSV supports escaped quotes, embedded lines and card auto-detection", () => {
  const data = parseAmexStatementCsv('Date,Description,Amount,Account\n09/15/2026,"Vendor ""One""\nAmsterdam","1,200.50",-12345', { currency: "USD", dateFormat: "mdy" });
  assert.equal(data.cardLastFour, "2345"); assert.equal(data.rows[0].description, 'Vendor "One" Amsterdam'); assert.equal(data.rows[0].amount, 1200.5);
});
test("native Dutch Account Activity exports preserve all cards without editing headers or date settings", async () => {
  const data = parseAmexStatementCsv('Datum,Omschrijving,Kaartlid,Rekening #,Bedrag\r\n09/13/2026,VENDOR ONE,Cardholder A,-41234,"9,99"\r\n09/12/2026,"VENDOR, TWO",Cardholder B,-45678,"17,72"\r\n01/02/2026,REFUND,Cardholder C,-49012,"-12,00"', amexStatementOptions({ cardLastFour: "1234" }));
  assert.deepEqual(data.rows, [
    { date: "2026-09-13", description: "VENDOR ONE", cardHolderName: "Cardholder A", cardLastFour: "1234", amount: 9.99 },
    { date: "2026-09-12", description: "VENDOR, TWO", cardHolderName: "Cardholder B", cardLastFour: "5678", amount: 17.72 },
    { date: "2026-01-02", description: "REFUND", cardHolderName: "Cardholder C", cardLastFour: "9012", amount: -12 },
  ]);
  const transactions = await amexStatementTransactions(data);
  assert.deepEqual(transactions.map(row => row.cardLastFour), ["1234", "5678", "9012"]);
  assert.deepEqual(transactions.map(row => row.direction), ["out", "out", "in"]);
  assert.ok(transactions.every(row => row.accountId === "amex-statement-EUR-1234"));
});
test("short Dutch Account Activity exports have a known month-first format and allow explicit overrides", () => {
  const text = '\uFEFFDatum,Omschrijving,Kaartlid,Rekening #,Bedrag\n09/12/2026,Vendor,Cardholder A,-41234,"12,00"';
  const automatic = parseAmexStatementCsv(text, amexStatementOptions({}));
  assert.equal(automatic.cardLastFour, "1234");
  assert.equal(automatic.rows[0].date, "2026-09-12");
  assert.equal(parseAmexStatementCsv(text, options).rows[0].date, "2026-12-09");
  assert.throws(() => parseAmexStatementCsv(text + '\n09/11/2026,Other,Cardholder B,-45678,"10,00"', amexStatementOptions({})), /primary card/);
});
test("automatic dates use the entire export, reject mixed orders and require a choice for unknown ambiguous formats", () => {
  const automatic = amexStatementOptions({ cardLastFour: "1234" });
  const header = "Date,Description,Amount\n";
  assert.deepEqual(parseAmexStatementCsv(header + "09/02/2026,First,10\n09/13/2026,Second,20", automatic).rows.map(row => row.date), ["2026-09-02", "2026-09-13"]);
  assert.deepEqual(parseAmexStatementCsv(header + "09/02/2026,First,10\n13/02/2026,Second,20", automatic).rows.map(row => row.date), ["2026-02-09", "2026-02-13"]);
  assert.throws(() => parseAmexStatementCsv(header + "09/13/2026,First,10\n14/09/2026,Second,20", automatic), /mixes/);
  assert.throws(() => parseAmexStatementCsv(header + "09/02/2026,Vendor,10", automatic), /ambiguous/);
  assert.deepEqual(parseAmexStatementCsv(header + "2026-09-02,First,10\n2 september 2026,Second,20\n09/09/2026,Third,30", automatic).rows.map(row => row.date), ["2026-09-02", "2026-09-02", "2026-09-09"]);
  assert.throws(() => parseAmexStatementCsv(header + "02/30/2026,Vendor,10", automatic), /Invalid transaction date/);
});
test("amount/date parsing fails closed for malformed, ambiguous and impossible values", () => {
  for (const amount of ["12x", "1,23,45", "1.234", "NaN", "", "-12CR"]) assert.throws(() => amexStatementAmount(amount));
  assert.equal(amexStatementAmount("€ 1.234,56"), 1234.56); assert.equal(amexStatementAmount("(12.50)"), -12.5);
  assert.throws(() => amexStatementDate("31/02/2026", "dmy")); assert.throws(() => amexStatementDate("1/2/26", "dmy"));
  assert.equal(amexStatementDate("1 maart 2026", "dmy"), "2026-03-01");
  assert.equal(amexStatementDate("2 oktober 2026", "dmy"), "2026-10-02");
  assert.equal(amexStatementOptions({}).currency, "EUR");
  assert.equal(amexStatementOptions({}).dateFormat, "auto");
});
test("malformed CSV rows, missing metadata and mixed currencies reject the whole file", () => {
  for (const text of ['Date,Description,Amount\n15/09/2026,Vendor,12\nwrong', 'Date,Description,Amount\n15/09/2026,"unfinished,12', 'Date,Description,Amount\n15/09/2026,Vendor,garbage']) assert.throws(() => parseAmexStatementCsv(text, options));
  assert.throws(() => parseAmexStatementCsv('Date,Description,Amount\n15/09/2026,Vendor,12', { currency: "EUR", dateFormat: "dmy" }), /last four/);
  assert.throws(() => parseAmexStatementCsv('Date,Description,Amount,Currency\n15/09/2026,Vendor,12,USD', options), /different currency/);
});
test("repeated charges remain separate; overlap and equivalent PDF rows have stable IDs", async () => {
  const data = parseAmexStatementCsv('Date,Description,Amount\n15/09/2026,META ADS,12\n15/09/2026,META ADS,12\n14/09/2026,Other,2', options);
  const first = await amexStatementTransactions(data);
  const second = await amexStatementTransactions({ ...data, rows: [...data.rows].reverse() });
  assert.equal(new Set(first.map(row => row.id)).size, 3);
  assert.deepEqual(first.map(row => row.id).sort(), second.map(row => row.id).sort());
  const pdf = await amexStatementTransactions({ ...data, rows: data.rows.map(row => ({ ...row, description: row.description.toLowerCase().replace(" ", "\n"), cardLastFour: "1234" })) });
  assert.deepEqual(first.map(row => row.id), pdf.map(row => row.id));
  const differentCard = await amexStatementTransactions({ ...data, cardLastFour: "5678" });
  assert.notEqual(first[0].id, differentCard[0].id);
});
test("PDF control totals must reconcile without invented balancing rows", () => {
  const data = parseAmexStatementCsv(csv, options);
  validateAmexStatement({ ...data, chargesTotal: 1234.56, creditsTotal: 512.34 });
  assert.throws(() => validateAmexStatement({ ...data, chargesTotal: 1230 }), /printed statement totals/);
  assert.throws(() => validateAmexStatement({ ...data, rows: [] }), /1–1,000/);
  assert.throws(() => validateAmexStatement({ ...data, rows: [{ ...data.rows[0], amount: 1.234 }] }), /invalid amount/);
});
test("pending activity cannot become posted spend and positive collection fees remain expenses", async () => {
  assert.throws(() => parseAmexStatementCsv('Date,Description,Amount,Status\n15/09/2026,Vendor,12,pending', options), /posted activity only/);
  const data = parseAmexStatementCsv('Datum;Omschrijving;Bedrag;Status\n15/09/2026;Incasso kosten;12,00;geboekt', options);
  const [row] = await amexStatementTransactions(data);
  assert.equal(row.category, "Uncategorized"); assert.equal(row.direction, "out");
});
