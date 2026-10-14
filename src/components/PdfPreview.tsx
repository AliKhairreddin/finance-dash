import { Download, ExternalLink, Eye, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export function PdfPreviewButton({ sourceUrl, fileName }: { sourceUrl: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={trigger} variant="link" size="sm" className="pdf-preview-trigger" title={fileName} aria-label={`View PDF: ${fileName}`} onClick={() => setOpen(true)}><Eye size={14} /> View PDF</Button>
    {open && <PdfPreview sourceUrl={sourceUrl} fileName={fileName} onClose={() => setOpen(false)} finalFocus={trigger} />}
  </>;
}

function PdfPreview({ sourceUrl, fileName, onClose, finalFocus }: {
  sourceUrl: string;
  fileName: string;
  onClose: () => void;
  finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setPdfUrl("");
    setError("");
    void (async () => {
      try {
        const response = await fetch(sourceUrl, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(body?.message || "The PDF could not be loaded.");
        }
        if (response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/pdf") {
          throw new Error("The saved file is not a PDF. Close this preview and reload the page.");
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error("The saved PDF is empty.");
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "The PDF could not be loaded.");
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl, attempt]);

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="pdf-preview" showCloseButton={false} finalFocus={finalFocus}>
      <div className="pdf-preview-header">
        <DialogTitle title={fileName}>{fileName}</DialogTitle>
        <div className="pdf-preview-actions">
          {pdfUrl && <Button variant="outline" nativeButton={false} render={<a href={pdfUrl} download={fileName} />}><Download size={15} /> Download</Button>}
          <Button variant="outline" nativeButton={false} render={<a href={sourceUrl} target="_blank" rel="noreferrer" />}><ExternalLink size={15} /> Open in new tab</Button>
          <Button variant="ghost" size="icon" aria-label="Close PDF preview" onClick={onClose}><X size={18} /></Button>
        </div>
      </div>
      <div className="pdf-preview-content">
        {error ? <div className="pdf-preview-state"><p className="inline-error" role="alert">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>
          : pdfUrl ? <iframe src={pdfUrl} title={`PDF preview: ${fileName}`} />
            : <div className="pdf-preview-state" role="status"><Loader2 className="spin" size={20} /> Loading PDF…</div>}
      </div>
    </DialogContent>
  </Dialog>;
}
