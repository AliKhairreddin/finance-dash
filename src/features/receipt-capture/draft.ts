import { PDFDocument } from "pdf-lib";

export type ReceiptDraft = { id: "pending"; photo: Blob; pdf: Blob };

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

export async function photograph(video: HTMLVideoElement): Promise<ReceiptDraft> {
  if (!video.videoWidth || !video.videoHeight) throw new Error("Wait for the camera to be ready.");
  const scale = Math.min(1, 3200 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The photo could not be captured. Try again.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const photo = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The photo could not be captured.")), "image/jpeg", 0.94));
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedJpg(await photo.arrayBuffer());
  const page = pdf.addPage([canvas.width * 0.24, canvas.height * 0.24]);
  page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  const draft: ReceiptDraft = { id: "pending", photo, pdf: new Blob([new Uint8Array(await pdf.save())], { type: "application/pdf" }) };
  if (draft.pdf.size > 15 * 1024 * 1024) throw new Error("The photo is too large. Retake it with the receipt closer.");
  // Save exactly the same PDF for every retry, including after an app restart.
  await receiptDraft(draft);
  return draft;
}
