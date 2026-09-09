import { DurableObject } from "cloudflare:workers";
import { partnerUpdateReportKinds, partnerUpdateSummary, type PartnerReportData, type PartnerUpdateStatus } from "../shared/partnerUpdates";
import { deliverPartnerImages, partnerRecipients, partnerSender } from "./partnerUpdateDelivery";
import { renderPartnerReport } from "./partnerUpdateReports";
import { sendTelegramImageAlbum, sendTelegramMessage, type TelegramAuthUser, type TelegramCommandDocument } from "./telegram";

const chunkSize = 64 * 1024;
interface StoredImage extends Omit<TelegramCommandDocument, "bytes"> { chunks: number }
interface UpdateJob {
  status: PartnerUpdateStatus;
  recipients: TelegramAuthUser[];
  sender: TelegramAuthUser;
  dataChunks: number;
  images: StoredImage[];
  renderAttempts: number;
  notified: boolean;
}

/** One durable job per explicitly requested update, shared by both trigger paths. */
export class PartnerUpdates extends DurableObject<WorkerEnv> {
  private work: Promise<void> = Promise.resolve();
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = this.work.then(run, run);
    this.work = result.then(() => undefined, () => undefined);
    return result;
  }
  private async storeBytes(key: string, bytes: ArrayBuffer): Promise<number> {
    const chunks = Math.ceil(bytes.byteLength / chunkSize);
    for (let index = 0; index < chunks; index++) await this.ctx.storage.put(`${key}:${index}`, bytes.slice(index * chunkSize, (index + 1) * chunkSize));
    return chunks;
  }
  private async readBytes(key: string, chunks: number): Promise<ArrayBuffer> {
    const parts: ArrayBuffer[] = [];
    for (let index = 0; index < chunks; index++) {
      const part = await this.ctx.storage.get<ArrayBuffer>(`${key}:${index}`);
      if (!part) throw new Error("Saved partner report is unavailable.");
      parts.push(part);
    }
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) { result.set(new Uint8Array(part), offset); offset += part.byteLength; }
    return result.buffer;
  }
  async start(id: string, username: string, data: PartnerReportData): Promise<PartnerUpdateStatus> {
    return this.serialize(() => this.startJob(id, username, data));
  }
  private async startJob(id: string, username: string, data: PartnerReportData): Promise<PartnerUpdateStatus> {
    const sender = partnerSender(this.env, username);
    const current = await this.ctx.storage.get<UpdateJob>("job");
    if (current) return current.status;
    const recipients = partnerRecipients(this.env);
    const job: UpdateJob = {
      status: { id, requestedBy: sender.username, createdAt: new Date().toISOString(), cashFlowDate: data.cashFlow.asOfDate,
        status: "queued", recipients: recipients.map(user => ({ name: user.username, status: "pending" })) },
      recipients, sender, dataChunks: await this.storeBytes("data", new TextEncoder().encode(JSON.stringify(data)).buffer),
      images: [], renderAttempts: 0, notified: false
    };
    await this.ctx.storage.put("job", job);
    await this.ctx.storage.setAlarm(Date.now() + 1);
    return job.status;
  }
  async status(): Promise<PartnerUpdateStatus | null> {
    return (await this.ctx.storage.get<UpdateJob>("job"))?.status ?? null;
  }
  async retry(username: string): Promise<PartnerUpdateStatus> {
    return this.serialize(() => this.retryJob(username));
  }
  private async retryJob(username: string): Promise<PartnerUpdateStatus> {
    partnerSender(this.env, username);
    const job = await this.ctx.storage.get<UpdateJob>("job");
    if (!job) throw new Error("Partner update was not found.");
    if (!["failed", "partial"].includes(job.status.status)) return job.status;
    if (job.status.status === "partial" && !job.status.recipients.some(recipient => recipient.status === "failed")) return job.status;
    job.status.recipients = job.status.recipients.map(recipient => recipient.status === "failed" ? { name: recipient.name, status: "pending" } : recipient);
    job.status.status = "queued";
    delete job.status.error;
    job.renderAttempts = 0;
    job.notified = false;
    await this.ctx.storage.put("job", job);
    await this.ctx.storage.setAlarm(Date.now() + 1);
    return job.status;
  }
  async alarm(): Promise<void> {
    return this.serialize(() => this.process());
  }
  private async process(): Promise<void> {
    const job = await this.ctx.storage.get<UpdateJob>("job");
    if (!job || ["complete", "partial", "failed"].includes(job.status.status)) return;
    // Watchdog resumes safe work if the instance is interrupted.
    await this.ctx.storage.setAlarm(Date.now() + 240_000);
    if (job.images.length < partnerUpdateReportKinds.length) {
      job.status.status = "preparing";
      job.renderAttempts += 1;
      await this.ctx.storage.put("job", job);
      try {
        const data = JSON.parse(new TextDecoder().decode(await this.readBytes("data", job.dataChunks))) as PartnerReportData;
        for (let index = job.images.length; index < partnerUpdateReportKinds.length; index++) {
          const { bytes, ...metadata } = await renderPartnerReport(this.env, data, partnerUpdateReportKinds[index]);
          job.images.push({ ...metadata, chunks: await this.storeBytes(`image:${index}`, bytes) });
          await this.ctx.storage.put("job", job);
        }
      } catch (error) {
        if (job.renderAttempts < 3) { await this.ctx.storage.setAlarm(Date.now() + 15_000); return; }
        job.status.status = "failed";
        job.status.error = error instanceof Error ? error.message : "Report images could not be prepared.";
        await this.ctx.storage.put("job", job);
        await this.notify(job);
        await this.ctx.storage.deleteAlarm();
        return;
      }
    }
    const images: TelegramCommandDocument[] = [];
    for (let index = 0; index < job.images.length; index++) images.push({ ...job.images[index], bytes: await this.readBytes(`image:${index}`, job.images[index].chunks) });
    job.status.status = "sending";
    await this.ctx.storage.put("job", job);
    await deliverPartnerImages(job.status, job.recipients, images,
      async status => { job.status = status; await this.ctx.storage.put("job", job); },
      (chatId, reports) => sendTelegramImageAlbum(this.env, chatId, reports));
    await this.notify(job);
    await this.ctx.storage.deleteAlarm();
  }
  private async notify(job: UpdateJob) {
    if (job.notified) return;
    job.notified = true;
    await this.ctx.storage.put("job", job);
    const link = new URL(`/?page=cash-flow&partnerUpdate=${encodeURIComponent(job.status.id)}`, this.env.PUBLIC_APP_URL);
    try { await sendTelegramMessage(this.env, job.sender.chatId, `${partnerUpdateSummary(job.status)}\n\n${link}`, true); }
    catch { console.error(JSON.stringify({ event: "partner_update_receipt_failed", id: job.status.id })); }
  }
}
