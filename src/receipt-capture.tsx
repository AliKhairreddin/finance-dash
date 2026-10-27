import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Camera, Check, Crop, Info, Link2, Loader2, ReceiptText, RotateCcw, ScanLine, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { photograph, receiptDraft, saveScan, type ReceiptDraft } from "./features/receipt-capture/draft";
import { ReceiptCameraStream } from "./features/receipt-capture/camera";
import { ReceiptScanner, cameraPixels, photoPixels } from "./features/receipt-capture/scanner";
import { fullImageCorners, type ScanCorners } from "./features/receipt-capture/scanGeometry";
import { ScanCrop } from "./features/receipt-capture/ScanCrop";
import { CameraPreview } from "./features/receipt-capture/CameraPreview";
import { clampCameraZoom } from "./features/receipt-capture/zoom";
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
  const scanner = useRef<ReceiptScanner | null>(null);
  const [scannerLoaded, setScannerLoaded] = useState(false), [scannerError, setScannerError] = useState("");
  const [editing, setEditing] = useState(false), [corners, setCorners] = useState<ScanCorners>(fullImageCorners);
  const [liveEdges, setLiveEdges] = useState<{ corners: ScanCorners; width: number; height: number; zoom: number } | null>(null);
  const [zoom, setZoom] = useState(1), zoomRef = useRef(1);
  const changeZoom = useCallback((value: number) => { zoomRef.current = clampCameraZoom(value); setZoom(zoomRef.current); }, []);
  const visibleEdges = liveEdges?.zoom === zoom ? liveEdges : null;

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
    void receiptDraft().then(value => { if (active) { setDraft(value); setEditing(Boolean(value?.scan && !value.scan.confirmed)); if (value?.scan) setCorners(value.scan.corners); setLoaded(true); } }).catch(err => { if (active) { setError(err.message); setLoaded(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const instance = new ReceiptScanner(); scanner.current = instance;
    void instance.ready.then(() => { if (active) setScannerLoaded(true); }).catch(err => { if (active) setScannerError(err.message); });
    return () => { active = false; instance.close(); scanner.current = null; };
  }, []);
  useEffect(() => {
    if (!ready || !scannerLoaded || busy || draft || sent || help || connecting) { setLiveEdges(null); return; }
    let active = true, timer: ReturnType<typeof setTimeout>;
    async function detect() {
      if (!active || !video.current || !scanner.current || !video.current.videoWidth) return;
      try {
        const frameZoom = zoomRef.current, frame = cameraPixels(video.current, frameZoom), found = await scanner.current.detect(frame);
        if (active) { setLiveEdges(found && frameZoom === zoomRef.current ? { corners: found, width: frame.width, height: frame.height, zoom: frameZoom } : null); timer = setTimeout(() => void detect(), 450); }
      } catch (err) { if (active) { setScannerError(err instanceof Error ? err.message : "Scanner stopped. Reload to try again."); setScannerLoaded(false); } }
    }
    void detect();
    return () => { active = false; clearTimeout(timer); };
  }, [ready, scannerLoaded, busy, draft, sent, help, connecting]);
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
    if (!video.current || !ready || !scannerLoaded || !scanner.current || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const next = await photograph(video.current, zoomRef.current); pause(); setDraft(next); setEditing(true); setCorners(fullImageCorners());
      const found = await scanner.current.detect(await photoPixels(next.photo));
      const scanned = { ...next, scan: { ...next.scan!, corners: found ?? fullImageCorners(), detected: Boolean(found) } };
      await receiptDraft(scanned); setDraft(scanned); setCorners(scanned.scan.corners);
    }
    catch (err) { setError(err instanceof Error ? err.message : "The photo could not be captured."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function applyScan() {
    if (!draft?.scan || !scanner.current || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const pixels = await scanner.current.straighten(await photoPixels(draft.scan.original), corners);
      const next = await saveScan(draft, pixels, corners); setDraft(next); setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : "The scan could not be saved. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function discard() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await receiptDraft(null); setDraft(undefined); setEditing(false); setSent(false); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not clear the photo."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function send() {
    if (!draft || editing || busyRef.current) return;
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
    <section className={`capture-viewfinder${draft ? " has-photo" : ""}`} aria-label={draft ? editing ? "Receipt crop editor" : "Receipt scan preview" : "Camera preview"}>
      <CameraPreview video={video} visible={!draft && !sent} ready={ready} interactive={ready && !busy && !help && !connecting} zoom={zoom} onZoom={changeZoom} onPlaying={() => setReady(camera.current!.active && wantsCamera.current && document.visibilityState !== "hidden")} edges={visibleEdges} />
      {editing && draft?.scan && !sent ? <ScanCrop photo={draft.scan.original} width={draft.scan.width} height={draft.scan.height} corners={corners} onChange={setCorners} disabled={busy} /> : preview && !sent && <img src={preview} alt="Your receipt scan, ready to send" />}
      {sent ? <div className="capture-state" role="status"><span className="capture-success-icon"><Check size={36} /></span><h1>Sent to Statements</h1><p>Ready for processing and review.</p></div> : !draft && (!ready || !loaded) && <div className="capture-state">{cameraMessage ? <><Camera size={38} /><p>{cameraMessage}</p><Button onClick={() => void start()}>Open camera</Button></> : <><Loader2 className="spin" size={28} /><p>Opening camera…</p></>}</div>}
      {draft && !sent && !editing && <span className="capture-review-label">Check the text is clear</span>}
    </section>
    <footer className="capture-controls">
      {error && <p className="capture-error" role="alert">{error}</p>}
      {sent ? <Button className="capture-send" disabled={busy} onClick={() => void discard()}><Camera />Next receipt</Button> : draft ? <>
        {editing ? <p className="capture-hint" role="status">{busy ? "Processing scan…" : !scannerLoaded ? "Loading scanner…" : draft.scan?.detected ? "Check the edges · Drag corners to adjust" : "Set the four corners around the receipt"}</p> : draft.scan && <Button variant="ghost" className="capture-adjust" disabled={busy} onClick={() => { setCorners(draft.scan!.corners); setEditing(true); }}><Crop />Adjust edges</Button>}
        <div className="capture-review-actions"><Button variant="outline" disabled={busy} onClick={() => void discard()}><RotateCcw />Retake</Button>{editing ? <Button className="capture-send" disabled={busy || !scannerLoaded} onClick={() => void applyScan()}>{busy ? <Loader2 className="spin" /> : <ScanLine />}{busy ? "Processing…" : "Use scan"}</Button> : <Button className="capture-send" disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="spin" /> : <Send />}{busy ? "Sending…" : "Send receipt"}</Button>}</div>
      </> : <><p className="capture-hint" role="status">{scannerError || (!scannerLoaded ? "Loading scanner…" : visibleEdges ? "Receipt found · Tap to scan" : "Fit the whole receipt in the frame")}</p>{scannerError ? <Button variant="outline" onClick={() => location.reload()}>Reload scanner</Button> : <Button className="capture-shutter" aria-label="Scan receipt" disabled={!ready || busy || !loaded || !scannerLoaded} onClick={() => void takePhoto()}>{busy ? <Loader2 className="spin" size={28} /> : <span><ScanLine size={30} /></span>}</Button>}</>}
      {draft && editing && scannerError && <p className="capture-error" role="alert">{scannerError} <button type="button" onClick={() => location.reload()}>Reload scanner</button></p>}
    </footer>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="capture-dialog"><DialogTitle>Receipt scanner</DialogTitle><p>In Safari, tap Share → Add to Home Screen. Open the Receipts icon and connect the phone once using the setup link from Statements settings.</p><p>Place the receipt flat on a contrasting surface with all four corners visible. Tap Scan, check or drag the corners, then tap Use scan. The app crops the background and straightens the receipt on this phone. Check the text before sending; Statements reads it with OCR for review.</p><p>Pinch inside the camera or use − / + to zoom from 1× to 3×. Tap the zoom number to return to 1×, the widest view. Zoom is digital: it crops the camera image and does not add detail. Moving closer while keeping the text sharp and all four corners visible gives a clearer scan. Move farther away to fit a long receipt.</p><p>iPhone may ask for camera permission again after the home-screen app closes or restarts. The app cannot remember permission on iOS’s behalf. In a Safari tab, use Website Settings → Camera → Allow for this site; that setting may not carry over to the home-screen app.</p><p>An unsent scan and its original photo stay on this phone until you send it or retake it. Sending needs internet. Keep the app open until delivery is confirmed.</p></DialogContent></Dialog>
    <Dialog open={connecting} onOpenChange={setConnecting}><DialogContent className="capture-dialog"><DialogTitle>{key ? "Phone connected" : "Connect this phone once"}</DialogTitle>{key ? <><p>This phone can send receipts without signing in. Its upload key has no timed expiry. Disconnect it in Statements settings to revoke access.</p><Button variant="outline" onClick={() => { localStorage.removeItem(keyStorage); setKey(""); }}>Forget connection on this phone</Button></> : <form onSubmit={event => { event.preventDefault(); try { setKey(setupKey(setupLink.trim())); setSetupLink(""); setConnecting(false); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "The connection could not be saved."); } }}><label htmlFor="setup-link">Phone setup link</label><textarea id="setup-link" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={setupLink} onChange={event => setSetupLink(event.target.value)} required placeholder="Paste the link from Statements settings" /><p>Set this up inside the home-screen app. No login is needed on this phone.</p>{error && <p className="capture-error" role="alert">{error}</p>}<Button type="submit"><Link2 />Connect phone</Button></form>}</DialogContent></Dialog>
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><CaptureApp /></StrictMode>);
