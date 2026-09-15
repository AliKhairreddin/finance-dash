import { DurableObject } from "cloudflare:workers";
import { prepareTelegramReply, sendTelegramMessage, sendTelegramDocument, telegramUpdate, downloadTelegramAttachment, type TelegramUpdate, type TelegramPrivateMessage, type TelegramAuthUser } from "./telegram";
import { handleTelegramCommand } from "./handler";
import { financeTelegramCommands } from "./telegramCommandCatalog";
import { ingestDocument } from "./documentIntake";
import { amexStatementHint, stageAmexStatement, telegramAmexOptions } from "./amexStatements";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

export interface TelegramConversationTurn { question: string; answer: string; at: number }
type PreparedReply = NonNullable<Awaited<ReturnType<typeof prepareTelegramReply>>>;
type QueuedUpdate = { update: TelegramUpdate; attempts: number; started?: boolean };
type StoredReply = { chatId: string; protectContent: boolean; messages: string[]; delivered: number; document?: { fileName: string; contentType: string; caption?: string; chunks: number } };

export async function ingestTelegramDocument(env: WorkerEnv, user: TelegramAuthUser, message: TelegramPrivateMessage): Promise<string> {
  const file = message.attachment!;
  try {
    const caption = message.caption ?? "";
    const bytes = new Uint8Array(await downloadTelegramAttachment(env, file));
    const explicitAmex = amexStatementHint(file.fileName, caption);
    const pdf = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
    if (explicitAmex || pdf || /\.csv$/i.test(file.fileName)) {
      const statement = await stageAmexStatement(env, { bytes, fileName: file.fileName, source: "telegram" }, telegramAmexOptions(caption), pdf ? !/^\/amex\b/i.test(caption.trim()) : !explicitAmex);
      if (statement) {
        const convex = new ConvexHttpClient(env.CONVEX_URL), serviceToken = env.CONVEX_SERVICE_TOKEN;
        const detail = await convex.query(api.amexStatements.get, { serviceToken, id: statement.id });
        if (!detail) throw new Error("Statement could not be read");
        const link = new URL(`/?page=banks&bankView=amex&amexStatement=${statement.id}`, env.PUBLIC_APP_URL);
        if (detail.record.reviewReasons.length && ["ready", "failed"].includes(detail.record.status)) return `Amex statement saved for review: ${file.fileName}\n\n${detail.record.reviewReasons.join("\n")}\n\n${link}`;
        if (detail.record.status === "imported") return `Already imported: ${file.fileName}\n${detail.record.inserted} new transactions · ${detail.record.duplicates} duplicates\n\n${link}`;
        await convex.mutation(api.amexStatements.start, { serviceToken, id: statement.id, reviewed: false });
        return `Amex import queued: ${file.fileName}\n${detail.record.transactionCount} transactions · ${detail.record.currency} · card •${detail.record.cardLastFour}\n\nClassification runs automatically. View progress and duplicate counts:\n${link}`;
      }
    }
    const entity = /\bdigital nudge\b|\bdn\b/i.test(caption) ? "dn" : /\blove me do\b|\blmd\b/i.test(caption) ? "lmd" : undefined;
    const result = await ingestDocument(env, { bytes, fileName: file.fileName, contentType: file.contentType, source: "telegram", sourceContext: caption, sender: user.username, intakeKey: `telegram:${file.uniqueId}`, entity });
    return `${result.duplicate ? "Already saved" : "Saved and processing"}: ${file.fileName}\n\n${new URL(`/?page=documents&documentSearch=${encodeURIComponent(file.fileName)}`, env.PUBLIC_APP_URL)}\n\nMatching will leave payment confirmation for review.`;
  } catch (error) { return `Couldn’t process the document: ${error instanceof Error ? error.message : "Upload failed"}`; }
}

