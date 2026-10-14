import { Download, ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ExpenseDocument } from "../../../shared/types";

export function ExpensePdfPreview({ document, apiBase, onClose, finalFocus }: {
  document: ExpenseDocument;
  apiBase: string;
  onClose: () => void;
  finalFocus: RefObject<HTMLButtonElement | null>;
}) {
  const sourceUrl = `${apiBase}/expense-documents/${encodeURIComponent(document.id)}`;
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
    <DialogContent className="expense-pdf-preview" showCloseButton={false} finalFocus={finalFocus}>
      <div className="expense-pdf-header">
        <DialogTitle title={document.fileName}>{document.fileName}</DialogTitle>
        <div className="expense-pdf-actions">
          {pdfUrl && <Button variant="outline" nativeButton={false} render={<a href={pdfUrl} download={document.fileName} />}><Download size={15} /> Download</Button>}
          <Button variant="outline" nativeButton={false} render={<a href={sourceUrl} target="_blank" rel="noreferrer" />}><ExternalLink size={15} /> Open in new tab</Button>
          <Button variant="ghost" size="icon" aria-label="Close PDF preview" onClick={onClose}><X size={18} /></Button>
        </div>
      </div>
      <div className="expense-pdf-content">
        {error ? <div className="expense-pdf-state"><p className="inline-error" role="alert">{error}</p><Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>
          : pdfUrl ? <iframe src={pdfUrl} title={`PDF preview: ${document.fileName}`} />
            : <div className="expense-pdf-state" role="status"><Loader2 className="spin" size={20} /> Loading PDF…</div>}
      </div>
    </DialogContent>
  </Dialog>;
}
