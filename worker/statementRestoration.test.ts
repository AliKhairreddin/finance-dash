import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import {
  statementAccounts,
  statementCompanies,
  statementWorkspaces,
  statementPermissions,
  validateStatementInput,
  matchStatementCompany,
} from "../shared/statements";
import { validateMerchantSuggestion } from "../shared/statementIntelligence";
import { invoiceHtml } from "./statementInvoicePdf";
process.env.CONVEX_SERVICE_TOKEN = "restoration-test";
const auth = { serviceToken: "restoration-test", actor: "Ali" };
const modules = {
  "../convex/statementAutomation.ts": () =>
    import("../convex/statementAutomation"),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/statements.ts": () => import("../convex/statements"),
  "../convex/statementInvoices.ts": () => import("../convex/statementInvoices"),
  "../convex/statementIntelligence.ts": () =>
    import("../convex/statementIntelligence"),
  "../convex/statementWorkspace.ts": () =>
    import("../convex/statementWorkspace"),
  "../convex/statementLibrary.ts": () => import("../convex/statementLibrary"),
  "../convex/statementDesigns.ts": () => import("../convex/statementDesigns"),
};
const entry = (account: string) => ({
  companyId: "lovemedo" as const,
  financialAccountId: account,
  date: "2026-10-01",
  description: "Synthetic hosting",
  counterparty: "Synthetic Merchant",
  amount: "100.00",
  currency: "EUR",
  direction: "out" as const,
  source: account,
  account,
  providerId: crypto.randomUUID(),
});
const details = {
  ours: {
    name: "LoveMeDo B.V.",
    address: "SYNTHETIC — Example Lane 1",
    vat: "",
  },
  other: {
    name: "Synthetic Merchant",
    address: "SYNTHETIC — Sample Lane 2",
    vat: "",
  },
  description: "Web hosting services",
};
async function fixture() {
  const t = convexTest(schema, modules);
  await t.mutation(api.statements.initialize, {
    serviceToken: auth.serviceToken,
  });
  const ids = await t.mutation(api.statements.createTransactions, {
    ...auth,
    requestId: crypto.randomUUID(),
    rows: statementAccounts.map((a) => entry(a.id)),
  });
  return { t, ids };
}
function begin(
  ids: ReturnType<typeof fixture> extends Promise<infer T>
    ? T extends { ids: infer I }
      ? I
      : never
    : never,
) {
  return {
    ...auth,
    ids,
    requestId: crypto.randomUUID(),
    plainDetailsJson: JSON.stringify(details),
    instructions: "",
    draftJson: JSON.stringify({
      number: "",
      date: "",
      dueDate: "",
      customer: "",
      customerAddress: "",
      notes: "",
      currency: "EUR",
      taxMode: "included",
      lines: [{ taxPercent: "21" }],
    }),
  };
}
async function finish(
  t: Awaited<ReturnType<typeof fixture>>["t"],
  id: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>["t"]["mutation"]>>,
) {
  const token = crypto.randomUUID();
  await t.mutation(api.statementInvoices.claim, { ...auth, id, token });
  const row = JSON.parse(
    await t.query(api.statementInvoices.get, { ...auth, id }),
  );
  await t.mutation(api.statementInvoices.generated, {
    ...auth,
    id,
    token,
    resultJson: JSON.stringify({
      lines: row.sources.map(
        (s: { transactionId: string; description: string }) => ({
          transactionId: s.transactionId,
          description: s.description,
        }),
      ),
    }),
  });
  const generated = JSON.parse(
    await t.query(api.statementInvoices.get, { ...auth, id }),
  );
  const storageId = await t.run((ctx) =>
    ctx.storage.store(
      new Blob(["%PDF-1.7 synthetic fixture"], { type: "application/pdf" }),
    ),
  );
  await t.mutation(api.statementInvoices.finalize, {
    ...auth,
    id,
    revision: generated.revision,
    storageId,
    confirmed: false,
  });
  return storageId;
}
test("eight named workspaces preserve seven legal companies, three LMD accounts and unassigned card 1003", () => {
  assert.equal(statementWorkspaces.length, 8);
  assert.equal(statementCompanies.length, 7);
  assert.ok(!statementWorkspaces.some((c) => String(c.id) === "wise-lmd"));
  const row = matchStatementCompany(
    validateStatementInput({
      ...entry("revolut-lmd"),
      companyId: undefined,
      financialAccountId: undefined,
      cardLastFour: "1003",
    }),
    [
      {
        _id: "bad",
        companyId: "lovemedo",
        lastFour: "1003",
        label: "Unverified",
        active: true,
      },
    ],
  );
  assert.equal(row.companyId, undefined);
});
test("Mix and direct reads isolate LMD financial accounts without moving historical Wise records", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    const member = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", "Alaa"))
      .unique();
    await ctx.db.patch(member!._id, {
      companyIds: ["lovemedo"],
      accountIds: ["revolut-lmd"],
      permissions: [...statementPermissions],
    });
  });
  const visible = await t.query(api.statements.listTransactions, {
    ...auth,
    actor: "Alaa",
  });
  assert.deepEqual(
    visible.transactions.map((r) => r._id),
    [ids[0]],
  );
  await assert.rejects(
    t.mutation(api.statements.updateTransaction, {
      ...auth,
      actor: "Alaa",
      id: ids[1],
      expectedRevision: 1,
      fields: entry("amex-lmd"),
    }),
  );
  const result = await t.mutation(api.statements.transactionActions, {
    ...auth,
    actor: "Alaa",
    ids: [ids[0], ids[1]],
    action: "hide",
  });
  assert.deepEqual(
    result.map((r) => r.outcome),
    ["success", "failed"],
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.get(ids[2])))?.financialAccountId,
    "wise-lmd",
  );
});
test("fresh request IDs and different users converge on one document; LMD numbering shares a legal issuer", async () => {
  const { t, ids } = await fixture();
  const commands = Array.from({ length: 5 }, (_, i) => ({
    ...begin([ids[0]]),
    actor: i % 2 ? "Ali M" : "Ali",
  }));
  const created = await Promise.all(
    commands.map((c) => t.mutation(api.statementInvoices.begin, c)),
  );
  assert.equal(new Set(created).size, 1);
  const amex = await t.mutation(api.statementInvoices.begin, begin([ids[1]]));
  const a = JSON.parse(
      await t.query(api.statementInvoices.get, { ...auth, id: created[0] }),
    ),
    b = JSON.parse(
      await t.query(api.statementInvoices.get, { ...auth, id: amex }),
    );
  assert.equal(a.number, "LMD-SUP-2026-000001");
  assert.equal(b.number, "LMD-SUP-2026-000002");
  assert.equal(a.draft.taxAssessment, "unassessed");
  assert.equal(a.draft.lines[0].taxPercent, "0");
  assert.match(a.layout.sellerDetails, /LoveMeDo/);
  assert.equal(a.draft.customer, "Synthetic Merchant");
  assert.match(
    invoiceHtml(a.draft, a.layout, false),
    /Not a supplier-issued invoice/,
  );
});
test("completion, Done, forgotten and visibility remain independent and reversible", async () => {
  const { t, ids } = await fixture();
  const act = (action: string, reason?: string) =>
    t.mutation(api.statements.transactionActions, {
      ...auth,
      ids: [ids[0]],
      action,
      reason,
    });
  assert.equal((await act("done"))[0].outcome, "failed");
  await act("complete", "manual evidence reviewed");
  await act("done");
  await act("forget", "Waiting for replacement");
  await act("hide");
  let row = await t.run((ctx) => ctx.db.get(ids[0]));
  assert.equal(row?.status, "completed");
  assert.ok(row?.doneAt && row?.forgottenAt && row?.hiddenAt);
  await act("undo_done");
  row = await t.run((ctx) => ctx.db.get(ids[0]));
  assert.equal(row?.status, "completed");
  assert.equal(row?.doneAt, undefined);
  assert.ok(row?.forgottenAt);
  await act("undo_forget");
  await act("unhide");
  assert.equal(
    (
      await t.query(api.statements.listTransactions, {
        ...auth,
        status: "completed",
      })
    ).total,
    1,
  );
});
test("generated evidence supports reconciliation and financial edits preserve stale PDFs", async () => {
  const { t, ids } = await fixture();
  const id = await t.mutation(api.statementInvoices.begin, begin([ids[0]])),
    storageId = await finish(t, id);
  assert.equal(
    (
      await t.mutation(api.statements.transactionActions, {
        ...auth,
        ids: [ids[0]],
        action: "reconcile",
      })
    )[0].outcome,
    "success",
  );
  const txn = (await t.run((ctx) => ctx.db.get(ids[0])))!;
  await t.mutation(api.statements.updateTransaction, {
    ...auth,
    id: ids[0],
    expectedRevision: txn.revision,
    fields: {
      ...entry("revolut-lmd"),
      description: "Corrected merchant description",
      providerId: txn.providerId,
    },
    reviewed: true,
  });
  const old = JSON.parse(
    await t.query(api.statementInvoices.get, { ...auth, id }),
  );
  assert.equal(old.state, "stale");
  assert.equal(old.storageId, storageId);
  assert.ok(old.pdfUrl);
  const replacement = await t.mutation(
    api.statementInvoices.begin,
    begin([ids[0]]),
  );
  assert.notEqual(replacement, id);
  await finish(t, replacement);
  assert.equal(
    (
      await t.query(api.statements.listLinks, {
        ...auth,
        transactionId: ids[0],
      })
    ).length,
    1,
  );
});
test("research queue deduplicates exact scoped merchants, rejects invented sources, and preserves approval", async () => {
  const { t, ids } = await fixture();
  await t.mutation(api.statements.createTransactions, {
    ...auth,
    requestId: crypto.randomUUID(),
    rows: [entry("revolut-lmd")],
  });
  const rows = JSON.parse(await t.query(api.statementIntelligence.list, auth));
  assert.equal(rows.length, 3);
  const row = rows.find(
    (r: { financialAccountId: string }) =>
      r.financialAccountId === "revolut-lmd",
  );
  assert.throws(
    () =>
      validateMerchantSuggestion({ sources: ["https://invented.invalid"] }, [
        "https://official.example",
      ]),
    /source/,
  );
  const profile = {
    canonicalName: "Synthetic Merchant",
    website: "https://merchant.example",
    category: "hosting",
    address: "Example address",
    addressType: "registered",
    country: "NL",
    logoSource: "",
    description: "Web hosting services",
    sources: ["https://merchant.example/legal"],
    confidence: 0.9,
    conflicts: [],
  };
  await t.mutation(internal.statementIntelligence.claim, {
    id: row._id,
    token: "test",
  });
  await t.mutation(internal.statementIntelligence.finish, {
    id: row._id,
    token: "test",
    sources: profile.sources,
    suggestionJson: JSON.stringify(profile),
  });
  await t.mutation(api.statementIntelligence.review, {
    ...auth,
    id: row._id,
    decision: "approve",
  });
  const approved = (await t.run((ctx) => ctx.db.get(row._id)))!;
  assert.ok("approvedJson" in approved && approved.approvedJson);
  const setup = JSON.parse(
    await t.query(api.statementInvoices.setup, { ...auth, ids: [ids[0]] }),
  );
  assert.ok(
    setup.addresses.some(
      (a: { address: string }) => a.address === "Example address",
    ),
  );
});
test("missing action grants fail closed even with legal-company membership", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    const m = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", "Alaa"))
      .unique();
    await ctx.db.patch(m!._id, { permissions: ["view"] });
  });
  await assert.rejects(
    t.mutation(api.statements.transactionActions, {
      ...auth,
      actor: "Alaa",
      ids: [ids[0]],
      action: "hide",
    }),
    /hide/,
  );
  await assert.rejects(
    t.mutation(api.statementInvoices.begin, {
      ...begin([ids[0]]),
      actor: "Alaa",
    }),
    /generate/,
  );
});

