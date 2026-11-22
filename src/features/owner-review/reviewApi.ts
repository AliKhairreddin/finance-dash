import { useEffect, useState } from "react";

export async function reviewApi<T>(base: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(base + "/monthly-review/" + path, { signal, cache: "no-store",
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.message || "Could not load monthly review.");
  }
  return response.json();
}

export async function reviewPages<T>(base: string, path: string, signal: AbortSignal) {
  const rows: T[] = [];
  let cursor: string | null = null;
  do {
    const page: { rows: T[]; next: string | null } = await reviewApi(base,
      path + (cursor ? (path.includes("?") ? "&" : "?") + "cursor=" + encodeURIComponent(cursor) : ""), undefined, signal);
    rows.push(...page.rows);
    cursor = page.next;
  } while (cursor);
  return rows;
}

export function useReviewData<T>(base: string, path: string | null, refresh = 0, paged = false) {
  const key = JSON.stringify([base, path, refresh]);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: "" });
  useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    const request = paged ? reviewPages(base, path, abort.signal) as Promise<T> : reviewApi<T>(base, path, undefined, abort.signal);
    request.then(data => { if (!abort.signal.aborted) setState({ key, data }); })
      .catch(e => { if (!abort.signal.aborted) setState({ key, error: e.message }); });
    return () => abort.abort();
  }, [base, path, refresh, paged, key]);
  return state.key === key ? state : { key };
}

export const usd = (value: number | null) => value === null ? "Not reported" :
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });
