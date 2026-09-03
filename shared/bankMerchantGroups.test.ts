import assert from "node:assert/strict";
import test from "node:test";
import {
  bankAccountGroupKey,
  bankCardGroupKey,
  bankMerchantGroupKey,
  bankVirtualAccountGroupKey,
  bankCardCashbackRate,
  groupBankTransactions,
  groupBankTransactionsByAccount,
  groupBankTransactionsByCard,
  isSocialMediaGroup,
  summarizeBankActivity
} from "./bankMerchantGroups";
import type { Provider, Transaction } from "./types";

function bankTransaction(
  id: string,
  counterparty: string,
  amount: number,
  overrides: Partial<Transaction> = {}
): Transaction {
  return {
    id,
    source: "slash",
    slashAccountSubtype: "credit",
    slashVirtualAccountId: "virtual-primary",
    slashVirtualAccountName: "Primary Account",
    accountId: "slash-platinum",
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

test("Meta activity groups across bank sources and descriptor variants", () => {
  const meta = bankTransaction("meta", "META ADS 438925", 30);
  const groups = groupBankTransactions([
    meta,
    bankTransaction("facebook", "Facebook Ads", 40, { source: "wise", accountId: "wise-usd", accountName: "Wise USD" }),
    bankTransaction("facebk", "FACEBK *5JR9SYHGG2", 50, { source: "revolut", accountId: "revolut-usd", accountName: "Revolut USD" }),
    bankTransaction("instagram", "Instagram promotion", 20, { direction: "in" })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Meta");
  assert.equal(groups[0].transactionCount, 4);
  assert.deepEqual(groups[0].sources, ["revolut", "slash", "wise"]);
  assert.deepEqual(groups[0].spend, { USD: 120 });
  assert.deepEqual(groups[0].credits, { USD: 20 });
  assert.deepEqual(groups[0].net, { USD: -100 });
  assert.equal(bankMerchantGroupKey(meta), groups[0].key);
});

test("card and account group keys identify the exact drill-down rows", () => {
  const transaction = bankTransaction("card", "Example", 25, {
    cardId: "card-primary",
    cardLastFour: "8744"
  });
  assert.equal(bankCardGroupKey(transaction), "slash:card:card-primary");
  assert.equal(bankAccountGroupKey(transaction), bankVirtualAccountGroupKey("virtual-primary"));
  assert.equal(bankCardGroupKey({ ...transaction, status: "pending" }), undefined);
});

test("Meta, TikTok, and NewsBreak are canonical social-media groups", () => {
  const providers: Array<Pick<Provider, "id" | "name" | "legalName" | "aliases">> = [{
    id: "provider-tiktok",
    name: "TikTok",
    legalName: "TikTok Pte. Ltd.",
    aliases: ["TTADS"]
  }];
  const groups = groupBankTransactions([
    bankTransaction("meta", "Facebook Ads", 40),
    bankTransaction("tiktok", "TTADS 90832", 50, { matchedProviderId: "provider-tiktok" }),
    bankTransaction("bytedance", "ByteDance campaign", 60),
    bankTransaction("newsbreak", "NEWS BREAK MEDIA", 70),
    bankTransaction("other", "Google Workspace", 80)
  ], providers);

  assert.equal(groups.find((group) => group.name === "TikTok")?.transactionCount, 2);
  assert.deepEqual(
    groups.filter(isSocialMediaGroup).map((group) => group.name).sort(),
    ["Meta", "NewsBreak", "TikTok"]
  );
  assert.equal(isSocialMediaGroup(groups.find((group) => group.name === "Google")!), false);
});

test("company directory aliases group otherwise different descriptors", () => {
  const provider: Pick<Provider, "id" | "name" | "legalName" | "aliases"> = {
    id: "provider-acme",
    name: "Acme Cloud",
    legalName: "Acme Cloud Incorporated",
    aliases: ["ACMECLD"]
  };
  const groups = groupBankTransactions([
    bankTransaction("one", "ACMECLD INV 334", 45),
    bankTransaction("two", "Acme Cloud Incorporated", 55)
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
  const groups = groupBankTransactions([
    bankTransaction("matched", "POS PIZZA HUT 442", 25, { matchedProviderId: "provider-pizza" }),
    bankTransaction("aliased", "PIZZAHUT 000442 CA", 35),
    bankTransaction("cursor-one", "CURSOR AI 1234", 10, { merchantName: "Cursor", merchantKey: "cursor" }),
    bankTransaction("cursor-two", "CURSOR AI 5678", 15, { merchantName: "Cursor AI", merchantKey: "cursor" })
  ], providers);

  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.name === "Pizza Hut")?.transactionCount, 2);
  assert.equal(groups.find((group) => group.key === "merchant:cursor")?.transactionCount, 2);
});

test("Slash daily card payments are excluded from merchant and card summaries", () => {
  const transactions = [
    bankTransaction("cash-side", "Daily Credit Card Payment", 39_050.49, {
      slashAccountSubtype: "cash",
      direction: "out",
      cardLastFour: "1947",
      matchedProviderId: "provider-namecheap"
    }),
    bankTransaction("card-side", "Daily Credit Card Payment", 39_050.49, {
      slashAccountSubtype: "credit",
      direction: "in",
      cardLastFour: "1947",
      matchedProviderId: "provider-namecheap"
    })
  ];
  const providers: Array<Pick<Provider, "id" | "name" | "legalName" | "aliases">> = [{
    id: "provider-namecheap",
    name: "Namecheap Inc.",
    aliases: []
  }];

  assert.deepEqual(groupBankTransactions(transactions, providers), []);
  assert.deepEqual(groupBankTransactionsByCard(transactions), []);
});

test("card view uses verified card identity, separates last-four collisions, and totals cashback", () => {
  const cards = groupBankTransactionsByCard([
    bankTransaction("explicit", "Meta", 100, {
      cardId: "card-primary",
      cardLastFour: "8744",
      cashback: { amount: 4, rate: 0.04 }
    }),
    bankTransaction("same-card", "Meta", 50, {
      cardId: "card-primary",
      cardLastFour: "8744",
      cashback: { amount: 2, rate: 0.04 }
    }),
    bankTransaction("same-last-four", "Meta", 25, {
      cardId: "card-secondary",
      cardLastFour: "8744",
      accountId: "slash-gold",
      accountName: "Slash Gold Credit"
    }),
    bankTransaction("unverified", "Meta", 75, {
      description: "Visa **** 8744"
    })
  ]);

  assert.equal(cards.length, 2);
  const card = cards.find((item) => item.cardId === "card-primary")!;
  assert.equal(card.transactionCount, 2);
  assert.deepEqual(card.spend, { USD: 150 });
  assert.deepEqual(card.cashback, { USD: 6 });
  assert.equal(bankCardCashbackRate(card), 0.04);
  assert.equal(cards.find((item) => item.cardId === "card-secondary")?.transactionCount, 1);
});

test("Slash account view groups settled activity by virtual account", () => {
  const accounts = groupBankTransactionsByAccount([
    bankTransaction("platinum", "Meta", 100),
    bankTransaction("gold", "Meta", 25, {
      accountId: "slash-gold",
      accountName: "Slash Gold Credit",
      slashVirtualAccountId: "virtual-reservation",
      slashVirtualAccountName: "Reservation Account"
    })
  ]);

  assert.equal(accounts.length, 2);
  assert.equal(accounts.find((item) => item.accountName === "Primary Account")?.transactionCount, 1);
  assert.equal(accounts.find((item) => item.accountName === "Reservation Account")?.transactionCount, 1);
  assert.deepEqual(groupBankTransactionsByAccount([
    bankTransaction("unassigned", "Meta", 10, {
      slashVirtualAccountId: undefined,
      slashVirtualAccountName: undefined
    })
  ]), []);
});

test("bank activity summaries retain exact totals without raw transaction arrays", () => {
  const transactions = [
    bankTransaction("meta-one", "Meta", 100, {
      cardId: "card-primary",
      cardLastFour: "8744",
      cashback: { amount: 4, rate: 0.04 }
    }),
    bankTransaction("meta-two", "Facebook Ads", 50, {
      cardId: "card-primary",
      cardLastFour: "8744",
      cashback: { amount: 2, rate: 0.04 }
    })
  ];

  const summary = summarizeBankActivity(transactions);

  assert.equal(summary.transactionCount, 2);
  assert.equal(summary.merchantGroups[0].transactionCount, 2);
  assert.deepEqual(summary.merchantGroups[0].spend, { USD: 150 });
  assert.deepEqual(summary.merchantGroups[0].cashback, { USD: 6 });
  assert.equal("transactions" in summary.merchantGroups[0], false);
  assert.equal("transactions" in summary.merchantGroups[0].cardGroups[0], false);
  assert.equal("transactions" in summary.cardGroups[0], false);
  assert.equal("transactions" in summary.accountGroups[0], false);
});

test("pending, voided, and invalid records do not affect settled totals", () => {
  const groups = groupBankTransactions([
    bankTransaction("posted", "OpenAI", 20),
    bankTransaction("pending", "OpenAI", 30, { status: "pending" }),
    bankTransaction("voided", "OpenAI", 40, { status: "voided" }),
    bankTransaction("invalid", "OpenAI", Number.NaN)
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].transactionCount, 1);
  assert.deepEqual(groups[0].spend, { USD: 20 });
});