test("cancelled and stale generated evidence cannot be reconciled; extraction IDs remain uploaded documents", async () => {
  const { t, ids } = await fixture(),
    id = await t.mutation(api.statementInvoices.begin, begin([ids[0]]));
  await finish(t, id);
  await t.mutation(api.statementLibrary.action, {
    ...auth,
    source: "generated",
    ids: [id],
    action: "cancel",
  });
  assert.equal(
    (
      await t.mutation(api.statements.transactionActions, {
        ...auth,
        ids: [ids[0]],
        action: "complete",
      })
    )[0].outcome,
    "failed",
  );
  const original = await t.run(async (ctx) => {
    const doc = (await ctx.db.query("statementDocuments").first())!;
    const { _id, _creationTime, generatedInvoiceId, cancelledAt, ...data } =
      doc;
    return ctx.db.insert("statementDocuments", {
      ...data,
      generationId: "ocr-model-request",
      contentHash: "original",
      fileName: "supplier-original.pdf",
    });
  });
  const library = JSON.parse(
    await t.query(api.statementLibrary.page, { ...auth, source: "uploaded" }),
  );
  assert.ok(library.items.some((r: { id: string }) => r.id === original));
});
test("regeneration versions retain immutable PDFs and form an auditable chain", async () => {
  const { t, ids } = await fixture(),
    first = await t.mutation(api.statementInvoices.begin, begin([ids[0]])),
    blob = await finish(t, first);
  const next = await t.mutation(api.statementInvoices.begin, {
    ...begin([ids[0]]),
    regenerate: true,
  });
  await finish(t, next);
  const previous = JSON.parse(
      await t.query(api.statementInvoices.get, { ...auth, id: first }),
    ),
    current = JSON.parse(
      await t.query(api.statementInvoices.get, { ...auth, id: next }),
    );
  assert.equal(previous.state, "superseded");
  assert.equal(previous.storageId, blob);
  assert.equal(previous.supersededBy, next);
  assert.equal(current.predecessorId, first);
  assert.equal(
    JSON.parse(
      await t.query(api.statementInvoices.history, { ...auth, id: next }),
    ).length,
    2,
  );
});
test("sales invoices require an explicit issuer, tax and date policy, with a separate legal sequence", async () => {
  const { t } = await fixture();
  await assert.rejects(
    t.mutation(api.statementWorkspace.savePolicy, {
      ...auth,
      companyId: "lovemedo",
      revision: 0,
      settingsJson: JSON.stringify({ salesInvoiceApproved: true }),
    }),
    /policy/,
  );
  await t.mutation(api.statementWorkspace.savePolicy, {
    ...auth,
    companyId: "lovemedo",
    revision: 0,
    settingsJson: JSON.stringify({
      salesInvoiceApproved: true,
      legalName: "LoveMeDo B.V.",
      legalAddress: "SYNTHETIC registered office",
      taxPolicy: "Synthetic explicitly approved rate",
      taxRate: "9",
      invoiceDatePolicy: "transaction",
    }),
  });
  const ids = await t.mutation(api.statements.createTransactions, {
    ...auth,
    requestId: crypto.randomUUID(),
    rows: [{ ...entry("amex-lmd"), direction: "in" }],
  });
  const id = await t.mutation(api.statementInvoices.begin, begin(ids)),
    row = JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id }));
  assert.equal(row.documentType, "sales_invoice");
  assert.equal(row.draft.lines[0].taxPercent, "9");
  assert.equal(row.number, "LMD-INV-2026-000001");
  assert.match(row.layout.sellerDetails, /registered office/);
});
test("document design locking and version history require explicit settings permission", async () => {
  const { t } = await fixture(),
    design = {
      ...auth,
      companyId: "lovemedo" as const,
      style: "technology",
      accent: "#4f46e5",
      locked: true,
      expectedVersion: 0,
      brandingAuthorized: false,
    };
  await t.mutation(api.statementDesigns.save, design);
  await assert.rejects(
    t.mutation(api.statementDesigns.save, { ...design, expectedVersion: 1 }),
    /Unlock/,
  );
  await t.mutation(api.statementDesigns.save, {
    ...design,
    locked: false,
    expectedVersion: 1,
  });
  const row = JSON.parse(await t.query(api.statementDesigns.list, auth)).find(
    (r: { companyId: string }) => r.companyId === "lovemedo",
  );
  assert.equal(row.versions.length, 2);
  assert.equal(JSON.parse(row.design.designJson).logoPath, undefined);
});
test("saved counterparty profiles remain independent between LMD accounts", async () => {
  const { t, ids } = await fixture();
  await t.mutation(api.statementInvoices.begin, {
    ...begin([ids[0]]),
    remember: true,
    profileRevision: 0,
  });
  const revolut = JSON.parse(
      await t.query(api.statementInvoices.setup, { ...auth, ids: [ids[0]] }),
    ),
    amex = JSON.parse(
      await t.query(api.statementInvoices.setup, { ...auth, ids: [ids[1]] }),
    );
  assert.equal(revolut.profiles.length, 1);
  assert.equal(amex.profiles.length, 0);
});
test("automatic rules require verified precedence and queue idempotent requests without asserting payment", async () => {
  const { t } = await fixture(),
    base = {
      ...auth,
      companyId: "lovemedo" as const,
      financialAccountId: "revolut-lmd",
      revision: 0,
    };
  await assert.rejects(
    t.mutation(api.statementWorkspace.savePolicy, {
      ...base,
      settingsJson: JSON.stringify({ automaticRequest: true }),
    }),
    /precedence/,
  );
  await t.mutation(api.statementWorkspace.savePolicy, {
    ...base,
    settingsJson: JSON.stringify({
      automaticRequest: true,
      rulePrecedenceVerified: true,
      ruleOrder: "complete_then_request",
      automaticRulePolicy: "Synthetic verified fixture policy",
    }),
  });
  const ids = await t.mutation(api.statements.createTransactions, {
    ...auth,
    requestId: crypto.randomUUID(),
    rows: [{ ...entry("revolut-lmd"), amount: "123.45" }],
  });
  const jobs = await t.run((ctx) =>
    ctx.db.query("statementAutomationJobs").collect(),
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].transactionId, ids[0]);
  assert.equal((await t.run((ctx) => ctx.db.get(ids[0])))?.status, "pending");
  assert.equal(
    await t.mutation(internal.statementAutomation.claim, {
      id: jobs[0]._id,
      token: "first",
    }),
    true,
  );
  assert.equal(
    await t.mutation(internal.statementAutomation.claim, {
      id: jobs[0]._id,
      token: "second",
    }),
    false,
  );
  await t.run(async (ctx) => {
    const m = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", "Ali"))
      .unique();
    await ctx.db.patch(m!._id, { permissions: ["view"] });
  });
  await assert.rejects(
    t.query(api.statementAutomation.job, {
      serviceToken: auth.serviceToken,
      id: jobs[0]._id,
      token: "first",
    }),
    /authorized/,
  );
});
test("migration dry runs and identity updates preserve amounts, sources, files and Wise ownership", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    for (const id of ids) await ctx.db.patch(id, { identity: "legacy:" + id });
  });
  const before = await t.run((ctx) => ctx.db.get(ids[2]));
  const dry = JSON.parse(
    await t.mutation(internal.statementWorkspace.migrateIdentity, {
      paginationOpts: { cursor: null, numItems: 100 },
      dryRun: true,
    }),
  );
  assert.equal(dry.changes.length, 3);
  assert.deepEqual(await t.run((ctx) => ctx.db.get(ids[2])), before);
  await t.mutation(internal.statementWorkspace.migrateIdentity, {
    paginationOpts: { cursor: null, numItems: 100 },
    dryRun: false,
  });
  const after = await t.run((ctx) => ctx.db.get(ids[2]));
  assert.equal(after?.financialAccountId, "wise-lmd");
  assert.equal(after?.source, before?.source);
  assert.equal(after?.amountMinor, before?.amountMinor);
  assert.deepEqual(after?.documentIds, before?.documentIds);
});
test("view-only membership cannot edit, export, import, download or manage account policy", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    const m = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", "Alaa"))
      .unique();
    await ctx.db.patch(m!._id, { permissions: ["view"] });
  });
  const restricted = { ...auth, actor: "Alaa" };
  await assert.rejects(
    t.query(api.statements.exportSelected, { ...restricted, ids }),
  );
  await assert.rejects(
    t.mutation(api.statements.createTransactions, {
      ...restricted,
      requestId: crypto.randomUUID(),
      rows: [entry("revolut-lmd")],
    }),
  );
  await assert.rejects(
    t.query(api.statementLibrary.page, { ...restricted, source: "uploaded" }),
  );
  await assert.rejects(t.query(api.statements.listAddresses, restricted));
  await assert.rejects(t.query(api.statementWorkspace.settings, restricted));
  for (const action of [
    "complete",
    "done",
    "reopen",
    "forget",
    "hide",
    "trash",
    "restore",
    "request",
  ])
    await assert.rejects(
      t.mutation(api.statements.transactionActions, {
        ...restricted,
        ids: [ids[0]],
        action,
        reason: "Fixture",
      }),
    );
});

