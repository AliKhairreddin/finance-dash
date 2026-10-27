import type { ScanCorners } from "./scanGeometry";
import type { ScanPixels } from "./scanEngine";
import { drawCameraFrame } from "./zoom";

type ScanReply = { ready?: boolean; id: number; corners: ScanCorners | null; pixels: ScanPixels; error?: string };

export class ReceiptScanner {
  private worker = new Worker(new URL("./receipt-scanner.ts", import.meta.url), { type: "module" });
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: ScanReply) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private failed = false;
  private initialization?: { timeout: ReturnType<typeof setTimeout>; reject: (error: Error) => void };
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error("Scanner could not load. Check your connection and reload.")); this.close(); }, 45_000);
      this.initialization = { timeout, reject };
      this.worker.onmessage = (event: MessageEvent<ScanReply>) => {
        if (event.data.ready) { clearTimeout(timeout); this.initialization = undefined; resolve(); return; }
        const call = this.pending.get(event.data.id);
        if (!call) return;
        clearTimeout(call.timeout); this.pending.delete(event.data.id);
        if (event.data.error) call.reject(new Error(event.data.error)); else call.resolve(event.data);
      };
      this.worker.onerror = () => {
        clearTimeout(timeout); reject(new Error("Scanner could not load. Reload to try again.")); this.close();
      };
    });
  }
  private async request(kind: "detect" | "straighten", pixels: ScanPixels, corners?: ScanCorners): Promise<ScanReply> {
    await this.ready;
    if (this.failed) throw new Error("Scanner stopped. Reload to try again. Your unsent receipt is saved.");
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => this.close(), 20_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, kind, pixels, corners }, [pixels.data.buffer]);
    });
  }
  async detect(pixels: ScanPixels) { return (await this.request("detect", pixels)).corners; }
  async straighten(pixels: ScanPixels, corners: ScanCorners) { return (await this.request("straighten", pixels, corners)).pixels; }
  close() {
    this.failed = true; this.worker.terminate();
    if (this.initialization) { clearTimeout(this.initialization.timeout); this.initialization.reject(new Error("Scanner closed.")); this.initialization = undefined; }
    for (const call of this.pending.values()) { clearTimeout(call.timeout); call.reject(new Error("Scanner stopped. Reload to try again. Your unsent receipt is saved.")); }
    this.pending.clear();
  }
}

export function cameraPixels(video: HTMLVideoElement, zoom = 1): ImageData {
  const canvas = drawCameraFrame(video, zoom, 640);
  const context = canvas.getContext("2d")!;
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function photoPixels(photo: Blob): Promise<ImageData> {
  const url = URL.createObjectURL(photo), image = new Image();
  try {
    image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { URL.revokeObjectURL(url); }
}
