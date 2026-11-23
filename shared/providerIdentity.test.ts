import assert from "node:assert/strict";
import test from "node:test";
import { wiseTransactionId } from "./wiseTransactionIdentity";
import { bankMigrationIdentity, bankProviderTransactionId, isCurrentBankTransactionId } from "./providerIdentity";

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
  assert.equal(isCurrentBankTransactionId("wise", bankMigrationIdentity("wise", "legacy", "wise-old")), true);

  assert.equal(isCurrentBankTransactionId("slash", "slash-v2-provider-id-from-the-old-namespace"), false);
  assert.equal(isCurrentBankTransactionId("revolut", "revolut-v2-7478.6c6567"), false);
  assert.equal(isCurrentBankTransactionId("wise", "wise-v2-123-not-hex"), false);
  assert.equal(isCurrentBankTransactionId("amex", "amex-v2-61.00"), false);
});

test("new bank identities fit the ledger after encoding multi-byte components", () => {
  const account = "a".repeat(500);
  const reference = "界".repeat(173);
  const exact = bankProviderTransactionId("slash", [account, reference]);
  assert.equal(exact, `slash-v2-${"61".repeat(500)}.${"e7958c".repeat(173)}`);
  assert.equal(exact.length, 2048);
  assert.throws(() => bankProviderTransactionId("slash", [account, reference + "x"]), /2048/);
  const component = "界".repeat(300);
  assert.throws(() => bankProviderTransactionId("revolut", [component, component, component]), /2048/);
  assert.throws(() => wiseTransactionId("1", "界".repeat(340)), /2048/);
});
