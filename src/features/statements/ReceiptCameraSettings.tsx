import { useEffect, useState } from "react";
import { Camera, Check, Copy, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { ErrorMessage, StatementModal, statementRequest } from "./StatementUi";

export function ReceiptCameraSettings() {
  const [active, setActive] = useState<boolean>(), [setupUrl, setSetupUrl] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void statementRequest<{ active: boolean }>("/capture-device", { signal: controller.signal }).then(result => setActive(result.active)).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  async function change(method: "POST" | "DELETE") {
    setBusy(true); setError("");
    try {
      const result = await statementRequest<{ setupUrl?: string }>("/capture-device", { method });
      setActive(method === "POST"); setSetupUrl(result.setupUrl ?? ""); setCopied(false); setConfirm(false);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not change the phone connection."); }
    finally { setBusy(false); }
  }
  return <section className="statement-panel">
    <div className="statement-section-heading"><div className="row-actions"><Camera size={18} /><h2>Receipt camera</h2><InfoPopover label="Receipt camera setup">Open receipts.thatcanadian.dev in Safari and add it to the Home Screen. Inside the home-screen app, tap the connection icon and paste your setup link once. No sign-in or timed expiry. Keep this link private: it grants upload access only. Disconnect phone revokes every copy of your link.</InfoPopover></div>
      <Button variant="outline" disabled={busy || active === undefined} onClick={() => active ? setConfirm(true) : void change("POST")}>{busy ? <Loader2 className="spin" size={15} /> : active ? <Unplug size={15} /> : <Camera size={15} />}{active ? "Disconnect phone" : "Create phone setup link"}</Button>
    </div>
    <div style={{ padding: "0 16px 16px" }}><a className="statement-file-link" href="https://receipts.thatcanadian.dev" target="_blank" rel="noreferrer">Open receipt camera</a>
      {setupUrl && <div style={{ display: "grid", gap: 10, marginTop: 12 }}><label htmlFor="phone-setup-link">Private phone setup link</label><div className="row-actions"><Input id="phone-setup-link" readOnly type="password" value={setupUrl} onFocus={event => event.target.select()} /><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(setupUrl).then(() => setCopied(true)).catch(() => setError("Could not copy. Select and copy the setup link manually.")); }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}</Button></div><span className="statement-muted">Shown once. Paste it into the connection screen in the home-screen app.</span></div>}
      <ErrorMessage error={error} />
    </div>
    {confirm && <StatementModal title="Disconnect receipt camera?" busy={busy} onClose={() => setConfirm(false)}><p>Phones using your setup link will no longer be able to send receipts. Saved dashboard documents remain available.</p><div className="statement-dialog-footer"><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void change("DELETE")}>Disconnect phone</Button></div></StatementModal>}
  </section>;
}
