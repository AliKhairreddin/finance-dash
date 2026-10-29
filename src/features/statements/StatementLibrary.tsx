import { useStatementAccounts } from "./StatementAccountContext";
import { Fragment, useEffect, useState } from "react";
import { zipSync, strToU8 } from "fflate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useUrlState } from "@/lib/url-state";
import {
  statementContext,
  statementAmountMinor,
  statementCurrencyScale,
} from "../../../shared/statements";
import {
  ErrorMessage,
  SelectField,
  StatusPill,
  jsonRequest,
  statementRequest,
  useStatementSort,
} from "./StatementUi";
import { companyName } from "./StatementTransactions";
type Item = {
  id: string;
  source: "uploaded" | "generated";
  number: string;
  companyId?: string;
  financialAccountId?: string;
  counterparty: string;
  reference: string;
  date: string;
  transactionDate: string;
  createdAt: string;
  amount: string;
  currency: string;
  direction: string;
  documentType: string;
  status: string;
  downloadedAt?: string | number;
  file: boolean;
  predecessorId?: string;
  supersededBy?: string;
};
function amountOrder(a: Item, b: Item) {
  const value = (r: Item) => {
    try {
      return (
        BigInt(statementAmountMinor(r.amount || "0", r.currency || "EUR")) *
        10n ** BigInt(8 - statementCurrencyScale(r.currency || "EUR"))
      );
    } catch {
      return null;
    }
  };
  const x = value(a),
    y = value(b);
  return x === null
    ? y === null
      ? 0
      : -1
    : y === null
      ? 1
      : x < y
        ? -1
        : x > y
          ? 1
          : 0;
}
const filePath = (r: Item) =>
  r.source === "generated"
    ? `/created-invoices/${r.id}/file`
    : `/documents/${r.id}/file`;
