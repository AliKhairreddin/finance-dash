import assert from "node:assert/strict";
import test from "node:test";
import { createRevolutClientAssertion, fetchRevolutActivity, revolutReadConsentUrl } from "./revolutApi";

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function rsaKeyMaterial(): Promise<{
  privateKeyPem: string;
  publicKey: CryptoKey;
}> {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const base64 = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)?.join("\n");
  return {
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
    publicKey: keys.publicKey
  };
}

test("Revolut client assertions use the registered issuer, client ID, and RS256 signature", async () => {
  const { privateKeyPem, publicKey } = await rsaKeyMaterial();
  const now = Date.UTC(2026, 6, 28, 18, 0, 0);
  const assertion = await createRevolutClientAssertion({
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    now
  });
  const [header, payload, signature] = assertion.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(base64UrlBytes(header)).toString("utf8")), {
    alg: "RS256",
    typ: "JWT"
  });
  assert.deepEqual(JSON.parse(Buffer.from(base64UrlBytes(payload)).toString("utf8")), {
    iss: "finance.thatcanadian.dev",
    sub: "client-123",
    aud: "https://revolut.com",
    exp: Math.floor(now / 1000) + 300
  });
  assert.equal(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlBytes(signature),
      new TextEncoder().encode(`${header}.${payload}`)
    ),
    true
  );
});

test("Revolut consent URL requests read-only access", () => {
  const consentUrl = new URL(
    revolutReadConsentUrl({
      clientId: "client-123",
      redirectUri: "https://finance.thatcanadian.dev",
      environment: "production"
    })
  );
  assert.equal(consentUrl.origin, "https://business.revolut.com");
  assert.equal(consentUrl.pathname, "/app-confirm");
  assert.equal(consentUrl.searchParams.get("client_id"), "client-123");
  assert.equal(consentUrl.searchParams.get("redirect_uri"), "https://finance.thatcanadian.dev");
  assert.equal(consentUrl.searchParams.get("response_type"), "code");
  assert.equal(consentUrl.searchParams.get("scope"), "READ");
});

test("Revolut activity signs a fresh assertion and excludes unsuccessful transactions", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("/auth/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh-123");
      assert.equal(body.get("client_assertion")?.split(".").length, 3);
      return Response.json({ access_token: "access-123", expires_in: 2399 });
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-123");
    if (url.pathname.endsWith("/accounts")) {
      return Response.json([
        {
          id: "account-1",
          name: "Main GBP",
          balance: 125.5,
          currency: "GBP",
          state: "active",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-07-28T17:00:00.000Z"
        }
      ]);
    }
    assert.deepEqual(url.searchParams.getAll("state"), ["created", "pending", "completed"]);
    assert.equal(url.searchParams.get("from"), "2026-07-01T00:00:00.000Z");
    assert.equal(url.searchParams.get("to"), "2026-07-28T23:59:59.999Z");
    return Response.json([
      {
        id: "transaction-1",
        type: "card_payment",
        state: "completed",
        created_at: "2026-07-28T16:00:00.000Z",
        completed_at: "2026-07-28T16:01:00.000Z",
        merchant: { name: "Example Merchant", category_code: "5734" },
        legs: [
          {
            leg_id: "leg-1",
            account_id: "account-1",
            amount: -24.5,
            currency: "GBP"
          }
        ]
      }
    ]);
  };

  const result = await fetchRevolutActivity({
    environment: "production",
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    refreshToken: "refresh-123",
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-28" },
    fetcher,
    now: Date.UTC(2026, 6, 28, 18, 0, 0)
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(result.accounts, [
    {
      id: "revolut-account-1",
      name: "Main GBP",
      source: "revolut",
      balance: 125.5,
      currency: "GBP",
      updatedAt: "2026-07-28T17:00:00.000Z",
      status: "live"
    }
  ]);
  assert.deepEqual(result.transactions, [
    {
      id: "revolut-transaction-1-leg-1-0",
      source: "revolut",
      accountName: "Main GBP",
      date: "2026-07-28",
      description: "card_payment",
      rawName: "Example Merchant",
      counterparty: "Example Merchant",
      amount: 24.5,
      currency: "GBP",
      direction: "out",
      status: "posted",
      category: "Revolut"
    }
  ]);
});

test("Revolut activity remains empty until all four runtime credentials are configured", async () => {
  assert.deepEqual(
    await fetchRevolutActivity({
      clientId: "client-123",
      issuer: "finance.thatcanadian.dev",
      privateKeyPem: "",
      refreshToken: "refresh-123"
    }),
    { accounts: [], transactions: [] }
  );
});