test("verified card context resolves the account while conflicts and arbitrary digits stay unresolved", () => {
  const raw = validateStatementInput({
    ...entry("amex-lmd"),
    companyId: undefined,
    financialAccountId: undefined,
    cardLastFour: "7777",
  });
  const card = {
    _id: "test",
    companyId: "lovemedo" as const,
    financialAccountId: "amex-lmd",
    lastFour: "7777",
    label: "Explicit test mapping",
    active: true,
  };
  assert.equal(
    matchStatementCompany(raw, [card]).financialAccountId,
    "amex-lmd",
  );
  const conflict = matchStatementCompany(raw, [
    card,
    { ...card, _id: "conflict", financialAccountId: "revolut-lmd" },
  ]);
  assert.equal(conflict.financialAccountId, undefined);
  assert.ok(conflict.reviewReasons.length);
  const prose = validateStatementInput({
    ...entry("amex-lmd"),
    companyId: undefined,
    financialAccountId: undefined,
    description: "Order number 7777; arbitrary digits",
  });
  assert.equal(matchStatementCompany(prose, [card]).companyId, undefined);
});

test("import corrections preserve the original while updating account scope and revoked imports cannot run", async () => {
  const { t, ids } = await fixture();
  const invoiceId = await t.mutation(
    api.statementInvoices.begin,
    begin([ids[0]]),
  );
  await finish(t, invoiceId);
  const original = await t.run(async (ctx) => {
    const doc = (await ctx.db.query("statementDocuments").first())!;
    const { _id, _creationTime, generatedInvoiceId, ...fields } = doc;
    return ctx.db.insert("statementDocuments", {
      ...fields,
      transactionIds: [],
      contentHash: "e".repeat(64),
      fileName: "synthetic-original.pdf",
      documentType: "bank_statement",
    });
  });
  const before = await t.run((ctx) => ctx.db.get(original));
  const importId = await t.mutation(api.statements.stageImport, {
    ...auth,
    fileName: "synthetic-original.pdf",
    contentHash: "d".repeat(64),
    companyId: "lovemedo",
    origin: "file",
    documentId: original,
    rows: [
      validateStatementInput({ ...entry("revolut-lmd"), amount: "110.00" }),
    ],
    reviewReasons: [],
  });
  await t.mutation(api.statements.updateImport, {
    ...auth,
    id: importId,
    rows: [validateStatementInput({ ...entry("amex-lmd"), amount: "110.00" })],
    reviewReasons: [],
  });
  const after = await t.run((ctx) => ctx.db.get(original));
  assert.equal(after?.financialAccountId, "amex-lmd");
  assert.equal(after?.storageId, before?.storageId);
  await t.run(async (ctx) => {
    await ctx.db.patch(importId, { status: "importing", confirmedBy: "Ali" });
    const m = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", "Ali"))
      .unique();
    await ctx.db.patch(m!._id, { permissions: ["view"] });
  });
  await assert.rejects(
    t.mutation(internal.statements.processImportBatch, { id: importId }),
    /import/,
  );
  assert.equal((await t.run((ctx) => ctx.db.get(importId)))?.inserted, 0);
});

