import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, Check, Info, Link2, Loader2, ReceiptText, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { photograph, receiptDraft, type ReceiptDraft } from "./features/receipt-capture/draft";
import { ReceiptCameraStream } from "./features/receipt-capture/camera";
import "./styles.css";
import "./features/receipt-capture/capture.css";

const keyStorage = "receipt-upload-key";
function readKey() { try { return localStorage.getItem(keyStorage) ?? ""; } catch { return ""; } }
function setupKey(value: string) {
  const url = new URL(value);
  if (url.origin !== "https://receipts.thatcanadian.dev") throw new Error("Paste the phone setup link from Statements settings.");
  const key = new URLSearchParams(url.hash.slice(1)).get("connect") ?? "";
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("This setup link is incomplete. Copy it again from Statements settings.");
  localStorage.setItem(keyStorage, key);
  return key;
}
function cameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Allow camera access in Safari’s website settings, then tap Open camera.";
  if (name === "NotFoundError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is busy. Close other camera apps, then try again.";
  return "The camera could not start. Tap Open camera to try again.";
}
function CaptureApp() {
  const video = useRef<HTMLVideoElement>(null);
  const camera = useRef<ReceiptCameraStream | null>(null), wantsCamera = useRef(false), busyRef = useRef(false);
  if (!camera.current) camera.current = new ReceiptCameraStream(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }));
  const [ready, setReady] = useState(false), [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<ReceiptDraft>(), [preview, setPreview] = useState("");
  const [key, setKey] = useState(readKey), [connecting, setConnecting] = useState(false), [setupLink, setSetupLink] = useState("");
  const [help, setHelp] = useState(false), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const [error, setError] = useState(""), [cameraMessage, setCameraMessage] = useState("");

  const stop = useCallback(() => {
    camera.current!.stop();
    if (video.current) video.current.srcObject = null;
    setReady(false);
  }, []);
  const pause = useCallback(() => {
    camera.current!.pause();
    video.current?.pause();
    setReady(false);
  }, []);
  const start = useCallback(async () => {
    setCameraMessage("");
    if (!navigator.mediaDevices?.getUserMedia) { setCameraMessage("Open this app over HTTPS in Safari on a device with a camera."); return; }
    try {
      const next = await camera.current!.resume();
      if (!next || !camera.current!.active || !wantsCamera.current || document.visibilityState === "hidden") return;
      if (video.current) {
        if (video.current.srcObject !== next) {
          next.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
            if (video.current?.srcObject === next) { stop(); setCameraMessage("Camera paused. Tap Open camera to resume."); }
          }, { once: true }));
          video.current.srcObject = next;
        }
        await video.current.play();
      }
    } catch (err) {
      // A background/review transition can interrupt video.play(). It is not a
      // permission failure and must not discard the reusable stream.
      if (camera.current!.active && wantsCamera.current && document.visibilityState !== "hidden") { stop(); setCameraMessage(cameraError(err)); }
    }
  }, [stop]);

  useEffect(() => {
    let active = true;
    if (location.hash.startsWith("#connect=")) {
      try { setKey(setupKey(location.href)); history.replaceState(null, "", location.pathname); }
      catch (err) { setError(err instanceof Error ? err.message : "The connection could not be saved on this phone."); }
    }
    void receiptDraft().then(value => { if (active) { setDraft(value); setLoaded(true); } }).catch(err => { if (active) { setError(err.message); setLoaded(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!draft) { setPreview(""); return; }
    const url = URL.createObjectURL(draft.photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft]);
  useEffect(() => {
    wantsCamera.current = loaded && !draft && !sent;
    if (wantsCamera.current && document.visibilityState !== "hidden") void start();
    else pause();
  }, [loaded, draft, sent, start, pause]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "hidden" || !wantsCamera.current) pause(); else void start(); };
    const resume = (event: PageTransitionEvent) => { if (event.persisted) visible(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", resume);
    return () => { stop(); document.removeEventListener("visibilitychange", visible); window.removeEventListener("pagehide", stop); window.removeEventListener("pageshow", resume); };
  }, [start, stop, pause]);

  async function takePhoto() {
    if (!video.current || !ready || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { const next = await photograph(video.current); pause(); setDraft(next); }
    catch (err) { setError(err instanceof Error ? err.message : "The photo could not be captured."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function discard() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await receiptDraft(null); setDraft(undefined); setSent(false); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not clear the photo."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function send() {
    if (!draft || busyRef.current) return;
    if (!key) { setConnecting(true); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/capture", { method: "POST", credentials: "omit", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/pdf" }, body: draft.pdf, signal: AbortSignal.timeout(60_000) });
      const result = await response.json() as { saved?: boolean; message?: string };
      if (!response.ok || result.saved !== true) {
        if (response.status === 401) { localStorage.removeItem(keyStorage); setKey(""); }
        throw new Error(result.message || "Delivery was not confirmed. Try Send again.");
      }
      setSent(true);
      try { await receiptDraft(null); setDraft(undefined); }
      catch { setError("Receipt delivered. This phone could not clear its local copy. Tap Next receipt to try clearing it again."); }
    } catch (err) { setError(err instanceof Error && err.name !== "TimeoutError" && err.name !== "TypeError" ? err.message : "Delivery was not confirmed. Your photo is saved on this phone. Try Send again when connected."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <main className="capture-app">
    <header className="capture-header"><div className="capture-brand"><ReceiptText size={23} /><strong>Receipts</strong></div><div className="capture-header-actions"><Button variant="ghost" size="icon" aria-label={key ? "Phone connection" : "Connect phone"} onClick={() => setConnecting(true)}><Link2 /><span className={key ? "capture-dot connected" : "capture-dot"} /></Button><Button variant="ghost" size="icon" aria-label="Help and install" onClick={() => setHelp(true)}><Info /></Button></div></header>
    <section className={`capture-viewfinder${draft ? " has-photo" : ""}`} aria-label={draft ? "Receipt photo preview" : "Camera preview"}>
      <video ref={video} autoPlay muted playsInline onPlaying={() => setReady(camera.current!.active && wantsCamera.current && document.visibilityState !== "hidden")} hidden={Boolean(draft) || sent} />
      {preview && !sent && <img src={preview} alt="Your receipt photo, ready to send" />}
      {!draft && !sent && ready && <div className="capture-guides" aria-hidden="true"><i /><i /><i /><i /></div>}
      {sent ? <div className="capture-state" role="status"><span className="capture-success-icon"><Check size={36} /></span><h1>Sent to Statements</h1><p>Ready for processing and review.</p></div> : !draft && (!ready || !loaded) && <div className="capture-state">{cameraMessage ? <><Camera size={38} /><p>{cameraMessage}</p><Button onClick={() => void start()}>Open camera</Button></> : <><Loader2 className="spin" size={28} /><p>Opening camera…</p></>}</div>}
      {draft && !sent && <span className="capture-review-label">Check the text is clear</span>}
    </section>
    <footer className="capture-controls">
      {error && <p className="capture-error" role="alert">{error}</p>}
      {sent ? <Button className="capture-send" disabled={busy} onClick={() => void discard()}><Camera />Next receipt</Button> : draft ? <div className="capture-review-actions"><Button variant="outline" disabled={busy} onClick={() => void discard()}><RotateCcw />Retake</Button><Button className="capture-send" disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="spin" /> : <Send />}{busy ? "Sending…" : "Send receipt"}</Button></div> : <><p className="capture-hint">Fit the whole receipt in the frame</p><Button className="capture-shutter" aria-label="Take receipt photo" disabled={!ready || busy || !loaded} onClick={() => void takePhoto()}>{busy ? <Loader2 className="spin" size={28} /> : <span />}</Button></>}
    </footer>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="capture-dialog"><DialogTitle>Receipt camera</DialogTitle><p>In Safari, tap Share → Add to Home Screen. Open the Receipts icon and connect the phone once using the setup link from Statements settings.</p><p>The camera opens without signing in. Capture a clear photo and send it; Statements reads the text with OCR for review.</p><p>iPhone may ask for camera permission again after the home-screen app closes or restarts. The app cannot remember permission on iOS’s behalf. In a Safari tab, use Website Settings → Camera → Allow for this site; that setting may not carry over to the home-screen app.</p><p>This app photographs the receipt. Automatic cropping and perspective correction are not included.</p><p>An unsent photo stays on this phone until you send it or retake it. Sending needs internet. Keep the app open until delivery is confirmed.</p></DialogContent></Dialog>
    <Dialog open={connecting} onOpenChange={setConnecting}><DialogContent className="capture-dialog"><DialogTitle>{key ? "Phone connected" : "Connect this phone once"}</DialogTitle>{key ? <><p>This phone can send receipts without signing in. Its upload key has no timed expiry. Disconnect it in Statements settings to revoke access.</p><Button variant="outline" onClick={() => { localStorage.removeItem(keyStorage); setKey(""); }}>Forget connection on this phone</Button></> : <form onSubmit={event => { event.preventDefault(); try { setKey(setupKey(setupLink.trim())); setSetupLink(""); setConnecting(false); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "The connection could not be saved."); } }}><label htmlFor="setup-link">Phone setup link</label><textarea id="setup-link" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={setupLink} onChange={event => setSetupLink(event.target.value)} required placeholder="Paste the link from Statements settings" /><p>Set this up inside the home-screen app. No login is needed on this phone.</p>{error && <p className="capture-error" role="alert">{error}</p>}<Button type="submit"><Link2 />Connect phone</Button></form>}</DialogContent></Dialog>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><CaptureApp /></StrictMode>);
