import { readBoundedResponseText } from "./boundedHttp";
export type MeritReplacementRequest = (path: string, payload: unknown) => Promise<unknown>;
export class MeritRequestRejected extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number) {
    super(`Merit rejected the request (${status}). ${status === 429 ? "Rate limit reached; wait before trying again." : "Correct the invoice or permissions in Merit before trying again."}`);
  }
}

/** No automatic retries: a timeout on an accounting write is an unknown result. */
export async function replacementRequest(url: (path: string, body: string) => string | Promise<string>, path: string, payload: unknown): Promise<unknown> {
  const body = JSON.stringify(payload);
  const response = await fetch(await url(path, body), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    await response.body?.cancel();
    const retry = response.headers.get("Retry-After");
    const retryAfterMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry ?? "") - Date.now()) || 30_000;
    if ([400, 401, 403, 404, 422, 429].includes(response.status)) throw new MeritRequestRejected(response.status, retryAfterMs);
    throw new Error(`Merit request failed (${response.status}); check replacement status before retrying`);
  }
  const text = await readBoundedResponseText(response, "Merit", 25 * 1024 * 1024, 30_000);
  if (path.startsWith("/v2/deleteinvoice/")) return null; // Confirm deletion from a separate read, regardless of response body.
  if (!text) throw new Error("Merit returned an empty response");
  return JSON.parse(text);
}