test("a queued request revalidates its policy, merchant rule and financial revision at execution", async () => {
  const { t } = await fixture();
  const settings = {
    automaticRequest: true,
    rulePrecedenceVerified: true,
    ruleOrder: "complete_then_request",
    automaticRulePolicy: "Verified synthetic policy",
  };
  await t.mutation(api.statementWorkspace.savePolicy, {
    ...auth,
    companyId: "lovemedo",
    financialAccountId: "revolut-lmd",
    revision: 0,
    settingsJson: JSON.stringify(settings),
  });
  const [id] = await t.mutation(api.statements.createTransactions, {
    ...auth,
    requestId: crypto.randomUUID(),
    rows: [{ ...entry("revolut-lmd"), amount: "111.23" }],
  });
  const job = (await t.run((ctx) =>
    ctx.db.query("statementAutomationJobs").first(),
  ))!;
  await t.mutation(internal.statementAutomation.claim, {
    id: job._id,
    token: "lease",
  });
  const args = { serviceToken: auth.serviceToken, id: job._id, token: "lease" };
  assert.equal(
    JSON.parse(await t.query(api.statementAutomation.job, args)).transactionId,
    id,
  );
  await t.mutation(api.statementWorkspace.savePolicy, {
    ...auth,
    companyId: "lovemedo",
    financialAccountId: "revolut-lmd",
    revision: 1,
    settingsJson: JSON.stringify({
      ...settings,
      ruleMerchant: "A different approved merchant",
    }),
  });
  await assert.rejects(
    t.query(api.statementAutomation.job, args),
    /authorized/,
  );
  await t.mutation(api.statementWorkspace.savePolicy, {
    ...auth,
    companyId: "lovemedo",
    financialAccountId: "revolut-lmd",
    revision: 2,
    settingsJson: JSON.stringify(settings),
  });
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(id))!;
    await ctx.db.patch(id, {
      financialRevision: (row.financialRevision ?? row.revision) + 1,
    });
  });
  await assert.rejects(
    t.query(api.statementAutomation.job, args),
    /authorized/,
  );
});

