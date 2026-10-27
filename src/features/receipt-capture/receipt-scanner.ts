import { detectReceipt, scannerReady, straightenReceipt, type ScanPixels } from "./scanEngine";
import type { ScanCorners } from "./scanGeometry";

type ScanRequest = { id: number; kind: "detect" | "straighten"; pixels: ScanPixels; corners: ScanCorners };
const scope = self as unknown as { onmessage: ((event: MessageEvent<ScanRequest>) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
void scannerReady.then(() => scope.postMessage({ ready: true }));
scope.onmessage = event => {
  void scannerReady.then(() => {
    const { id, kind, pixels, corners } = event.data;
    try {
      if (kind === "detect") scope.postMessage({ id, corners: detectReceipt(pixels) });
      else {
        const result = straightenReceipt(pixels, corners);
        scope.postMessage({ id, pixels: result }, [result.data.buffer]);
      }
    } catch { scope.postMessage({ id, error: "Could not process this scan. Adjust the corners or retake the receipt." }); }
  });
};
