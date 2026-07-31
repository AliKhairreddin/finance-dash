import assert from "node:assert/strict";
import test from "node:test";
import { bankProviderTransactionId, isCurrentBankTransactionId } from "./providerIdentity";

test("composite bank IDs cannot collide through delimiters, case, or Unicode", () => {
  assert.notEqual(
    bankProviderTransactionId("revolut", ["a-b", "c", "d"]),
    bankProviderTransactionId("revolut", ["a", "b-c", "d"])
  );
  assert.notEqual(
    bankProviderTransactionId("amex", ["A", "café"]),
    bankProviderTransactionId("amex", ["a", "café"])
  );
  assert.equal(
    bankProviderTransactionId("slash", ["account/東京", "transaction-1"]),
    bankProviderTransactionId("slash", ["account/東京", "transaction-1"])
  );
});

test("current bank IDs require the exact connector grammar", () => {
  assert.equal(isCurrentBankTransactionId("revolut", bankProviderTransactionId("revolut", ["tx", "leg", "account"])), true);
  assert.equal(isCurrentBankTransactionId("slash", bankProviderTransactionId("slash", ["account", "tx"])), true);
  assert.equal(isCurrentBankTransactionId("amex", bankProviderTransactionId("amex", ["account", "tx"])), true);
  assert.equal(isCurrentBankTransactionId("wise", "wise-v2-123-7478"), true);
  assert.equal(isCurrentBankTransactionId("wise", bankProviderTransactionId("wise", ["legacy", "wise-old"])), true);

  assert.equal(isCurrentBankTransactionId("slash", "slash-v2-provider-id-from-the-old-namespace"), false);
  assert.equal(isCurrentBankTransactionId("revolut", bankProviderTransactionId("revolut", ["tx", "leg"])), false);
  assert.equal(isCurrentBankTransactionId("wise", "wise-v2-123-not-hex"), false);
  assert.equal(isCurrentBankTransactionId("amex", "amex-v2-61.00"), false);
});
