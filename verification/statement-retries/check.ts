import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { handleStatementProcessing, type StatementEnv } from "../../worker/statements";

const url = process.env.TEST_CONVEX_URL!;
assert.equal(new URL(url).hostname, "127.0.0.1");
const client = new ConvexHttpClient(url);
const serviceToken = process.env.TEST_SERVICE_TOKEN!;
const fixture = anyApi.verificationFixture;
const providerHold = 7_200_000;
type Job = { at: number; args: { id: Id<"statementDocuments">; scheduledToken?: string } };
type Snapshot = { status: string; attempts: number; token: string | null; until: number | null; updated: number; jobs: Job[] };

async function snapshot(id: Id<"statementDocuments">): Promise<Snapshot> {
  return client.query(fixture.snapshot, { id });
}

async function setup(label: string) {
  const uploadUrl = await client.mutation(api.statements.generateUploadUrl, { serviceToken });
  const upload = await fetch(uploadUrl, { method: "POST", body: label });
  assert.equal(upload.ok, true);
  const { storageId } = await upload.json();
  const id: Id<"statementDocuments"> = await client.mutation(fixture.queuedPdf, {
    storageId, size: label.length, contentHash: createHash("sha256").update(label).digest("hex")
  });
  const observed: Snapshot[] = [];
  const env = {
    CONVEX_URL: url, CONVEX_SERVICE_TOKEN: serviceToken,
    BROWSER: { fetch: async () => {
      observed.push(await snapshot(id));
      return new Response("Try later", { status: 429, headers: { "Retry-After": "7200" } });
    } }
  } as StatementEnv;
  const response = await handleStatementProcessing(new Request("https://processor.test/api/statements/process", {
    method: "POST", headers: { Authorization: `Bearer ${serviceToken}` }, body: JSON.stringify({ id })
  }), env);
  assert.equal(response.status, 502);
  assert.equal(observed.length, 1, "Reach the rate-limited browser through the real Worker");
  const [active] = observed;
  const credentials = { serviceToken, id };
  const staleToken = active.token;
  assert.ok(staleToken);
  assert.equal(active.status, "processing");
  assert.equal(active.jobs.length, 1);
  assert.ok(active.until! > active.updated);
  assert.ok(active.jobs[0].at >= active.until!);
  const queued = await snapshot(id);
  assert.equal(queued.status, "queued");
  assert.equal(queued.until! - queued.updated, providerHold, "Stored OCR retry must honor Retry-After: 7200");
  assert.ok(active.until! - active.updated >= 8 * 60_000, "Keep the claim through the maximum callback duration");
  const retry = queued.jobs.find(job => job.at === queued.until);
  assert.ok(retry, "Schedule the provider retry at the persisted deadline");
  return { credentials, staleToken, watchdog: active.jobs[0], retry, queued };
}

await client.mutation(fixture.configureModel, {});
const events = ["old callback", "claim", "old worker failure"] as const;
for (const first of events) for (const second of events.filter(event => event !== first)) {
  const order = [first, second, ...events.filter(event => event !== first && event !== second)];
  const { credentials, staleToken, watchdog, retry, queued } = await setup(order.join(", "));
  const { id } = credentials;
  let nextToken: string | null = null;
  async function step(event: typeof events[number], eligible: boolean) {
    if (event === "old callback") await client.action(fixture.dispatch, watchdog.args);
    if (event === "old worker failure") {
      await client.mutation(api.statements.failDocument, { ...credentials, attemptToken: staleToken, error: "Late original error" });
    }
    if (event === "claim") {
      const claimed = await client.mutation(api.statements.claimDocument, credentials);
      if (eligible) { assert.ok(claimed); nextToken = claimed.attemptToken; assert.notEqual(nextToken, staleToken); }
      else assert.equal(claimed, null);
    }
    const row = await snapshot(id);
    assert.equal(row.status, nextToken ? "processing" : "queued", `${event} in ${order.join(", ")}`);
    assert.equal(row.attempts, nextToken ? 2 : 1);
    if (nextToken) assert.equal(row.token, nextToken);
    if (!eligible) assert.equal(row.until, queued.until);
  }
  for (const event of order) await step(event, false);
  await client.mutation(fixture.expireHold, { id });
  for (const event of order) await step(event, true);
  await client.mutation(api.statements.completeDocument, { ...credentials, attemptToken: staleToken, documentType: "unknown", evidence: [], reviewReasons: [], extracted: "{}" });
  assert.equal((await snapshot(id)).status, "processing");
  await client.action(fixture.dispatch, retry.args);
  const current = await snapshot(id);
  assert.equal(current.token, nextToken);
  const currentWatchdog = current.jobs.find(job => job.args.scheduledToken === nextToken);
  assert.ok(currentWatchdog, "Find the watchdog for the active replacement claim");
  await client.action(fixture.dispatch, currentWatchdog.args);
  assert.equal((await snapshot(id)).status, "processing", "Keep a claim until its lease expires");
  await client.mutation(fixture.expireHold, { id });
  await client.action(fixture.dispatch, watchdog.args);
  assert.equal((await snapshot(id)).status, "processing", "An older watchdog cannot end a newer claim, even after expiry");
  await client.action(fixture.dispatch, currentWatchdog.args);
  assert.equal((await snapshot(id)).status, "failed", "Surface an unreachable processor after the current lease expires");
}
const due = await setup("transport fails for the current scheduled retry");
await client.mutation(fixture.expireHold, { id: due.credentials.id });
await client.action(fixture.dispatch, due.retry.args);
assert.equal((await snapshot(due.credentials.id)).status, "failed", "Record a transport failure for the current eligible retry");
console.log("Verified all six event orders before and after the OCR retry deadline, plus current and stale watchdog failures.");
