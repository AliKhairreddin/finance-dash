import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardSnapshot } from "./types";
import { transactionReviewBootstrap } from "./transactionReview";

test("transaction review bootstrap exposes only matching reference data", () => {
  const result = transactionReviewBootstrap({
    accounts: [{
      id: "wise-account",
      name: "Wise EUR",
      source: "wise",
      balance: 42_000,
      currency: "EUR",
      updatedAt: "2026-09-02T00:00:00.000Z",
      status: "live"
    }, {
      id: "manual-cash",
      name: "Office cash",
      source: "manual",
      balance: 500,
      currency: "USD",
      updatedAt: "2026-09-02T00:00:00.000Z",
      status: "manual"
    }],
    providers: [{
      id: "supplier-1",
      name: "Supplier",
      type: "supplier",
      tags: ["media"],
      aliases: ["private alias"],
      email: "private@example.com",
      bankAccount: "not-a-real-field",
      source: "manual",
      createdAt: "2026-09-02T00:00:00.000Z"
    }],
    teams: [{ id: "team-1", name: "Operations", createdAt: "2026-09-02T00:00:00.000Z" }],
    transactionCategories: [{
      id: "category-1",
      name: "Software",
      direction: "out",
      color: "#000000",
      system: false,
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z"
    }]
  } as unknown as DashboardSnapshot);

  assert.deepEqual(result, {
    accounts: [{ id: "wise-account", name: "Wise EUR", source: "wise" }],
    companies: [{ id: "supplier-1", name: "Supplier", type: "supplier", tags: ["media"] }],
    teams: [{ id: "team-1", name: "Operations", createdAt: "2026-09-02T00:00:00.000Z" }],
    categories: [{
      id: "category-1",
      name: "Software",
      direction: "out",
      color: "#000000",
      system: false,
      createdAt: "2026-09-02T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z"
    }]
  });
  assert.equal("balance" in result.accounts[0], false);
  assert.equal("email" in result.companies[0], false);
  assert.equal("aliases" in result.companies[0], false);
});
