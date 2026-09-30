import { boundedBytes } from "./documentIntake";
import { slashWebhookSigningKeys } from "./slashWebhookKeys";

export interface SlashCardWebhookEvent { event: string; eventId: string; entityId: string; eventTimestamp: string }

export function parseSlashCardWebhookEvent(value: unknown): SlashCardWebhookEvent {
  if (!value || typeof value !== "object") throw new Error("Invalid Slash webhook event");
  const field = (name: string, max = 500) => {
    const entry = Reflect.get(value, name);
    if (typeof entry !== "string" || !entry.trim() || entry.length > max) throw new Error(`Invalid Slash webhook ${name}`);
    return entry;
  };
  const eventTimestamp = field("eventTimestamp", 64);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(eventTimestamp) || !Number.isFinite(Date.parse(eventTimestamp))) throw new Error("Invalid Slash webhook timestamp");
  return { event: field("event", 100), eventId: field("eventId"), entityId: field("entityId"), eventTimestamp };
}

export async function verifySlashWebhookSignature(body: Uint8Array<ArrayBuffer>, signature: string | null,
  keys: readonly string[] = slashWebhookSigningKeys): Promise<boolean> {
  if (!signature || signature.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(signature)) return false;
  try {
    const bytes = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0));
    const results = await Promise.all(keys.map(async (pem) => {
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/gu, "")), (char) => char.charCodeAt(0));
      const key = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes, body);
    }));
    return results.some(Boolean);
  } catch { return false; }
}

export async function handleSlashCardWebhook(request: Request, env: Pick<WorkerEnv, "SLASH_CARD_ALERTS">): Promise<Response> {
  if (request.method !== "POST") return Response.json({ message: "Method not allowed" }, { status: 405 });
  if (Number(request.headers.get("Content-Length")) > 8192) return Response.json({ message: "Event too large" }, { status: 413 });
  let body: Uint8Array<ArrayBuffer>;
  try { body = new Uint8Array(await boundedBytes(request.body, 8192)); }
  catch { return Response.json({ message: "Event too large" }, { status: 413 }); }
  if (!await verifySlashWebhookSignature(body, request.headers.get("slash-webhook-signature"))) return Response.json({ message: "Unauthorized" }, { status: 401 });
  let event: SlashCardWebhookEvent;
  try { event = parseSlashCardWebhookEvent(JSON.parse(new TextDecoder().decode(body))); }
  catch { return Response.json({ message: "Invalid event" }, { status: 400 }); }
  if (!["aggregated_transaction.create", "aggregated_transaction.update"].includes(event.event)) return Response.json({ ok: true });
  try {
    await env.SLASH_CARD_ALERTS.getByName(`event:${event.eventId}`).receive(event);
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    console.error(JSON.stringify({ event: "slash_card_webhook_enqueue_failed", eventId: event.eventId, error: error instanceof Error ? error.message : "Queue failed" }));
    return Response.json({ message: "Event could not be saved" }, { status: 503 });
  }
}
