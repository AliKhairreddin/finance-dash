import { ConvexHttpClient } from "convex/browser";
import { PDFDocument } from "pdf-lib";
import { api } from "../convex/_generated/api";
import type { DashboardSession } from "../shared/types";
import { normalizeStatementActor } from "../shared/statements";
import { boundedBytes } from "./documentIntake";
import { ingestPdf, statementHash } from "./statements";

export const receiptCaptureHostname = "receipts.thatcanadian.dev";
const json = (value: unknown, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...headers } });
export async function handleCaptureDevice(request: Request, env: WorkerEnv, session: DashboardSession): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/statements/capture-device") return null;
  const client = new ConvexHttpClient(env.CONVEX_URL), auth = { serviceToken: env.CONVEX_SERVICE_TOKEN, actor: session.username };
  if (request.method !== "GET" && request.headers.get("Origin") !== new URL(request.url).origin) return json({ message: "Open this action from Statements" }, 403);
  try {
    if (request.method === "GET") return json(await client.query(api.statementCapture.status, auth));
    if (request.method === "DELETE") { await client.mutation(api.statementCapture.disconnect, auth); return json({ active: false }); }
    if (request.method === "POST") {
      const key = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
      await client.mutation(api.statementCapture.connect, { ...auth, tokenHash: await statementHash(new TextEncoder().encode(key)) });
      // A fragment never reaches HTTP access logs or Referer headers.
      return json({ setupUrl: `https://${receiptCaptureHostname}/#connect=${key}` }, 201);
    }
    return json({ message: "Method not allowed" }, 405);
  } catch { return json({ message: "Could not update the phone connection. Check your access and reload before trying again." }, 400); }
}

// A dedicated public host: no dashboard pages, sessions, files or finance APIs.
export async function routeReceiptCapture(request: Request, env: WorkerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.hostname !== receiptCaptureHostname) return null;
  if (url.pathname === "/api/capture" && request.method === "POST") {
    if (request.headers.get("Origin") !== url.origin) return json({ message: "Send from the Receipts app" }, 403);
    const key = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") ?? "")?.[1];
    if (!key) return json({ message: "Open your phone setup link once to enable sending." }, 401);
    if (request.headers.get("Content-Type") !== "application/pdf") return json({ message: "Take a receipt photo first." }, 415);
    try {
      const client = new ConvexHttpClient(env.CONVEX_URL);
      const accepted = await client.mutation(api.statementCapture.acceptUpload, { serviceToken: env.CONVEX_SERVICE_TOKEN, tokenHash: await statementHash(new TextEncoder().encode(key)) });
      if (!accepted.actor) return accepted.retryAfter
        ? json({ message: "Upload limit reached. Your photo is still on this phone; try again later." }, 429, { "Retry-After": String(accepted.retryAfter) })
        : json({ message: "This phone is disconnected. Open a new setup link to reconnect." }, 401);
      const bytes = await boundedBytes(request.body, 15 * 1024 * 1024);
      if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return json({ message: "The receipt file is invalid. Retake the photo." }, 400);
      const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
      if (pdf.getPageCount() !== 1) return json({ message: "Send one receipt photo at a time." }, 400);
      const result = await ingestPdf(env, { bytes, name: "receipt-photo.pdf", origin: "file", actor: normalizeStatementActor(accepted.actor), quarantined: false, sourceContext: "Receipt photograph submitted from the upload-only mobile capture app. Review OCR against the original photograph." });
      return json({ saved: true, duplicate: result.duplicate }, 202);
    } catch { return json({ message: "Delivery was not confirmed. Your photo is still on this phone. Try Send again; duplicates are detected." }, 502); }
  }
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  const publicAsset = url.pathname.startsWith("/assets/") || ["/receipt-capture.webmanifest", "/receipt-icons/camera-receipt-v1.svg", "/receipt-icons/camera-receipt-180-v1.png", "/receipt-icons/camera-receipt-192-v1.png", "/receipt-icons/camera-receipt-512-v1.png"].includes(url.pathname);
  if (url.pathname !== "/" && !publicAsset) return json({ message: "Not found" }, 404);
  // Cloudflare canonicalizes .html URLs with a redirect. Fetch the clean asset
  // path internally so the public app stays at its manifest start URL, /.
  const response = await env.ASSETS.fetch(url.pathname === "/" ? new Request(new URL("/receipt-capture", url), request) : request);
  const headers = new Headers(response.headers);
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (url.pathname === "/") headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
