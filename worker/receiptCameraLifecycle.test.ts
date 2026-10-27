import assert from "node:assert/strict";
import test from "node:test";
import { ReceiptCameraStream } from "../src/features/receipt-capture/camera";

function fixture() {
  const track = { enabled: true, readyState: "live", stops: 0, stop() { this.readyState = "ended"; this.stops++; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { track, stream };
}

test("review, retake and temporary backgrounding reuse the authorized stream without capturing while paused", async () => {
  const { track, stream } = fixture(); let requests = 0;
  const camera = new ReceiptCameraStream(async () => { requests++; return stream; });
  await camera.resume();
  for (let i = 0; i < 3; i++) {
    camera.pause(); assert.equal(track.enabled, false); assert.equal(camera.active, false);
    assert.equal(await camera.resume(), stream); assert.equal(track.enabled, true);
  }
  assert.equal(requests, 1); assert.equal(track.stops, 0);
  camera.stop(); assert.equal(track.stops, 1); assert.equal(camera.active, false);
});
test("overlapping resume events and permission-prompt visibility changes issue only one request", async () => {
  const { track, stream } = fixture(); let requests = 0, resolve!: (value: MediaStream) => void;
  const camera = new ReceiptCameraStream(() => { requests++; return new Promise(done => { resolve = done; }); });
  const first = camera.resume(); camera.pause(); const second = camera.resume(); const third = camera.resume();
  resolve(stream);
  assert.deepEqual(await Promise.all([first, second, third]), [stream, stream, stream]);
  assert.equal(requests, 1); assert.equal(track.enabled, true);
});
test("permission granted while backgrounded leaves capture disabled until the app resumes", async () => {
  const { track, stream } = fixture(); let resolve!: (value: MediaStream) => void;
  const camera = new ReceiptCameraStream(() => new Promise(done => { resolve = done; }));
  const opening = camera.resume(); camera.pause(); resolve(stream); await opening;
  assert.equal(track.enabled, false); assert.equal(camera.active, false);
  assert.equal(await camera.resume(), stream); assert.equal(track.enabled, true);
});
test("a late permission result is released after leaving the page", async () => {
  const { track, stream } = fixture(); let resolve!: (value: MediaStream) => void;
  const camera = new ReceiptCameraStream(() => new Promise(done => { resolve = done; }));
  const opening = camera.resume(); camera.stop(); resolve(stream);
  assert.equal(await opening, null); assert.equal(track.stops, 1);
});
test("an interrupted page that resumes before permission resolves adopts its one pending request", async () => {
  const { track, stream } = fixture(); let requests = 0, resolve!: (value: MediaStream) => void;
  const camera = new ReceiptCameraStream(() => { requests++; return new Promise(done => { resolve = done; }); });
  const opening = camera.resume(); camera.stop(); const resumed = camera.resume(); resolve(stream);
  assert.equal(await opening, stream); assert.equal(await resumed, stream);
  assert.equal(requests, 1); assert.equal(track.stops, 0);
});
test("ended streams and denied requests can be retried without a stuck pending request", async () => {
  const first = fixture(), second = fixture(); let requests = 0;
  const camera = new ReceiptCameraStream(async () => { requests++; if (requests === 1) throw new Error("Permission denied"); return requests === 2 ? first.stream : second.stream; });
  await assert.rejects(camera.resume(), /Permission denied/);
  assert.equal(await camera.resume(), first.stream);
  first.track.readyState = "ended";
  assert.equal(await camera.resume(), second.stream); assert.equal(requests, 3);
});
