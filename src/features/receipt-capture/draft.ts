import { PDFDocument } from "pdf-lib";
import { fullImageCorners, type ScanCorners } from "./scanGeometry";
import type { ScanPixels } from "./scanEngine";
import { drawCameraFrame } from "./zoom";

export type ReceiptDraft = { id: "pending"; photo: Blob; pdf: Blob; scan?: { original: Blob; width: number; height: number; corners: ScanCorners; confirmed: boolean; detected: boolean } };

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("receipt-camera", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Phone storage is unavailable. Enable website storage and try again."));
  });
}
export async function receiptDraft(value?: ReceiptDraft | null): Promise<ReceiptDraft | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("drafts", value === undefined ? "readonly" : "readwrite");
      const store = transaction.objectStore("drafts");
      const request = value === undefined ? store.get("pending") : value === null ? store.delete("pending") : store.put(value);
      transaction.oncomplete = () => resolve(value === undefined ? request.result as ReceiptDraft | undefined : value ?? undefined);
      transaction.onerror = transaction.onabort = () => reject(new Error("The photo could not be saved on this phone. Check available storage."));
    });
  } finally { db.close(); }
}

async function canvasDraft(canvas: HTMLCanvasElement): Promise<ReceiptDraft> {
  const photo = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The scan could not be saved.")), "image/jpeg", 0.94));
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(await photo.arrayBuffer());
  const page = pdf.addPage([canvas.width * 0.24, canvas.height * 0.24]);
  page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  const draft: ReceiptDraft = { id: "pending", photo, pdf: new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" }) };
  if (draft.pdf.size > 15 * 1024 * 1024) throw new Error("The scan is too large. Retake it with the receipt closer.");
  return draft;
}

export async function photograph(video: HTMLVideoElement, zoom = 1): Promise<ReceiptDraft> {
  const canvas = drawCameraFrame(video, zoom, 3200);
  const draft = await canvasDraft(canvas);
  draft.scan = { original: draft.photo, width: canvas.width, height: canvas.height, corners: fullImageCorners(), confirmed: false, detected: false };
  // Persist the original before detection/cropping so an interruption loses nothing.
  await receiptDraft(draft);
  return draft;
}

export async function saveScan(draft: ReceiptDraft, pixels: ScanPixels, corners: ScanCorners): Promise<ReceiptDraft> {
  if (!draft.scan) throw new Error("Retake this receipt to scan it.");
  const canvas = document.createElement("canvas"); canvas.width = pixels.width; canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The scan could not be saved. Try again.");
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  const next = { ...await canvasDraft(canvas), scan: { ...draft.scan, corners, confirmed: true } };
  // Every Send retry reuses this exact PDF, including after an app restart.
  await receiptDraft(next);
  return next;
}