test("merchant activation is idempotent, skips trash, preserves records and protects leased research jobs", async () => {
  const { t, ids } = await fixture();
  await t.mutation(api.statements.createTransactions, { ...auth, requestId: crypto.randomUUID(), rows: [entry("revolut-lmd")] });
  await t.run(async ctx => {
    await ctx.db.patch(ids[2], { deletedAt: new Date().toISOString() });
    for (const row of await ctx.db.query("statementMerchants").take(100)) await ctx.db.delete(row._id);
    await ctx.db.insert("dashboardState", {
      key: "default", providers: [], invoices: [], expenses: [], manualReceivables: [], teams: [], transactionCategoryRules: [], revenuePartners: [],
      wiseCardHolderTeamAssignments: [], wiseStatementImports: [], revenueRuns: [], revenueAccruals: [], paymentAllocations: [], holdings: [], fxRates: [],
      automationRuns: [], profitDistributionAdjustments: [], updatedAt: new Date().toISOString(), aiSettings: { provider: "openrouter", model: "saved-model" },
    });
  });
  const before = await t.run(ctx => ctx.db.query("statementTransactions").take(100));
  const args = { paginationOpts: { cursor: null, numItems: 100 }, dryRun: true };
  assert.equal((await t.mutation(internal.statementIntelligence.enqueueExisting, args)).queued, 2);
  assert.equal((await t.run(ctx => ctx.db.query("statementMerchants").take(100))).length, 0);
  assert.equal((await t.mutation(internal.statementIntelligence.enqueueExisting, { ...args, dryRun: false })).queued, 2);
  assert.equal((await t.mutation(internal.statementIntelligence.enqueueExisting, { ...args, dryRun: false })).queued, 0);
  assert.deepEqual(await t.run(ctx => ctx.db.query("statementTransactions").take(100)), before);
  const merchant = (await t.run(ctx => ctx.db.query("statementMerchants").first()))!;
  await t.mutation(internal.statementIntelligence.claim, { id: merchant._id, token: "lease" });
  const request = { serviceToken: auth.serviceToken, id: merchant._id, token: "lease" };
  assert.deepEqual(await t.query(api.statementIntelligence.researchJob, request), { name: merchant.name, model: "saved-model" });
  await assert.rejects(t.query(api.statementIntelligence.researchJob, { ...request, token: "wrong" }), /lease/);
  await assert.rejects(t.query(api.statementIntelligence.researchJob, { ...request, serviceToken: "wrong" }), /Unauthorized/);
  await t.run(ctx => ctx.db.patch(merchant._id, { leaseUntil: 0 }));
  await assert.rejects(t.query(api.statementIntelligence.researchJob, request), /lease/);
});

