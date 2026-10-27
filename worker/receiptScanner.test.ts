import assert from "node:assert/strict";
import test from "node:test";
import { detectReceipt, scannerReady, straightenReceipt, type ScanPixels } from "../src/features/receipt-capture/scanEngine";
import { fullImageCorners, scanSize, validCorners, type ScanCorners } from "../src/features/receipt-capture/scanGeometry";

const receipt: ScanCorners = [{ x: .3, y: .1 }, { x: .72, y: .16 }, { x: .8, y: .86 }, { x: .18, y: .92 }];
function fixture(corners = receipt, background = 40, paper = 240): ScanPixels {
  const width = 400, height = 600, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = corners.every((p, i) => {
      const q = corners[(i + 1) % 4];
      return (q.x - p.x) * (y / (height - 1) - p.y) - (q.y - p.y) * (x / (width - 1) - p.x) >= 0;
    });
    // Text-like horizontal marks, surrounded by unprinted paper.
    const ink = inside && x > 155 && x < 255 && y > 150 && y < 450 && y % 36 < 4;
    const value = inside ? ink ? 35 : paper : background, offset = (y * width + x) * 4;
    data.set([value, value, value, 255], offset);
  }
  return { width, height, data };
}

test("scanner finds a perspective receipt including narrow receipts and faint edges", async () => {
  await scannerReady;
  const narrow: ScanCorners = [{ x: .42, y: .08 }, { x: .58, y: .1 }, { x: .62, y: .9 }, { x: .38, y: .92 }];
  for (const [corners, background] of [[receipt, 40], [receipt, 180], [narrow, 40]] as const) {
    const found = detectReceipt(fixture(corners, background));
    assert.ok(found);
    found.forEach((point, index) => {
      assert.ok(Math.hypot(point.x - corners[index].x, point.y - corners[index].y) < .025, JSON.stringify(found));
    });
  }
});

test("scanner does not invent a document on a blank frame or crop a cut-off sheet", async () => {
  await scannerReady;
  assert.equal(detectReceipt(fixture(fullImageCorners(), 240, 240)), null);
  assert.equal(detectReceipt(fixture([{ x: 0, y: 0 }, { x: .7, y: 0 }, { x: .75, y: 1 }, { x: 0, y: 1 }])), null);
});

test("perspective correction removes background, preserves ink, and leaves the original untouched", async () => {
  await scannerReady;
  const source = fixture(), original = source.data.slice();
  const scan = straightenReceipt(source, receipt);
  assert.deepEqual(source.data, original);
  assert.ok(scan.width < source.width && scan.height < source.height);
  const at = (x: number, y: number) => scan.data[(Math.floor(y * scan.height) * scan.width + Math.floor(x * scan.width)) * 4];
  for (const x of [.03, .97]) for (const y of [.03, .5, .97]) assert.ok(at(x, y) > 220, `Background inside corrected scan at ${x},${y}`);
  let inkPixels = 0;
  for (let i = 0; i < scan.data.length; i += 4) if (scan.data[i] < 60) inkPixels++;
  assert.ok(inkPixels > 1000, "Receipt text should remain visible");
});

test("invalid and crossed crop corners are rejected; full-page scans and output limits are supported", () => {
  assert.equal(validCorners(fullImageCorners()), true);
  const crossed: ScanCorners = [receipt[0], receipt[2], receipt[1], receipt[3]];
  assert.equal(validCorners(crossed), false);
  assert.throws(() => scanSize(crossed, 400, 600), /four corners/);
  assert.equal(validCorners([{ x: NaN, y: 0 }, ...receipt.slice(1)] as ScanCorners), false);
  assert.equal(validCorners([{ x: -.1, y: 0 }, ...receipt.slice(1)] as ScanCorners), false);
  const size = scanSize(fullImageCorners(), 8000, 12000);
  assert.equal(size.height, 3200); assert.ok(size.width < 3200);
});
