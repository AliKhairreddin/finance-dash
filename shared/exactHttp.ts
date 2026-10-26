import { readBoundedResponseJson } from "./boundedHttp";
import { exactOrigin } from "./exact";

export class ExactHttpError extends Error {
  constructor(message: string, public status: number, public delay = 60_000) { super(message); }
}
export function exactRateDelay(headers: Headers, now = Date.now()): number {
  const retry = headers.get("Retry-After");
  let delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - now)) : 0;
  for (const name of ["X-RateLimit", "X-RateLimit-Minutely"]) {
    if (headers.get(`${name}-Remaining`) === "0") {
      const raw = Number(headers.get(`${name}-Reset`));
      if (raw > 0) delay = Math.max(delay, (raw > 1e12 ? raw : raw * 1000) - now + 1000);
    }
  }
  return Number.isFinite(delay) ? Math.max(1300, delay) : 60_000;
}
export async function exactHttp(url: string, accessToken: string | null, init: RequestInit = {}): Promise<{ value: unknown; delay: number }> {
  const parsed = new URL(url);
  if (parsed.origin !== exactOrigin || !parsed.pathname.startsWith("/api/") || parsed.username || parsed.password) throw new Error("Invalid Exact API destination");
  const headers = new Headers(init.headers); headers.set("Accept", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
  const delay = exactRateDelay(response.headers);
  if (!response.ok) {
    // Provider response bodies can contain credentials and accounting data. Never log or expose them.
    await response.body?.cancel();
    const message = response.status === 401 ? "Exact authorization expired; reconnect Exact" : response.status === 403 ? "Exact denied access to this company or operation" : response.status === 429 ? "Exact rate limit reached; synchronization will resume after its reset" : response.status >= 500 ? "Exact is temporarily unavailable" : `Exact rejected the request (${response.status}). Check the selected company, fields and permissions.`;
    throw new ExactHttpError(message, response.status, response.status === 429 ? Math.max(60_000, delay) : delay);
  }
  return { value: response.status === 204 ? null : await readBoundedResponseJson<unknown>(response, "Exact", 4 * 1024 * 1024 + 65536), delay };
}
export async function exactEncrypt(value: string, secret: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Exact credential encryption is not configured");
  const bytes = Uint8Array.from(secret.match(/../g)!, h => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("statements-exact-v1") }, key, new TextEncoder().encode(value)));
  return `${Array.from(iv, x => x.toString(16).padStart(2, "0")).join("")}.${Array.from(encrypted, x => x.toString(16).padStart(2, "0")).join("")}`;
}
export async function exactDecrypt(value: string, secret: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(secret) || !/^[a-f0-9]{24}\.[a-f0-9]+$/.test(value)) throw new Error("Exact credential encryption is unavailable");
  const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!, h => parseInt(h, 16));
  const [nonce, encrypted] = value.split(".");
  const key = await crypto.subtle.importKey("raw", fromHex(secret), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(nonce), additionalData: new TextEncoder().encode("statements-exact-v1") }, key, fromHex(encrypted)));
}