test("merchant research honors rate limits and refreshes suggestions without replacing approved data", async (context) => {
  const { t } = await fixture(),
    merchant = (await t.run((ctx) =>
      ctx.db.query("statementMerchants").first(),
    ))!;
  const previous = Object.fromEntries(
    [
      "STATEMENT_PROCESSOR_URL",
    ].map((k) => [k, process.env[k]]),
  );
  process.env.STATEMENT_PROCESSOR_URL = "https://processor.example/api/statements/process";
  context.after(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  let calls = 0;
  const profile = {
    canonicalName: "Synthetic Merchant",
    website: "https://merchant.example",
    category: "hosting",
    address: "SYNTHETIC approved address",
    addressType: "registered",
    country: "NL",
    logoSource: "",
    description: "Web hosting services",
    sources: ["https://merchant.example/legal"],
    confidence: 0.9,
    conflicts: [],
  };
  const mock = context.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL) => {
      calls++;
      const url = String(input);
      if (url === "https://processor.example/api/internal/statements/research")
        return Response.json({ message: "Research provider rate limit" }, {
          status: 429,
          headers: { "Retry-After": "3600" },
        });
      throw new Error("Unexpected external request blocked");
    },
  );
  const before = Date.now();
  await t.action(internal.statementIntelligence.research, { id: merchant._id });
  const failed = (await t.run((ctx) => ctx.db.get(merchant._id)))!;
  assert.equal(failed.status, "failed");
  assert.ok(failed.nextAttemptAt >= before + 3600000);
  assert.equal(calls, 1);
  await t.run((ctx) => ctx.db.patch(merchant._id, { nextAttemptAt: 0 }));
  mock.mock.mockImplementation(async (input: RequestInfo | URL) => {
    calls++;
    if (String(input) === "https://processor.example/api/internal/statements/research")
      return Response.json({ suggestion: profile, sources: profile.sources });
    throw new Error("Unexpected external request blocked");
  });
  await t.action(internal.statementIntelligence.research, { id: merchant._id });
  await t.mutation(api.statementIntelligence.review, {
    ...auth,
    id: merchant._id,
    decision: "approve",
  });
  const approved = (await t.run((ctx) => ctx.db.get(merchant._id)))!;
  assert.equal(
    await t.mutation(internal.statementIntelligence.claim, {
      id: merchant._id,
      token: "too-soon",
    }),
    null,
  );
  await t.run((ctx) => ctx.db.patch(merchant._id, { nextAttemptAt: 0 }));
  assert.ok(
    (await t.query(internal.statementIntelligence.due, {})).includes(
      merchant._id,
    ),
  );
  profile.address = "SYNTHETIC new suggestion, not approved";
  await t.action(internal.statementIntelligence.research, { id: merchant._id });
  const refreshed = (await t.run((ctx) => ctx.db.get(merchant._id)))!;
  assert.equal(refreshed.approvedJson, approved.approvedJson);
  assert.match(refreshed.suggestionJson!, /new suggestion/);
  assert.equal(refreshed.attempts, 0);
});

