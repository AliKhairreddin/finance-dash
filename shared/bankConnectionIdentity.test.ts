import assert from "node:assert/strict";
import test from "node:test";
import {
  bankConnectionKey,
  requireBankConnectionKey
} from "./bankConnectionIdentity";

test("bank connection keys normalize explicit stable connection identity", async () => {
  const first = await bankConnectionKey({
    WISE_ENVIRONMENT: " production ",
    WISE_CONNECTION_ID: " primary "
  }, "wise");
  const second = await bankConnectionKey({
    WISE_CONNECTION_ID: "primary"
  }, "wise");
  const differentTenant = await bankConnectionKey({
    WISE_CONNECTION_ID: "secondary"
  }, "wise");

  assert.match(first ?? "", /^[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, differentTenant);
});

test("bank connection keys normalize provider base URLs", async () => {
  const first = await bankConnectionKey({
    SLASH_BASE_URL: "https://api.slash.com///",
    SLASH_CONNECTION_ID: "primary"
  }, "slash");
  const second = await bankConnectionKey({
    SLASH_BASE_URL: " https://api.slash.com ",
    SLASH_CONNECTION_ID: " primary "
  }, "slash");

  assert.equal(first, second);
});

test("Amex connection identity is independent of credential and account rotation", async () => {
  const first = await bankConnectionKey({
    AMEX_API_BASE_URL: "https://api.amex.test",
    AMEX_CONNECTION_ID: "primary"
  }, "amex");
  const expanded = await bankConnectionKey({
    AMEX_API_BASE_URL: "https://api.amex.test/",
    AMEX_CONNECTION_ID: "primary"
  }, "amex");
  assert.equal(first, expanded);
});

test("bank connection identity is absent unless its stable identifiers are configured", async () => {
  assert.equal(await bankConnectionKey({}, "wise"), null);
  assert.equal(await bankConnectionKey({ REVOLUT_ENVIRONMENT: "production" }, "revolut"), null);
  assert.equal(await bankConnectionKey({ SLASH_BASE_URL: "https://api.slash.com" }, "slash"), null);
  assert.equal(await bankConnectionKey({ AMEX_API_BASE_URL: "https://api.amex.test" }, "amex"), null);
  assert.equal(await bankConnectionKey({
    AMEX_API_BASE_URL: "https://api.amex.test",
    AMEX_CONNECTION_ID: ""
  }, "amex"), null);
  await assert.rejects(() => requireBankConnectionKey({}, "wise"), /connection identity is not configured/);
});
