/** Own one permission request and one camera stream for the current page. */
export class ReceiptCameraStream {
  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream | null> | null = null;
  private released = true;
  active = false;

  constructor(private readonly request: () => Promise<MediaStream>) {}

  async resume(): Promise<MediaStream | null> {
    this.active = true;
    this.released = false;
    if (this.stream?.getVideoTracks().some(track => track.readyState === "live")) {
      this.stream.getTracks().forEach(track => { track.enabled = true; });
      return this.stream;
    }
    // Visibility and pageshow can fire together, including while iOS displays
    // its permission prompt. Never open a second request while one is pending.
    if (this.pending) return this.pending;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    const pending = this.request().then(stream => {
      if (this.released) { stream.getTracks().forEach(track => track.stop()); return null; }
      this.stream = stream;
      stream.getTracks().forEach(track => { track.enabled = this.active; });
      return stream;
    });
    this.pending = pending;
    try { return await pending; }
    finally { if (this.pending === pending) this.pending = null; }
  }

  pause(): void {
    this.active = false;
    // Disabled video tracks produce black frames and deactivate camera capture
    // without discarding the permission-bearing stream between receipt photos.
    this.stream?.getTracks().forEach(track => { track.enabled = false; });
  }

  stop(): void {
    this.active = false;
    this.released = true;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    // A getUserMedia prompt cannot be cancelled. Release its result when it
    // arrives, unless this page has resumed in the meantime.
  }
}