test("document metadata, binary downloads, cancellations and reminder ownership enforce separate permissions", async () => {
  const { t, ids } = await fixture(),
    id = await t.mutation(api.statementInvoices.begin, begin([ids[0]]));
  await finish(t, id);
  const doc = (await t.run((ctx) =>
    ctx.db.query("statementDocuments").first(),
  ))!;
  await t.run(async (ctx) => {
    const m = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", "Alaa"))
      .unique();
    await ctx.db.patch(m!._id, { permissions: ["view", "documents"] });
  });
  const viewer = { ...auth, actor: "Alaa", id: doc._id };
  const metadata = await t.query(api.statements.getDocument, {
    ...viewer,
    metadataOnly: true,
  });
  assert.equal(metadata?.url, null);
  await assert.rejects(t.query(api.statements.getDocument, viewer), /download/);
  await t.mutation(api.statementWorkspace.remind, {
    ...auth,
    transactionId: ids[0],
    dueAt: Date.now() + 86400000,
    message: "Synthetic reminder",
  });
  const notices = JSON.parse(
    await t.query(api.statementWorkspace.notifications, auth),
  );
  assert.equal(notices.length, 1);
  await assert.rejects(
    t.mutation(api.statementWorkspace.readNotification, {
      ...auth,
      actor: "Ali M",
      id: notices[0]._id,
    }),
    /not found/,
  );
  await t.mutation(api.statementLibrary.action, {
    ...auth,
    source: "generated",
    ids: [id],
    action: "cancel",
  });
  assert.equal(
    (await t.run((ctx) => ctx.db.query("statementLinks").collect())).length,
    0,
  );
  assert.equal(
    (await t.run((ctx) => ctx.db.get(doc._id)))?.storageId,
    doc.storageId,
  );
});

