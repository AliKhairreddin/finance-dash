import assert from "node:assert/strict";
import test from "node:test";
import { CameraPinch, cameraFrame, clampCameraZoom, fitCameraFrame } from "../src/features/receipt-capture/zoom";

test("camera zoom crops the same centered field for detection and saved capture without upscaling", () => {
  for (const [width, height] of [[2560, 1920], [1920, 2560]]) {
    for (const zoom of [1, 1.25, 2, 3]) {
      const scan = cameraFrame(width, height, zoom, 3200), detection = cameraFrame(width, height, zoom, 640);
      assert.equal(scan.x + scan.sourceWidth / 2, width / 2);
      assert.equal(scan.y + scan.sourceHeight / 2, height / 2);
      for (const property of ["x", "y", "sourceWidth", "sourceHeight"] as const) assert.equal(scan[property], detection[property]);
      assert.equal(scan.sourceWidth, width / zoom);
      assert.equal(scan.sourceHeight, height / zoom);
      assert.ok(scan.width <= Math.ceil(width / zoom)); assert.ok(scan.height <= Math.ceil(height / zoom));
      assert.ok(Math.max(detection.width, detection.height) <= 640);
    }
  }
  assert.equal(cameraFrame(6000, 4000, 1, 3200).width, 3200);
  assert.throws(() => cameraFrame(0, 0, 1, 3200), /camera to be ready/);
});

test("preview keeps the full camera aspect inside portrait and landscape viewfinders", () => {
  assert.deepEqual(fitCameraFrame(1920, 1080, 390, 600), { left: 0, top: 190.3125, width: 390, height: 219.375 });
  assert.deepEqual(fitCameraFrame(1080, 1920, 600, 320), { left: 210, top: 0, width: 180, height: 320 });
});

test("pinch uses its starting zoom and clamps in both directions", () => {
  const pinch = new CameraPinch(), touches = (distance: number) => [{ clientX: 20, clientY: 40 }, { clientX: 20 + distance, clientY: 40 }];
  assert.equal(pinch.update(touches(100), 1.5), 1.5);
  assert.equal(pinch.update(touches(150), 1.5), 2.25);
  assert.equal(pinch.update(touches(200), 2.25), 3);
  assert.equal(pinch.update(touches(400), 3), 3);
  assert.equal(pinch.update(touches(50), 3), 1);
  assert.equal(pinch.update([touches(50)[0]], 1), 1);
  assert.equal(pinch.update(touches(200), 1), 1);
  assert.equal(pinch.update(touches(300), 1), 1.5);
  pinch.reset(); assert.equal(pinch.update(touches(80), 1.5), 1.5);
  assert.equal(pinch.update(touches(0), 1.5), 1.5);
  assert.equal(pinch.update(touches(100), 1.5), 1.5);
});

test("zoom values stay finite and within the supported digital range", () => {
  assert.equal(clampCameraZoom(.5), 1); assert.equal(clampCameraZoom(4), 3);
  assert.equal(clampCameraZoom(NaN), 1); assert.equal(clampCameraZoom(Infinity), 1);
  assert.equal(clampCameraZoom(1.33333), 1.33);
});
