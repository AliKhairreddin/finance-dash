import assert from "node:assert/strict";
import test from "node:test";
import type { SlashCardAlertTransaction } from "../shared/slashApi";
import { buildSlashCardAlert, prepareSlashCardAlert } from "./slashCardAlertState";

const decline: SlashCardAlertTransaction = { id: "decline", cardId: "card", accountId: "underlying", accountSubtype: "credit",
  virtualAccountId: "va", date: "2026-09-30T12:00:00Z", authorizedAt: "2026-09-30T11:59:00Z", amountCents: -12500,
  description: "Card purchase", merchantData: { description: "Meta", categoryCode: "7311" }, status: "failed", detailedStatus: "declined", declineReason: "Card spending limit" };
const approval: SlashCardAlertTransaction = { ...decline, id: "new-payment", authorizedAt: "2026-09-30T12:01:00Z", status: "pending", detailedStatus: "pending", declineReason: undefined };

test("recovery is one later approved purchase on the same card, followed by a new incident after another decline", () => {
  const rejected = prepareSlashCardAlert(undefined, decline, false);
  assert.equal(rejected.notification?.kind, "declined");
  assert.equal(rejected.state.activeDecline, true);
  assert.equal(prepareSlashCardAlert(rejected.state, decline, true).notification, null);
  const recovered = prepareSlashCardAlert(rejected.state, approval, false);
  assert.equal(recovered.notification?.kind, "recovered");
  assert.equal(recovered.notification?.previousDecline?.id, decline.id);
  assert.equal(recovered.state.activeDecline, false);
  assert.equal(prepareSlashCardAlert(recovered.state, { ...approval, detailedStatus: "settled", status: "posted" }, false).notification, null);
  assert.equal(prepareSlashCardAlert(recovered.state, { ...approval, id: "another-payment", authorizedAt: "2026-09-30T12:02:00Z" }, false).notification, null);
  const next = prepareSlashCardAlert(recovered.state, { ...decline, id: "second-decline", authorizedAt: "2026-09-30T12:03:00Z" }, false);
  assert.equal(next.state.activeDecline, true);
  assert.equal(prepareSlashCardAlert(next.state, { ...approval, id: "another", authorizedAt: "2026-09-30T12:04:00Z" }, false).notification?.kind, "recovered");
});

test("old settlement, same-transaction reclassification, refunds, failures and zero-dollar checks cannot imply recovery", () => {
  const rejected = prepareSlashCardAlert(undefined, decline, false);
  for (const tx of [
    { ...approval, detailedStatus: "settled", status: "posted", authorizedAt: "2026-09-29T12:00:00Z", date: "2026-09-30T12:05:00Z" },
    { ...approval, id: decline.id }, { ...approval, authorizedAt: decline.authorizedAt },
    { ...approval, amountCents: 0 }, { ...approval, amountCents: 500 }, { ...approval, status: "failed" },
    { ...approval, detailedStatus: "canceled" }, { ...approval, detailedStatus: "reversed" }
  ] as SlashCardAlertTransaction[]) {
    const result = prepareSlashCardAlert(rejected.state, tx, false);
    assert.equal(result.notification, null);
    assert.equal(result.state.activeDecline, true);
  }
  assert.equal(prepareSlashCardAlert(rejected.state, approval, true).notification, null);
});

test("an out-of-order decline still alerts but includes the known later approval without reopening a resolved incident", () => {
  const healthy = prepareSlashCardAlert(undefined, approval, false);
  assert.equal(healthy.notification, null);
  const late = prepareSlashCardAlert(healthy.state, decline, false);
  assert.equal(late.notification?.kind, "declined");
  assert.equal(late.notification?.laterApproval?.id, approval.id);
  assert.equal(late.state.activeDecline, false);
  assert.equal(prepareSlashCardAlert(late.state, approval, false).notification, null);
});

test("alerts show actionable local time, safe card identity, merchant, amount, reason and signed balance", () => {
  const notification = prepareSlashCardAlert(undefined, { ...decline, originalCurrency: { code: "CAD", amountCents: -17000 } }, false).notification!;
  const labels = { card: { id: "card", name: "Meta ads", last4: "1234" }, account: { id: "va", accountId: "parent", name: "Primary", accountType: "primary" as const, balance: -10, currency: "USD" as const } };
  const message = buildSlashCardAlert(notification, labels, "https://finance.example");
  assert.match(message, /Slash card declined\nMeta ads · Card ••1234/);
  assert.match(message, /30 Sept 2026, 14:59:00 · Beirut/);
  assert.match(message, /Attempted: \$125.00 \(not charged\)/);
  assert.match(message, /Original amount: CA\$170.00/);
  assert.match(message, /Available balance now: -\$10.00/);
  assert.match(message, /Merchant: Meta/); assert.match(message, /MCC\): 7311/);
  assert.match(message, /Reason: Card spending limit/);
  assert.match(message, /Transaction: decline/);
  assert.ok(message.length < 4096);
  assert.throws(() => buildSlashCardAlert(notification, { card: { id: "wrong", last4: "1234" } }, "https://finance.example"), /incomplete/);
  const rejected = prepareSlashCardAlert(undefined, decline, false);
  const recovered = prepareSlashCardAlert(rejected.state, approval, false);
  const recovery = buildSlashCardAlert(recovered.notification!, labels, "https://finance.example");
  assert.match(recovery, /payment approved again/); assert.match(recovery, /Previous decline:/);
  assert.match(recovery, /other merchants or amounts may still decline/);
  assert.match(buildSlashCardAlert({ ...notification, transaction: { ...decline, declineReason: undefined } }, labels, "https://finance.example"), /Reason: Not provided by Slash/);
});