test("custom company branding requires authorization and remains immutable in version history", async () => {
  const { t } = await fixture();
  const logoDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yVZkAAAAASUVORK5CYII=";
  const input = {
    ...auth,
    companyId: "artec" as const,
    style: "technology",
    accent: "#4f46e5",
    locked: false,
    expectedVersion: 0,
    brandingAuthorized: false,
    logoDataUrl,
  };
  await assert.rejects(
    t.mutation(api.statementDesigns.save, input),
    /Authorize/,
  );
  await t.mutation(api.statementDesigns.save, {
    ...input,
    brandingAuthorized: true,
  });
  await assert.rejects(
    t.mutation(api.statementDesigns.save, {
      ...input,
      expectedVersion: 1,
      brandingAuthorized: true,
      logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
    }),
    /PNG/,
  );
  await t.mutation(api.statementDesigns.save, {
    ...input,
    expectedVersion: 1,
    brandingAuthorized: true,
    logoDataUrl: "",
  });
  const versions = await t.run((ctx) =>
    ctx.db
      .query("statementTemplateVersions")
      .withIndex("by_company", (q) => q.eq("companyId", "artec"))
      .collect(),
  );
  assert.equal(versions.length, 2);
  assert.equal(JSON.parse(versions[0].designJson).logoDataUrl, logoDataUrl);
  assert.equal(JSON.parse(versions[1].designJson).logoDataUrl, undefined);
});

test("identity migration rejects collisions within a page before changing either record", async () => {
  const { t, ids } = await fixture();
  await t.run(async (ctx) => {
    const row = (await ctx.db.get(ids[0]))!;
    await ctx.db.patch(row._id, { identity: "old-one" });
    const { _id, _creationTime, ...fields } = row;
    await ctx.db.insert("statementTransactions", {
      ...fields,
      identity: "old-two",
      intakeKey: "synthetic-duplicate-old",
    });
  });
  const args = {
    paginationOpts: { cursor: null, numItems: 100 },
    dryRun: true,
  };
  const report = JSON.parse(
    await t.mutation(internal.statementWorkspace.migrateIdentity, args),
  );
  assert.equal(report.conflicts.length, 1);
  await assert.rejects(
    t.mutation(internal.statementWorkspace.migrateIdentity, {
      ...args,
      dryRun: false,
    }),
    /collisions/,
  );
  assert.equal((await t.run((ctx) => ctx.db.get(ids[0])))?.identity, "old-one");
});

test("explicit access and numbering configuration supports dry runs and never rewinds issued sequences", async () => {
  const { t } = await fixture();
  const access = {
    memberActor: "Alaa" as const,
    companyIds: ["lovemedo" as const],
    accountIds: ["revolut-lmd"],
    permissions: ["view"],
    manage: false,
    operator: "Synthetic operator",
    reason: "Synthetic approved least privilege access policy",
    dryRun: true,
  };
  const before = await t.query(api.statements.bootstrap, {
    ...auth,
    actor: "Alaa",
  });
  await t.mutation(internal.statementWorkspace.configureAccess, access);
  assert.deepEqual(
    await t.query(api.statements.bootstrap, { ...auth, actor: "Alaa" }),
    before,
  );
  await t.mutation(internal.statementWorkspace.configureAccess, {
    ...access,
    dryRun: false,
  });
  assert.deepEqual(
    (await t.query(api.statements.bootstrap, { ...auth, actor: "Alaa" }))
      .accountIds,
    ["revolut-lmd"],
  );
  const number = {
    companyId: "lovemedo" as const,
    documentType: "internal_support" as const,
    year: "2026",
    next: 100,
    operator: "Synthetic operator",
    reason: "Synthetic approved numbering policy",
    dryRun: false,
  };
  await t.mutation(internal.statementWorkspace.configureNumberSequence, number);
  await assert.rejects(
    t.mutation(internal.statementWorkspace.configureNumberSequence, {
      ...number,
      next: 99,
    }),
    /decreased/,
  );
});
