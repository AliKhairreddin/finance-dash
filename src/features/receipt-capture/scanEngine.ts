import cv from "@techstark/opencv-js";
import { cornerArea, orderCorners, scanSize, validCorners, type ScanCorners } from "./scanGeometry";

// Do not await the module itself: this OpenCV build is a self-resolving thenable.
export const scannerReady = new Promise<void>(resolve => {
  if (cv.Mat) resolve();
  else cv.onRuntimeInitialized = () => resolve();
});

export type ScanPixels = { data: Uint8ClampedArray; width: number; height: number };

/** Work on a small copy. Canny finds boundaries; Otsu also handles faint edges. */
export function detectReceipt(pixels: ScanPixels): ScanCorners | null {
  const source = cv.matFromImageData(pixels as ImageData), small = new cv.Mat(), gray = new cv.Mat(), smooth = new cv.Mat();
  const edges = new cv.Mat(), threshold = new cv.Mat(), hierarchy = new cv.Mat(), contours = new cv.MatVector();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  let best: ScanCorners | null = null, bestArea = 0;
  try {
    const scale = Math.min(1, 640 / Math.max(pixels.width, pixels.height));
    const width = Math.max(2, Math.round(pixels.width * scale)), height = Math.max(2, Math.round(pixels.height * scale));
    cv.resize(source, small, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, smooth, new cv.Size(5, 5), 0);
    cv.Canny(smooth, edges, 40, 120);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.threshold(smooth, threshold, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.morphologyEx(threshold, threshold, cv.MORPH_CLOSE, kernel);
    for (const mask of [edges, threshold]) {
      cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i), polygon = new cv.Mat();
        try {
          if (cv.contourArea(contour) < width * height * 0.04) continue;
          cv.approxPolyDP(contour, polygon, cv.arcLength(contour, true) * 0.02, true);
          if (polygon.rows !== 4 || !cv.isContourConvex(polygon)) continue;
          const corners = orderCorners(Array.from({ length: 4 }, (_, j) => ({ x: polygon.data32S[j * 2] / (width - 1), y: polygon.data32S[j * 2 + 1] / (height - 1) })));
          const area = cornerArea(corners);
          // A document cut off by the image boundary is not a complete scan.
          if (area <= bestArea || area > 0.94 || !validCorners(corners) || corners.some(p => p.x < 0.007 || p.x > 0.993 || p.y < 0.007 || p.y > 0.993)) continue;
          const lengths = corners.map((p, j) => Math.hypot((p.x - corners[(j + 1) % 4].x) * width, (p.y - corners[(j + 1) % 4].y) * height));
          if (Math.max(...lengths) / Math.min(...lengths) > 14) continue;
          best = corners; bestArea = area;
        } finally { contour.delete(); polygon.delete(); }
      }
    }
    return best;
  } finally { source.delete(); small.delete(); gray.delete(); smooth.delete(); edges.delete(); threshold.delete(); hierarchy.delete(); contours.delete(); kernel.delete(); }
}

/** Rectify the original pixels; never generate or replace receipt text. */
export function straightenReceipt(pixels: ScanPixels, corners: ScanCorners): ScanPixels {
  const size = scanSize(corners, pixels.width, pixels.height);
  const source = cv.matFromImageData(pixels as ImageData), output = new cv.Mat();
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flatMap(p => [p.x * (pixels.width - 1), p.y * (pixels.height - 1)]));
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, size.width - 1, 0, size.width - 1, size.height - 1, 0, size.height - 1]);
  const transform = cv.getPerspectiveTransform(from, to);
  try {
    cv.warpPerspective(source, output, transform, new cv.Size(size.width, size.height), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    return { ...size, data: new Uint8ClampedArray(output.data) };
  } finally { source.delete(); output.delete(); from.delete(); to.delete(); transform.delete(); }
}
