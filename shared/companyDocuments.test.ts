import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { contractFileType, contractText, docxType, matchContractCompany, validateContractExtraction, type ContractExtraction } from "./companyDocuments";
const company = (id: string, name: string) => ({ id, name, aliases: [] });
const extract = (name: string): ContractExtraction => ({ parties: [{ name, email: "", registrationNumber: "", taxId: "" }], confidence: 0.99, reason: "Printed agreement party" });
test("contracts match exact saved identities and aliases while excluding our own companies", () => {
  const companies = [company("own", "Digital Nudge OÜ"), { ...company("acme", "Acme"), aliases: ["Acme Media"] }];
  const extracted = extract("Acme Media LLC"); extracted.parties.push(extract("Digital Nudge OÜ").parties[0]);
  assert.equal(matchContractCompany(extracted, companies).providerId, "acme");
  assert.equal(matchContractCompany(extract("Digital Nudge OÜ"), companies).providerId, undefined);
  assert.equal(matchContractCompany(extract("Acme Media Solutions"), companies).providerId, undefined);
});
test("ambiguous, unknown and low-confidence contract identities remain unassigned", () => {
  const companies = [company("a", "Acme"), company("b", "Acme LLC")];
  assert.equal(matchContractCompany(extract("Acme"), companies).providerId, undefined);
  assert.equal(matchContractCompany({ ...extract("Acme"), confidence: 0.6 }, [companies[0]]).providerId, undefined);
  assert.equal(matchContractCompany(extract("Unknown"), companies).providerId, undefined);
});
test("printed tax ID and exact company email can identify a legal name variant without fuzzy guessing", () => {
  const extracted = extract("ACM Holdings"); extracted.parties[0].taxId = "VAT-1234";
  assert.equal(matchContractCompany(extracted, [{ ...company("a", "Acme"), taxId: "VAT 1234" }]).providerId, "a");
  extracted.parties[0].taxId = "---";
  assert.equal(matchContractCompany(extracted, [company("a", "Acme")]).providerId, undefined);
  extracted.parties[0].email = "contracts@acme.test";
  assert.equal(matchContractCompany(extracted, [{ ...company("a", "Acme"), email: "billing@acme.test; contracts@acme.test" }]).providerId, "a");
});
test("contract file validation inspects contents and handles bounded Word documents", () => {
  const docx = zipSync({ "word/document.xml": strToU8("<w:p><w:t>Acme agreement &amp; terms</w:t></w:p>"), "[Content_Types].xml": strToU8("<Types />") });
  assert.equal(contractFileType(docx, "agreement.docx"), docxType);
  assert.match(contractText(docx, docxType)!, /Acme agreement & terms/);
  assert.equal(contractFileType(strToU8("%PDF-1.7\nContract"), "contract.bin"), "application/pdf");
  assert.throws(() => contractFileType(strToU8("fake PDF"), "agreement.pdf"));
  assert.throws(() => contractFileType(zipSync({ "file.txt": strToU8("bad") }), "bad.docx"));
  assert.throws(() => contractFileType(new Uint8Array(), "empty.txt"));
  const huge = zipSync({ "word/document.xml": new Uint8Array(2 * 1024 * 1024 + 1), "[Content_Types].xml": strToU8("<Types />") });
  assert.throws(() => contractFileType(huge, "bomb.docx"), /exceeds 2 MB/);
});
test("recognition validation rejects malformed model output", () => {
  assert.throws(() => validateContractExtraction({ ...extract("Acme"), confidence: 3 }));
  assert.throws(() => validateContractExtraction({ ...extract("Acme"), parties: [null] }));
  assert.deepEqual(validateContractExtraction(extract("Acme")), extract("Acme"));
});
