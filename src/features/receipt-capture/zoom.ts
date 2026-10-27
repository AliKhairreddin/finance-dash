export const minCameraZoom = 1;
export const maxCameraZoom = 3;

export function clampCameraZoom(value: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(maxCameraZoom, Math.max(minCameraZoom, value)) * 100) / 100 : minCameraZoom;
}

/** One centered crop for the preview, edge detector and saved photograph. */
export function cameraFrame(width: number, height: number, zoom: number, maxSize: number) {
  if (!(width > 0 && height > 0 && maxSize > 0)) throw new Error("Wait for the camera to be ready.");
  const sourceWidth = width / clampCameraZoom(zoom), sourceHeight = height / clampCameraZoom(zoom);
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  return {
    x: (width - sourceWidth) / 2, y: (height - sourceHeight) / 2, sourceWidth, sourceHeight,
    width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale))
  };
}

export function drawCameraFrame(video: HTMLVideoElement, zoom: number, maxSize: number): HTMLCanvasElement {
  const frame = cameraFrame(video.videoWidth, video.videoHeight, zoom, maxSize);
  const canvas = document.createElement("canvas"); canvas.width = frame.width; canvas.height = frame.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The photo could not be captured. Try again.");
  context.drawImage(video, frame.x, frame.y, frame.sourceWidth, frame.sourceHeight, 0, 0, frame.width, frame.height);
  return canvas;
}

export function fitCameraFrame(width: number, height: number, availableWidth: number, availableHeight: number) {
  const scale = width && height ? Math.min(availableWidth / width, availableHeight / height) : 0;
  const w = scale ? width * scale : availableWidth, h = scale ? height * scale : availableHeight;
  return { left: (availableWidth - w) / 2, top: (availableHeight - h) / 2, width: w, height: h };
}

type TouchPosition = { clientX: number; clientY: number };
export class CameraPinch {
  private start: { distance: number; zoom: number } | null = null;
  reset() { this.start = null; }
  update(touches: TouchPosition[], zoom: number): number {
    if (touches.length !== 2) { this.reset(); return zoom; }
    const distance = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
    if (distance < 1) { this.reset(); return zoom; }
    if (!this.start) this.start = { distance, zoom };
    return clampCameraZoom(this.start.zoom * distance / this.start.distance);
  }
}
