import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProviders, mergeProviderDirectory } from "./matching";

test("mergeProviderDirectory does not restore deleted default companies", () => {
  assert.deepEqual(mergeProviderDirectory([]), []);
});

test("mergeProviderDirectory keeps and normalizes companies that are actually stored", () => {
  const storedProvider = canonicalProviders[0];
  assert.deepEqual(mergeProviderDirectory([storedProvider]), [storedProvider]);
});