export function StatementLibrary({
  company,
  revision,
}: {
  company: string;
  revision: number;
}) {
  const accounts = useStatementAccounts();
  const [rows, setRows] = useState<Item[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [accountFilter, setAccountFilter] = useUrlState(
    "libraryAccount",
    "all",
  );
  const [search, setSearch] = useUrlState("librarySearch", ""),
    [source, setSource] = useUrlState("librarySource", "all"),
    [downloaded, setDownloaded] = useUrlState("downloaded", "all"),
    [month, setMonth] = useUrlState("documentMonth", ""),
    [direction, setDirection] = useUrlState("documentDirection", "all");
  const sort = useStatementSort(
    "library",
    [
      "number",
      "date",
      "transactionDate",
      "createdAt",
      "companyId",
      "counterparty",
      "reference",
      "amount",
      "currency",
      "documentType",
      "source",
      "status",
      "downloadedAt",
    ] as const,
    "date",
  );
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void (async () => {
      const all: Item[] = [];
      for (const source of ["uploaded", "generated"]) {
        let cursor = "";
        for (let pages = 0; pages < 500; pages++) {
          const page = await statementRequest<{
            items: Item[];
            isDone: boolean;
            continueCursor: string;
          }>(`/library?${new URLSearchParams({ source, cursor })}`, {
            signal: controller.signal,
          });
          all.push(...page.items);
          if (page.isDone) break;
          if (page.continueCursor === cursor || pages === 499)
            throw new Error(
              "Library coverage incomplete; narrow the saved-data scope before downloading all",
            );
          cursor = page.continueCursor;
        }
      }
      if (!controller.signal.aborted) setRows(all);
    })()
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [revision]);
  const context = statementContext(company),
    filtered = rows.filter(
      (r) =>
        (!context.companyId || r.companyId === context.companyId) &&
        (!context.financialAccountId ||
          r.financialAccountId === context.financialAccountId) &&
        (context.financialAccountId ||
          accountFilter === "all" ||
          r.financialAccountId === accountFilter) &&
        (source === "all" || r.source === source) &&
        (downloaded === "all" ||
          Boolean(r.downloadedAt) === (downloaded === "yes")) &&
        (!month || (r.date || r.transactionDate).startsWith(month)) &&
        (direction === "all" || direction === r.direction) &&
        [r.number, r.counterparty, r.reference, r.documentType]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase()),
    );
  const groups = [
    ...new Set(
      filtered.map((r) =>
        (r.date || r.transactionDate || r.createdAt).slice(0, 7),
      ),
    ),
  ]
    .sort()
    .reverse();
  const action = async (items: Item[], action: string) => {
    setBusy(true);
    setError("");
    try {
      const results: Array<{ id: string; outcome: string; message?: string }> =
        [];
      for (const source of ["uploaded", "generated"] as const) {
        const ids = items.filter((r) => r.source === source).map((r) => r.id);
        for (let i = 0; i < ids.length; i += 100)
          results.push(
            ...(await statementRequest<typeof results>(
              "/library/actions",
              jsonRequest("POST", {
                source,
                ids: ids.slice(i, i + 100),
                action,
              }),
            )),
          );
      }
      const success = results
        .filter((r) => r.outcome === "success")
        .map((r) => r.id);
      setRows((old) =>
        old.map((r) =>
          success.includes(r.id)
            ? {
                ...r,
                ...(action === "cancel"
                  ? { status: "cancelled" }
                  : {
                      downloadedAt:
                        action === "downloaded" ? Date.now() : undefined,
                    }),
              }
            : r,
        ),
      );
      setNotice(
        results
          .map(
            (r) => `${r.id}: ${r.outcome}${r.message ? ` — ${r.message}` : ""}`,
          )
          .join("\n"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document action failed");
    } finally {
      setBusy(false);
    }
  };
  const download = async (items: Item[]) => {
    setBusy(true);
    setError("");
    const results: string[] = [],
      success: Item[] = [];
    let files: Record<string, Uint8Array> = {},
      size = 0,
      count = 0,
      part = 1;
    const savePart = () => {
      if (!count) return;
      files["download-results.txt"] = strToU8(results.join("\n"));
      const bytes = zipSync(files, { level: 0 }),
        url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: "application/zip" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `financial-documents-part-${part++}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      files = {};
      size = 0;
      count = 0;
    };
    try {
      for (const row of items) {
        if (!row.file) {
          results.push(`${row.number}: skipped, no saved file`);
          continue;
        }
        try {
          const response = await fetch(
            `/api/statements${filePath(row)}${row.source === "generated" ? "?download=1" : ""}`,
          );
          if (!response.ok) throw new Error("Download unavailable");
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
            throw new Error("Invalid PDF response");
          if (count >= 200 || size + bytes.length > 80 * 1024 * 1024)
            savePart();
          files[
            `${row.number.replace(/[^a-zA-Z0-9_.-]/g, "_")}-${row.id}.pdf`
          ] = bytes;
          count++;
          size += bytes.length;
          success.push(row);
          results.push(`${row.number}: download requested`);
        } catch (e) {
          results.push(
            `${row.number}: failed — ${e instanceof Error ? e.message : "unavailable"}`,
          );
        }
      }
      savePart();
      if (success.length) await action(success, "downloaded");
      setNotice(`${part - 1} archive(s) requested.\n${results.join("\n")}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="statement-panel">
      <div className="statement-filterbar">
        <Input
          aria-label="Search document library"
          placeholder="Search documents"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectField
          label="Document financial account"
          value={context.financialAccountId || accountFilter}
          disabled={Boolean(context.financialAccountId)}
          onChange={setAccountFilter}
          options={[
            { value: "all", label: "All accounts" },
            ...accounts
              .filter(
                (a) => !context.companyId || a.companyId === context.companyId,
              )
              .map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <SelectField
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "All" },
            { value: "uploaded", label: "Uploaded" },
            { value: "generated", label: "Generated" },
          ]}
        />
        <SelectField
          label="Download status"
          value={downloaded}
          onChange={setDownloaded}
          options={[
            { value: "all", label: "All" },
            { value: "yes", label: "Downloaded" },
            { value: "no", label: "Not downloaded" },
          ]}
        />
        <label>
          Month
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <SelectField
          label="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "all", label: "All" },
            { value: "in", label: "Incoming" },
            { value: "out", label: "Outgoing" },
          ]}
        />
        <Button
          disabled={busy}
          onClick={() => setSelected(filtered.map((r) => r.id))}
        >
          Select visible
        </Button>
        <Button
          disabled={busy || !selected.length}
          onClick={() =>
            void download(filtered.filter((r) => selected.includes(r.id)))
          }
        >
          Download selected
        </Button>
        <Button
          disabled={busy || Boolean(error)}
          onClick={() => void download(filtered)}
        >
          Download all matching
        </Button>
        <Button
          disabled={busy || !selected.length}
          onClick={() =>
            void action(
              filtered.filter((r) => selected.includes(r.id)),
              "cancel",
            )
          }
        >
          Cancel selected
        </Button>
        <Button
          disabled={busy || !selected.length}
          onClick={() =>
            void action(
              filtered.filter((r) => selected.includes(r.id)),
              "not_downloaded",
            )
          }
        >
          Mark not downloaded
        </Button>
      </div>
      <ErrorMessage error={error} />
      {busy && <p role="status">Loading documents…</p>}
      {notice && (
        <details>
          <summary>Operation results</summary>
          <pre>{notice}</pre>
        </details>
      )}
      {groups.map((group) => {
        const items = filtered.filter((r) =>
          (r.date || r.transactionDate || r.createdAt).startsWith(group),
        );
        return (
          <section key={group}>
            <div className="statement-section-heading">
              <h2>{group}</h2>
              <Button
                variant="outline"
                onClick={() =>
                  setSelected([
                    ...new Set([...selected, ...items.map((r) => r.id)]),
                  ])
                }
              >
                Select month
              </Button>
              <Button disabled={busy} onClick={() => void download(items)}>
                Download month
              </Button>
              {["in", "out"].map((d) => (
                <Button
                  key={d}
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void download(items.filter((r) => r.direction === d))
                  }
                >
                  Download {d === "in" ? "incoming" : "outgoing"}
                </Button>
              ))}
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Select</th>
                    {sort.head("number", "Document")}
                    {sort.head("date", "Issue / document date")}
                    {sort.head("transactionDate", "Transaction date")}
                    {sort.head("createdAt", "Created")}
                    {sort.head("companyId", "Company / account")}
                    {sort.head("counterparty", "Counterparty")}
                    {sort.head("reference", "Reference")}
                    {sort.head("amount", "Amount")}
                    {sort.head("currency", "Currency")}
                    {sort.head("documentType", "Type")}
                    {sort.head("source", "Source")}
                    {sort.head("status", "Status")}
                    {sort.head("downloadedAt", "Downloaded")}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {[...items]
                    .sort(
                      (a, b) =>
                        a.direction.localeCompare(b.direction) ||
                        (sort.sort === "amount"
                          ? amountOrder(a, b) * (sort.order === "asc" ? 1 : -1)
                          : sort.compare(
                              sort.sort === "downloadedAt"
                                ? Boolean(a.downloadedAt).toString()
                                : a[sort.sort],
                              sort.sort === "downloadedAt"
                                ? Boolean(b.downloadedAt).toString()
                                : b[sort.sort],
                            )),
                    )
                    .map((r, index, sorted) => (
                      <Fragment key={r.id}>
                        {(index === 0 ||
                          sorted[index - 1].direction !== r.direction) && (
                          <tr>
                            <th colSpan={15}>
                              {r.direction === "in"
                                ? "Incoming"
                                : r.direction === "out"
                                  ? "Outgoing"
                                  : "Direction unresolved"}
                            </th>
                          </tr>
                        )}
                        <tr>
                          <td>
                            <Checkbox
                              aria-label={`Select ${r.number}`}
                              checked={selected.includes(r.id)}
                              onCheckedChange={(v) =>
                                setSelected((old) =>
                                  v
                                    ? [...old, r.id]
                                    : old.filter((id) => id !== r.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            {r.number}
                            {r.predecessorId && (
                              <small>Regenerated version</small>
                            )}
                          </td>
                          <td>{r.date || "Unverified"}</td>
                          <td>{r.transactionDate}</td>
                          <td>{new Date(r.createdAt).toLocaleString()}</td>
                          <td>
                            {companyName(
                              r.financialAccountId || r.companyId,
                              accounts,
                            )}
                          </td>
                          <td>{r.counterparty}</td>
                          <td>{r.reference}</td>
                          <td>{r.amount}</td>
                          <td>{r.currency}</td>
                          <td>{r.documentType.replaceAll("_", " ")}</td>
                          <td>{r.source}</td>
                          <td>
                            <StatusPill value={r.status} />
                          </td>
                          <td>{r.downloadedAt ? "Yes" : "No"}</td>
                          <td>
                            {r.file && (
                              <>
                                <a
                                  target="_blank"
                                  rel="noreferrer"
                                  href={`/api/statements${filePath(r)}`}
                                >
                                  View
                                </a>
                                <Button
                                  variant="ghost"
                                  onClick={() => void download([r])}
                                >
                                  Download
                                </Button>
                              </>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() => void action([r], "cancel")}
                            >
                              Cancel
                            </Button>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </section>
  );
}
