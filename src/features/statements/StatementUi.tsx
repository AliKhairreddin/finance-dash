import { simpleStatementText, statementStatusLabels } from "./statementWords";
import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";

export async function statementRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/statements${path}`, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error || `Request failed (${response.status})`);
  return result as T;
}

export function jsonRequest(method: string, value: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

export function ErrorMessage({ error }: { error: string }) {
  return error ? <p className="inline-error statement-error" role="alert">{simpleStatementText(error)}</p> : null;
}

export function StatementModal({ title, busy = false, onClose, children, wide = false }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className={`statement-dialog${wide ? " statement-dialog-wide" : ""}`} showCloseButton={false}>
      <div className="statement-dialog-heading"><DialogTitle>{title}</DialogTitle><Button variant="ghost" size="icon" aria-label={`Close ${title}`} disabled={busy} onClick={onClose}><X size={18} /></Button></div>
      {children}
    </DialogContent>
  </Dialog>;
}

export function SubmitButton({ busy, children, disabled }: { busy: boolean; children: ReactNode; disabled?: boolean }) {
  return <Button type="submit" className="primary-button" disabled={busy || disabled}>{busy && <Loader2 size={15} className="spin" />}{children}</Button>;
}

export function SelectField({ label, value, onChange, options, disabled }: {
  label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; disabled?: boolean;
}) {
  return <label>{label}<NativeSelect aria-label={label} value={value} onValueChange={onChange} disabled={disabled}>{options.map(option => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}</NativeSelect></label>;
}

export function useStatementSort<K extends string>(prefix: string, keys: readonly K[], defaultKey: K, defaultOrder: TableSortDirection = "desc") {
  const [sort, setSort] = useUrlState<K>(`${prefix}Sort`, defaultKey, { allowedValues: keys });
  const [order, setOrder] = useUrlState<TableSortDirection>(`${prefix}Order`, defaultOrder, { allowedValues: ["asc", "desc"] });
  const toggle = (key: K) => { if (sort === key) setOrder(value => value === "asc" ? "desc" : "asc"); else { setSort(key); setOrder("asc"); } };
  const head = (key: K, label: string) => <SortableTableHead key={key} activeSortKey={sort} direction={order} onSort={toggle} sortKey={key}>{label}</SortableTableHead>;
  const compare = (a: string | number | undefined | null, b: string | number | undefined | null) => compareTableValues(a, b, order);
  return { sort, order, head, compare };
}

export function StatusPill({ value }: { value: string }) {

  return <span className={`status-pill ${value === "ai_generated" ? "statement-ai-status" : ["completed", "reconciled", "imported"].includes(value) ? "good" : value === "failed" ? "danger" : "warning"}`}>{statementStatusLabels[value] || value.replaceAll("_", " ")}</span>;
}

export function downloadText(name: string, contents: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvCell = (value: unknown) => {
  const raw = String(value ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};
