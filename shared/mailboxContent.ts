import PostalMime from "postal-mime";
import { PDFDocument, StandardFonts } from "pdf-lib";
const receiptWords = /\b(invoice|receipt|factuur|facture|rechnung|kwitantie|payment confirmation|order confirmation|purchase confirmation|payment received|betaling|bestelling)\b/i;
export type MailboxFile = { bytes: Uint8Array<ArrayBuffer>; name: string; hash: string };
const hash = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), x => x.toString(16).padStart(2, "0")).join("");
const cleanName = (value: string) => value.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 230);
export async function mailboxContent(raw: Uint8Array<ArrayBuffer>) {
  const parsed = await PostalMime.parse(raw);
  const subject = (parsed.subject ?? "").slice(0, 500), sender = (parsed.from?.address ?? "").slice(0, 254);
  const text = parsed.text ?? (parsed.html ?? "").replace(/<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
  const context = `From: ${sender}\nSubject: ${subject}\n${text}`.slice(0, 12000), files: MailboxFile[] = [], issues: string[] = [];
  const likely = receiptWords.test(`${subject}\n${text.slice(0, 20000)}`);
  for (const attachment of parsed.attachments) {
    const bytes = new Uint8Array(attachment.content as ArrayBuffer), name = cleanName(attachment.filename ?? "attachment");
    const pdf = new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-", image = /image\/(jpeg|png)/i.test(attachment.mimeType);
    if (!pdf && !(image && (likely || receiptWords.test(name)) && attachment.disposition !== "inline")) continue;
    if (files.length >= 10 || bytes.length > 15 * 1024 * 1024) { issues.push("Some attachments exceed the limit of 10 documents per email or 15 MB per document."); continue; }
    if (pdf) files.push({ bytes, name: /\.pdf$/i.test(name) ? name : `${name}.pdf`, hash: await hash(bytes) });
    else {
      try {
        const doc = await PDFDocument.create(); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
        const embedded = /png/i.test(attachment.mimeType) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const scale = Math.min(1, 1400 / Math.max(embedded.width, embedded.height)), size = { width: embedded.width * scale, height: embedded.height * scale };
        const page = doc.addPage([size.width, size.height]); page.drawImage(embedded, { x: 0, y: 0, ...size });
        const converted = new Uint8Array(await doc.save()); if (converted.length > 15 * 1024 * 1024) throw new Error();
        files.push({ bytes: converted, name: `${name.replace(/\.[^.]+$/, "")}.pdf`, hash: await hash(converted) });
      } catch { issues.push(`Could not convert image attachment ${name}. Upload it manually.`); }
    }
  }
  // Body-only receipts become a text PDF; no remote URLs or HTML scripts execute.
  // The excerpt is also retained for the existing document extraction pipeline.
  if (!files.length && likely && text.trim()) {
    if (text.length > 60000 || /[^\u0000-\u00ff\u2000-\u206f\u20ac]/u.test(`${subject}${text}`)) issues.push("This body-only email needs manual import because its length or characters exceed the text PDF renderer.");
    else {
      const doc = await PDFDocument.create(); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
      const font = await doc.embedFont(StandardFonts.Helvetica);
      // Keep all printable WinAnsi characters and replace typographic spacing.
      const printable = (s: string) => [...s].map(c => { try { font.encodeText(c); return c; } catch { return /\s/.test(c) ? " " : "?"; } }).join("");
      const lines: string[] = [];
      for (const paragraph of printable(`From: ${sender}\nSubject: ${subject}\n\n${text}`).split(/\r?\n/)) {
        let line = "";
        for (const character of paragraph) { if (font.widthOfTextAtSize(line + character, 10) > 510) { lines.push(line); line = ""; } line += character; }
        lines.push(line);
      }
      for (let offset = 0; offset < lines.length; offset += 50) { const page = doc.addPage([595, 842]); lines.slice(offset, offset + 50).forEach((line, i) => page.drawText(line, { x: 42, y: 795 - i * 15, font, size: 10 })); }
      const bytes = new Uint8Array(await doc.save()); files.push({ bytes, name: `${cleanName(subject || "Email receipt")}.pdf`, hash: await hash(bytes) });
    }
  }
  return { files, sender, subject, sourceContext: context, issue: issues.length ? [...new Set(issues)].join(" ").slice(0, 500) : undefined };
}
