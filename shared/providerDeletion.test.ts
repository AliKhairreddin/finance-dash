import assert from "node:assert/strict";
import test from "node:test";
import { deleteProviderReferences } from "./providerDeletion";
import type { Invoice, Provider, RevenuePartner, RevenueRun, Transaction } from "./types";

const provider = {
  id: "provider-client",
  name: "Client",
  type: "client",
  tags: [],
  aliases: [],
  source: "manual",
  createdAt: "2026-07-09T00:00:00.000Z"
} satisfies Provider;

const transaction = {
  id: "transaction-1",
  source: "wise",
  accountName: "Wise USD",
  date: "2026-07-09",
  description: "Payment",
  rawName: "Client",
  counterparty: "Client",
  amount: 100,
  currency: "USD",
  direction: "in",
  status: "posted",
  category: "Revenue",
  matchedProviderId: provider.id
} satisfies Transaction;

test("deleteProviderReferences removes the company and clears references without deleting financial history", () => {
  const invoice = { id: "invoice-1", providerId: provider.id } as Invoice;
  const partner = { id: "partner-1", providerId: provider.id } as RevenuePartner;
  const run = { id: "run-1", providerId: provider.id } as RevenueRun;

  const result = deleteProviderReferences(
    {
      providers: [provider],
      invoices: [invoice],
      revenuePartners: [partner],
      revenueRuns: [run],
      transactions: [transaction],
      wiseStatementTransactions: [transaction]
    },
    provider.id
  );

  assert.equal(result?.deletedProvider, provider);
  assert.deepEqual(result?.providers, []);
  assert.equal(result?.invoices.length, 1);
  assert.equal(result?.invoices[0].providerId, undefined);
  assert.equal(result?.revenuePartners[0].providerId, undefined);
  assert.equal(result?.revenueRuns[0].providerId, undefined);
  assert.equal(result?.transactions[0].matchedProviderId, undefined);
  assert.equal(result?.wiseStatementTransactions[0].matchedProviderId, undefined);
});

test("deleteProviderReferences returns undefined for an unknown company", () => {
  assert.equal(
    deleteProviderReferences(
      {
        providers: [provider],
        invoices: [],
        revenuePartners: [],
        revenueRuns: [],
        transactions: [],
        wiseStatementTransactions: []
      },
      "missing-provider"
    ),
    undefined
  );
});
