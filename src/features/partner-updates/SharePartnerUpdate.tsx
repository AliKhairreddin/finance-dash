import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { useUrlState } from "@/lib/url-state";
import type { PartnerUpdateStatus } from "../../../shared/partnerUpdates";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
const active = (status: PartnerUpdateStatus) => ["queued", "preparing", "sending"].includes(status.status);

export function SharePartnerUpdate() {
  const [id, setId] = useUrlState("partnerUpdate", "", { isValid: value => /^[a-f0-9-]{36}$/.test(value) });
  const [open, setOpen] = useState(Boolean(id));
  const [status, setStatus] = useState<PartnerUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  async function request(path: string, method = "GET"): Promise<PartnerUpdateStatus> {
    const response = await fetch(`${apiBase}/partner-updates/${path}`, { method, signal: AbortSignal.timeout(60_000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "Partner update could not be loaded.");
    return result;
  }
  useEffect(() => {
    if (!id || !open || busy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await request(id);
        if (stopped) return;
        setStatus(next); setError(null);
        if (active(next)) timer = setTimeout(() => void poll(), 2000);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : "Could not check delivery.");
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id, open, busy]);

  async function send(retry = false, fresh = false) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setOpen(true); setError(null);
    const nextId = fresh || !id ? crypto.randomUUID() : id;
    setId(nextId);
    if (fresh) setStatus(null);
    try { setStatus(await request(`${nextId}${retry ? "/retry" : ""}`, "POST")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Partner update could not start."); }
    finally { submitting.current = false; setBusy(false); }
  }
  const running = busy || Boolean(status && active(status));
  return <>
    <Button className="icon-text-button" type="button" onClick={() => id ? setOpen(true) : void send()} title="Send cash flow and open invoices to Amin, Sani, Ben, Ali, and Ali M">
      {running ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {running ? "Sharing…" : "Share with partners"}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Partner update</DialogTitle>
          <DialogDescription>Cash flow + open invoices · PNG images</DialogDescription>
        </DialogHeader>
        <div className="partner-update-source flex items-center gap-2">
          <span>{status ? `Cash flow · ${status.cashFlowDate}` : "Latest saved cash flow"}</span>
          <InfoPopover label="What partners receive">The most recent saved cash-flow snapshot and all current open invoices, including labeled drafts and manual receivables. Website filters and unsaved cash-flow edits are excluded. Amin, Sani, Ben, Ali, and Ali M receive identical images.</InfoPopover>
        </div>
        {running && <p role="status" className="flex items-center gap-2"><Loader2 size={16} className="spin" />{status?.status === "sending" ? "Sending images…" : "Preparing images…"}</p>}
        {status?.status === "complete" && <p role="status" className="flex items-center gap-2"><Check size={16} />Both images sent to all five recipients.</p>}
        {status?.recipients && <ul className="space-y-2" aria-label="Recipient delivery results">{status.recipients.map(recipient => <li key={recipient.name}>
          <strong>{recipient.name}</strong>: {recipient.status === "sent" ? "both images sent" : recipient.status === "unconfirmed" ? "delivery unconfirmed — check Telegram before resending" : recipient.status}
          {recipient.error && <p className="text-xs text-muted-foreground">{recipient.error}</p>}
        </li>)}</ul>}
        {(error || status?.error) && <p className="inline-error" role="alert">{error ?? status?.error}</p>}
        <DialogFooter showCloseButton>
          {!running && status && (status.status === "failed" || status.recipients.some(recipient => recipient.status === "failed")) && <Button onClick={() => void send(true)}>Retry failed deliveries</Button>}
          {!running && !status && error && <Button onClick={() => void send()}>Try again</Button>}
          {!running && status && !active(status) && <Button className="primary-button" onClick={() => void send(false, true)}><Send size={15} />Send new update</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
