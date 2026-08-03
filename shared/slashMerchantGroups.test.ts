import assert from "node:assert/strict";
import test from "node:test";
import { groupSlashTransactions } from "./slashMerchantGroups";
import type { Provider, Transaction } from "./types";

function slashTransaction(
  id: string,
  counterparty: string,
  amount: number,
  overrides: Partial<Transaction> = {}
): Transaction {
  return {
    id,
    source: "slash",
    slashAccountSubtype: "credit",
    accountName: "Slash Platinum Credit",
    date: "2026-08-01",
    description: counterparty,
    rawName: counterparty,
    counterparty,
    amount,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Advertising",
    ...overrides
  };
}

test("Meta, Facebook, Facebk, and Instagram activity is one merchant group", () => {
  const groups = groupSlashTransactions([
    slashTransaction("meta", "META ADS 438925", 30),
    slashTransaction("facebook", "Facebook Ads", 40),
    slashTransaction("facebk", "FACEBK *5JR9SYHGG2", 50),
    slashTransaction("instagram", "Instagram promotion", 20, { direction: "in" })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Meta");
  assert.equal(groups[0].transactionCount, 4);
  assert.deepEqual(groups[0].spend, { USD: 120 });
  assert.deepEqual(groups[0].credits, { USD: 20 });
  assert.deepEqual(groups[0].net, { USD: -100 });
});

test("company directory aliases group otherwise different Slash descriptors", () => {
  const provider: Pick<Provider, "id" | "name" | "legalName" | "aliases"> = {
    id: "provider-acme",
    name: "Acme Cloud",
    legalName: "Acme Cloud Incorporated",
    aliases: ["ACMECLD"]
  };
  const groups = groupSlashTransactions([
    slashTransaction("one", "ACMECLD INV 334", 45),
    slashTransaction("two", "Acme Cloud Incorporated", 55)
  ], [provider]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Acme Cloud");
  assert.equal(groups[0].transactionCount, 2);
  assert.deepEqual(groups[0].spend, { USD: 100 });
});

test("provider matches and merchant keys collapse classified variants", () => {
  const providers: Array<Pick<Provider, "id" | "name" | "legalName" | "aliases">> = [{
    id: "provider-pizza",
    name: "Pizza Hut",
    aliases: ["PIZZAHUT"]
  }];
  const groups = groupSlashTransactions([
    slashTransaction("matched", "POS PIZZA HUT 442", 25, { matchedProviderId: "provider-pizza" }),
    slashTransaction("aliased", "PIZZAHUT 000442 CA", 35),
    slashTransaction("cursor-one", "CURSOR AI 1234", 10, { merchantName: "Cursor", merchantKey: "cursor" }),
    slashTransaction("cursor-two", "CURSOR AI 5678", 15, { merchantName: "Cursor AI", merchantKey: "cursor" })
  ], providers);

  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.name === "Pizza Hut")?.transactionCount, 2);
  assert.equal(groups.find((group) => group.key === "merchant:cursor")?.transactionCount, 2);
});

test("non-Slash, pending, and voided records do not affect settled totals", () => {
  const groups = groupSlashTransactions([
    slashTransaction("posted", "OpenAI", 20),
    slashTransaction("pending", "OpenAI", 30, { status: "pending" }),
    slashTransaction("voided", "OpenAI", 40, { status: "voided" }),
    slashTransaction("wise", "OpenAI", 50, { source: "wise" })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].transactionCount, 1);
  assert.deepEqual(groups[0].spend, { USD: 20 });
});
