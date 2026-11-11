/** Isolates the new scheduler job while legacy notification tests exercise their existing sources. */
export async function withTrackerSchedulerFixture<T>(env: T, run: (env: T) => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://tracker-scheduler-test.convex.cloud/")) {
      const body = JSON.parse(String(init?.body));
      if (body.path === "receivables:reminders") return Response.json({ status: "success", value: null });
      if (body.path === "receivables:deliveryClaim") return Response.json({ status: "success", value: [] });
      throw new Error(`Unexpected tracker scheduler query: ${body.path}`);
    }
    return original(input, init);
  };
  try { await run({ ...env, CONVEX_URL: "https://tracker-scheduler-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test" }); } finally { globalThis.fetch = original; }
}