// One inbox per chat: Ali's slow request cannot delay Ali M or a sign-in code.
export class TelegramInbox extends DurableObject<WorkerEnv> {
  private work: Promise<void> = Promise.resolve();
  private serialize<T>(run: () => Promise<T>): Promise<T> { const result = this.work.then(run, run); this.work = result.then(() => undefined, () => undefined); return result; }
  async receive(value: unknown): Promise<void> {
    const update = telegramUpdate(value);
    if (!update.message) return;
    await this.serialize(async () => {
      const done = await this.ctx.storage.get<number[]>("done") ?? [];
      const queue = await this.ctx.storage.get<QueuedUpdate[]>("queue") ?? [];
      if (done.includes(update.updateId) || queue.some(item => item.update.updateId === update.updateId)) return;
      if (queue.length >= 50) throw new Error("Chat queue is full");
      await this.ctx.storage.put("queue", [...queue, { update, attempts: 0 }]);
      await this.ctx.storage.setAlarm(Date.now() + 1);
    });
  }
  async history(): Promise<TelegramConversationTurn[]> { return (await this.ctx.storage.get<TelegramConversationTurn[]>("history") ?? []).filter(turn => turn.at > Date.now() - 24 * 3600_000).slice(-6); }
  async remember(question: string, answer: string): Promise<void> { const history = await this.history(); await this.ctx.storage.put("history", [...history, { question: question.slice(0, 4096), answer: answer.slice(0, 6000), at: Date.now() }].slice(-6)); }
  private async saveReply(key: string, prepared: PreparedReply): Promise<StoredReply> {
    const reply = prepared.reply;
    const result: StoredReply = { chatId: prepared.chatId, protectContent: prepared.protectContent, delivered: 0,
      messages: typeof reply === "string" ? [reply] : "messages" in reply ? reply.messages : reply.text ? [reply.text] : [] };
    if (typeof reply !== "string" && "document" in reply) {
      const { bytes, ...metadata } = reply.document;
      const chunks = Math.ceil(bytes.byteLength / 262144);
      for (let i = 0; i < chunks; i++) await this.ctx.storage.put(`${key}:file:${i}`, bytes.slice(i * 262144, (i + 1) * 262144));
      result.document = { ...metadata, chunks };
    }
    await this.ctx.storage.put(key, result); return result;
  }
  async alarm(): Promise<void> {
    const queue = await this.ctx.storage.get<QueuedUpdate[]>("queue") ?? [];
    const item = queue[0]; if (!item) return;
    const key = `reply:${item.update.updateId}`;
    // Persist the action result before sending; a delivery retry never reexecutes an action.
    await this.ctx.storage.setAlarm(Date.now() + 150_000);
    try {
      let prepared = await this.ctx.storage.get<StoredReply>(key);
      if (!prepared) {
        const command = item.update.message?.text?.trim().split(/\s/)[0].replace(/^\//, "").split("@")[0];
        const action = financeTelegramCommands.some(c => c.command === command && c.access === "action");
        await this.serialize(async () => {
          const current = await this.ctx.storage.get<QueuedUpdate[]>("queue") ?? [];
          await this.ctx.storage.put("queue", current.map(row => row.update.updateId === item.update.updateId ? { ...row, started: true, attempts: row.attempts + 1 } : row));
        });
        const result = item.started && action ? { chatId: item.update.message!.chatId, protectContent: true, reply: "The previous action was interrupted. Please check its result in the dashboard before requesting it again." }
          : item.attempts >= 3 ? { chatId: item.update.message!.chatId, protectContent: true, reply: "I couldn’t complete that request. Please try again." }
          : await prepareTelegramReply(this.env, item.update, { handleCommand: handleTelegramCommand, handleAttachment: ingestTelegramDocument });
        if (result) prepared = await this.saveReply(key, result);
      }
      if (prepared) {
        for (let i = prepared.delivered; i < prepared.messages.length; i++) {
          await sendTelegramMessage(this.env, prepared.chatId, prepared.messages[i], prepared.protectContent);
          prepared.delivered = i + 1; await this.ctx.storage.put(key, prepared);
        }
        if (prepared.document) {
          const chunks = []; let size = 0;
          for (let i = 0; i < prepared.document.chunks; i++) { const chunk = await this.ctx.storage.get<ArrayBuffer>(`${key}:file:${i}`); if (!chunk) throw new Error("Telegram attachment is unavailable"); chunks.push(chunk); size += chunk.byteLength; }
          const bytes = new Uint8Array(size); let offset = 0;
          for (const chunk of chunks) { bytes.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
          await sendTelegramDocument(this.env, prepared.chatId, { ...prepared.document, bytes: bytes.buffer }, prepared.protectContent);
        }
      }
      await this.serialize(async () => {
        const current = await this.ctx.storage.get<QueuedUpdate[]>("queue") ?? [];
        await this.ctx.storage.put("queue", current.filter(row => row.update.updateId !== item.update.updateId));
        await this.ctx.storage.put("done", [...(await this.ctx.storage.get<number[]>("done") ?? []), item.update.updateId].slice(-500));
        await this.ctx.storage.delete(key);
        if (prepared?.document) for (let i = 0; i < prepared.document.chunks; i++) await this.ctx.storage.delete(`${key}:file:${i}`);
        if (current.length > 1) await this.ctx.storage.setAlarm(Date.now() + 1); else await this.ctx.storage.deleteAlarm();
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "telegram_inbox_failed", updateId: item.update.updateId, error: error instanceof Error ? error.message : String(error) }));
      throw error;
    }
  }
}
