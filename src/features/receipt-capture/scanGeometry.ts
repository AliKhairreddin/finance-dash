export type ScanPoint = { x: number; y: number };
/** Clockwise from top-left; coordinates are fractions of the original image. */
export type ScanCorners = [ScanPoint, ScanPoint, ScanPoint, ScanPoint];

export const fullImageCorners = (): ScanCorners => [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export function cornerArea(points: ScanCorners): number {
  return points.reduce((sum, p, i) => {
    const next = points[(i + 1) % 4];
    return sum + p.x * next.y - p.y * next.x;
  }, 0) / 2;
}

export function validCorners(points: ScanCorners): boolean {
  if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  if (cornerArea(points) < 0.015) return false;
  return points.every((p, i) => {
    const q = points[(i + 1) % 4], r = points[(i + 2) % 4];
    return Math.hypot(q.x - p.x, q.y - p.y) >= 0.025 && (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x) > 0.0001;
  });
}

export function orderCorners(points: ScanPoint[]): ScanCorners {
  const center = { x: points.reduce((s, p) => s + p.x, 0) / 4, y: points.reduce((s, p) => s + p.y, 0) / 4 };
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  const first = sorted.reduce((best, p, i) => p.x + p.y < sorted[best].x + sorted[best].y ? i : best, 0);
  return [...sorted.slice(first), ...sorted.slice(0, first)] as ScanCorners;
}

export function scanSize(corners: ScanCorners, width: number, height: number) {
  if (!validCorners(corners)) throw new Error("Place the four corners around the receipt without crossing the edges.");
  const distance = (a: ScanPoint, b: ScanPoint) => Math.hypot((a.x - b.x) * (width - 1), (a.y - b.y) * (height - 1));
  const w = Math.max(distance(corners[0], corners[1]), distance(corners[3], corners[2]));
  const h = Math.max(distance(corners[0], corners[3]), distance(corners[1], corners[2]));
  const scale = Math.min(1, 3200 / Math.max(w, h));
  return { width: Math.max(2, Math.round(w * scale)), height: Math.max(2, Math.round(h * scale)) };
}
