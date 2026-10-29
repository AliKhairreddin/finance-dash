import { useStatementAccounts } from "./StatementAccountContext";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  statementCompanies,
  statementAccounts,
  statementContext,
} from "../../../shared/statements";
import type { MerchantSuggestion } from "../../../shared/statementIntelligence";
import {
  ErrorMessage,
  SelectField,
  StatementModal,
  SubmitButton,
  jsonRequest,
  statementRequest,
  useStatementSort,
  StatusPill,
} from "./StatementUi";
import { companyName } from "./StatementTransactions";
type Merchant = {
  _id: string;
  name: string;
  companyId: string;
  financialAccountId?: string;
  status: string;
  aliases: string[];
  suggestionJson?: string;
  approvedJson?: string;
  researchedAt?: number;
  error?: string;
};
export function MerchantIntelligence({
  company,
  revision,
  onSaved,
}: {
  company: string;
  revision: number;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Merchant[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Merchant | null>(null),
    [profile, setProfile] = useState<MerchantSuggestion | null>(null),
    [aliases, setAliases] = useState("");
  const sort = useStatementSort(
    "research",
    ["name", "companyId", "status", "researchedAt"] as const,
    "name",
    "asc",
  );
  useEffect(() => {
    const abort = new AbortController();
    void statementRequest<Merchant[]>("/merchants", { signal: abort.signal })
      .then(setRows)
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [revision]);
  const context = statementContext(company);
  const action = async (row: Merchant, decision: string) => {
    setBusy(true);
    setError("");
    try {
      await statementRequest(
        `/merchants/${row._id}`,
        jsonRequest("POST", {
          decision,
          ...(decision === "approve"
            ? {
                profile,
                aliases: aliases
                  .split("\n")
                  .map((a) => a.trim())
                  .filter(Boolean),
              }
            : {}),
        }),
      );
      onSaved();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research action failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="statement-panel">
      <div className="statement-section-heading">
        <h2>Merchant intelligence</h2>
      </div>
      <ErrorMessage error={error} />
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {sort.head("name", "Merchant")}
              {sort.head("companyId", "Company / account")}
              {sort.head("status", "Research status")}
              {sort.head("researchedAt", "Researched")}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter(
                (r) =>
                  (!context.companyId || r.companyId === context.companyId) &&
                  (!context.financialAccountId ||
                    r.financialAccountId === context.financialAccountId),
              )
              .sort((a, b) => sort.compare(a[sort.sort], b[sort.sort]))
              .map((r) => (
                <tr key={r._id}>
                  <td>{r.name}</td>
                  <td>{companyName(r.financialAccountId || r.companyId)}</td>
                  <td>
                    <StatusPill value={r.status} />
                    {r.error && <small>{r.error}</small>}
                  </td>
                  <td>
                    {r.researchedAt
                      ? new Date(r.researchedAt).toLocaleString()
                      : "Pending"}
                  </td>
                  <td>
                    {(r.suggestionJson || r.approvedJson) && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditing(r);
                          setProfile(
                            JSON.parse(r.suggestionJson || r.approvedJson!),
                          );
                          setAliases(r.aliases.join("\n"));
                        }}
                      >
                        Review sources
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void action(r, "research")}
                    >
                      Research
                    </Button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {editing && profile && (
        <StatementModal
          title={`Research · ${editing.name}`}
          busy={busy}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(editing, "approve");
            }}
          >
            <div className="statement-fields">
              {(
                [
                  "canonicalName",
                  "website",
                  "category",
                  "address",
                  "country",
                  "description",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {key}
                  <Textarea
                    value={profile[key]}
                    onChange={(e) =>
                      setProfile({ ...profile, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <SelectField
              label="Address type"
              value={profile.addressType}
              onChange={(v) =>
                setProfile({
                  ...profile,
                  addressType: v as MerchantSuggestion["addressType"],
                })
              }
              options={["unknown", "registered", "headquarters", "billing"].map(
                (value) => ({ value, label: value }),
              )}
            />
            <label>
              Approved merchant aliases
              <Textarea
                value={aliases}
                onChange={(e) => setAliases(e.target.value)}
              />
            </label>
            <p>Confidence: {Math.round(profile.confidence * 100)}%</p>
            {profile.conflicts.map((c) => (
              <p className="statement-warning" key={c}>
                {c}
              </p>
            ))}
            <ul>
              {profile.sources.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
            {profile.logoSource && (
              <p>
                Logo source (usage unapproved):{" "}
                <a href={profile.logoSource} target="_blank" rel="noreferrer">
                  View
                </a>
              </p>
            )}
            <ErrorMessage error={error} />
            <div className="statement-dialog-footer">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void action(editing, "discard")}
              >
                Discard suggestion
              </Button>
              <SubmitButton busy={busy}>Approve details</SubmitButton>
            </div>
          </form>
        </StatementModal>
      )}
    </section>
  );
}
type Policy = {
  companyId: string;
  financialAccountId?: string;
  settingsJson: string;
  revision: number;
};
type Member = {
  actor: string;
  companyIds: string[];
  accountIds: string[];
  permissions: string[];
  manage: boolean;
};
type Workspace = {
  accounts: Array<{
    key: string;
    companyId: string;
    name: string;
    provider: string;
    historical: boolean;
    verified: boolean;
    notes: string;
  }>;
  policies: Policy[];
  members: Member[];
  permissions: string[];
};
export function WorkspaceSettings({
  company,
  revision,
  onSaved,
}: {
  company: string;
  revision: number;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [member, setMember] = useState<Member | null>(null);
  const [scope, setScope] = useState(
      company === "all" ? "amg-holding" : company,
    ),
    [settings, setSettings] = useState<Record<string, string | boolean>>({});
  const accounts = useStatementAccounts();
  const account = accounts.find((a) => a.id === scope),
    context = account
      ? { companyId: account.companyId, financialAccountId: account.id }
      : statementContext(scope),
    policy = data?.policies.find(
      (p) =>
        p.companyId === context.companyId &&
        p.financialAccountId === context.financialAccountId,
    );
  const sort = useStatementSort(
    "accounts",
    ["name", "companyId", "provider", "verified"] as const,
    "name",
    "asc",
  );
  useEffect(() => {
    void statementRequest<Workspace>("/workspace/settings")
      .then(setData)
      .catch((e) => setError(e.message));
  }, [revision]);
  useEffect(() => {
    setSettings(policy ? JSON.parse(policy.settingsJson) : {});
  }, [policy]);
  const run = async (path: string, body: unknown) => {
    setBusy(true);
    setError("");
    try {
      await statementRequest(path, jsonRequest("POST", body));
      onSaved();
      setMember(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="statement-panel">
      <div className="statement-section-heading">
        <h2>Company and account settings</h2>
      </div>
      <ErrorMessage error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run("/workspace/policy", {
            ...context,
            settings,
            revision: policy?.revision ?? 0,
          });
        }}
      >
        <SelectField
          label="Settings context"
          value={scope}
          onChange={setScope}
          options={[...statementCompanies, ...accounts].map((c) => ({
            value: c.id,
            label: c.name,
          }))}
        />
        <div className="statement-fields">
          <SelectField
            label="Business category"
            value={String(settings.businessCategory ?? "")}
            onChange={(value) =>
              setSettings({ ...settings, businessCategory: value })
            }
            options={[
              { value: "", label: "Unverified" },
              ...[
                "corporate",
                "minimal",
                "technology",
                "insurance",
                "professional_services",
                "retail",
                "subscription",
              ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
            ]}
          />
          {[
            ["legalName", "Legal company name"],

            ["legalAddress", "Legal address"],
            ["senderName", "Document sender"],
            ["senderEmail", "Sender email"],
            ["bankDetails", "Bank details"],
            ["notes", "Company / account notes"],
            ["inboxKeywords", "Inbox keywords"],
            ["merchantAliases", "Merchant aliases (review required)"],
            ["taxPolicy", "Approved tax policy reference"],
            ["numberingPolicy", "Numbering policy reference"],
            ["automaticRulePolicy", "Approved automatic rule precedence"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <Textarea
                value={String(settings[key] ?? "")}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <fieldset>
          <legend>Automatic document rules</legend>
          <label>
            Exact merchant (optional)
            <Input
              value={String(settings.ruleMerchant ?? "")}
              onChange={(e) =>
                setSettings({ ...settings, ruleMerchant: e.target.value })
              }
            />
          </label>
          <SelectField
            label="Verified rule order"
            value={String(settings.ruleOrder ?? "")}
            onChange={(v) => setSettings({ ...settings, ruleOrder: v })}
            options={[
              { value: "", label: "Precedence unverified" },
              {
                value: "complete_then_request",
                label:
                  "Complete supported records, otherwise request generation",
              },
            ]}
          />
          {[
            [
              "rulePrecedenceVerified",
              "Legacy precedence verified against approved policy",
            ],
            [
              "automaticComplete",
              "Complete when reviewed documents cover the full amount",
            ],
            [
              "automaticRequest",
              "Automatically request eligible supporting documents",
            ],
          ].map(([key, label]) => (
            <label className="statement-checkbox" key={key}>
              <Checkbox
                checked={settings[key] === true}
                onCheckedChange={(v) =>
                  setSettings({ ...settings, [key]: Boolean(v) })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Sales invoice policy (legal company scope)</legend>
          <label className="statement-checkbox">
            <Checkbox
              checked={settings.salesInvoiceApproved === true}
              onCheckedChange={(v) =>
                setSettings({ ...settings, salesInvoiceApproved: Boolean(v) })
              }
            />
            Approve sales invoices for incoming transactions
          </label>
          <label>
            Configured tax percentage
            <Input
              inputMode="decimal"
              value={String(settings.taxRate ?? "")}
              onChange={(e) =>
                setSettings({ ...settings, taxRate: e.target.value })
              }
            />
          </label>
          <label>
            Verified VAT number (optional)
            <Input
              value={String(settings.vat ?? "")}
              onChange={(e) =>
                setSettings({ ...settings, vat: e.target.value })
              }
            />
          </label>
          <SelectField
            label="Invoice date policy"
            value={String(settings.invoiceDatePolicy ?? "")}
            onChange={(v) => setSettings({ ...settings, invoiceDatePolicy: v })}
            options={[
              { value: "", label: "Unverified" },
              { value: "transaction", label: "Transaction date" },
              { value: "generation", label: "Generation date" },
            ]}
          />
        </fieldset>
        <div className="statement-dialog-footer">
          <SubmitButton busy={busy}>Save settings</SubmitButton>
        </div>
      </form>
      {data && (
        <>
          <AddFinancialAccount
            busy={busy}
            save={(value) => run("/workspace/account", value)}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {sort.head("name", "Account")}
                  {sort.head("companyId", "Legal company")}
                  {sort.head("provider", "Provider")}
                  {sort.head("verified", "Verified mapping")}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {[...data.accounts]
                  .sort((a, b) =>
                    sort.compare(String(a[sort.sort]), String(b[sort.sort])),
                  )
                  .map((a) => (
                    <tr key={a.key}>
                      <td>{a.name}</td>
                      <td>{companyName(a.companyId)}</td>
                      <td>{a.provider}</td>
                      <td>{a.verified ? "Verified" : "Unverified"}</td>
                      <td>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run("/workspace/account", {
                              ...a,
                              verified: !a.verified,
                            })
                          }
                        >
                          {a.verified
                            ? "Mark unverified"
                            : "Confirm verified mapping"}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="statement-section-heading">
            <h3>Permissions</h3>
            {data.members.map((m) => (
              <Button
                key={m.actor}
                variant="outline"
                onClick={() => setMember(m)}
              >
                {m.actor}
              </Button>
            ))}
          </div>
        </>
      )}
      {member && data && (
        <StatementModal
          title={`Access · ${member.actor}`}
          busy={busy}
          onClose={() => setMember(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run("/workspace/member", {
                ...member,
                memberActor: member.actor,
              });
            }}
          >
            {(
              [
                [
                  "companyIds",
                  statementCompanies.map((c) => ({ id: c.id, name: c.name })),
                ],
                [
                  "accountIds",
                  data.accounts.map((a) => ({ id: a.key, name: a.name })),
                ],
                [
                  "permissions",
                  data.permissions.map((p) => ({ id: p, name: p })),
                ],
              ] as const
            ).map(([key, items]) => (
              <fieldset key={key}>
                <legend>{key}</legend>
                {items.map((item) => (
                  <label className="statement-checkbox" key={item.id}>
                    <Checkbox
                      checked={(member[key] ?? []).includes(item.id)}
                      onCheckedChange={(v) =>
                        setMember({
                          ...member,
                          [key]: v
                            ? [...(member[key] ?? []), item.id]
                            : (member[key] ?? []).filter((s) => s !== item.id),
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </fieldset>
            ))}
            <label className="statement-checkbox">
              <Checkbox
                checked={member.manage}
                onCheckedChange={(v) =>
                  setMember({ ...member, manage: Boolean(v) })
                }
              />
              Administrator
            </label>
            <ErrorMessage error={error} />
            <SubmitButton busy={busy}>Save permissions</SubmitButton>
          </form>
        </StatementModal>
      )}
    </section>
  );
}
export function DocumentDesigns({
  revision,
  onSaved,
}: {
  revision: number;
  onSaved: () => void;
}) {
  type Design = {
    companyId: string;
    design: null | {
      version?: number;
      locked?: boolean;
      style?: string;
      brandingAuthorized?: boolean;
      designJson: string;
    };
    versions: Array<{ version: number; style: string; createdAt: number }>;
  };
  const [rows, setRows] = useState<Design[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState("");
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    void statementRequest<Design[]>("/designs")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [revision]);
  return (
    <section className="statement-panel">
      <h2>Document designs</h2>
      <ErrorMessage error={error} />
      {rows.map((row) => (
        <form
          className="statement-fields"
          key={`${row.companyId}:${row.design?.version ?? 0}`}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(e.currentTarget);
            try {
              const file = form.get("logo") as File | null;
              let logoDataUrl: string | undefined;
              if (file?.size) {
                if (
                  file.size > 131072 ||
                  !["image/png", "image/jpeg"].includes(file.type)
                )
                  throw new Error("Choose a PNG or JPEG logo under 128 KB");
                const bytes = new Uint8Array(await file.arrayBuffer());
                let raw = "";
                for (const byte of bytes) raw += String.fromCharCode(byte);
                logoDataUrl = `data:${file.type};base64,${btoa(raw)}`;
              }
              if (form.get("removeLogo") === "on") logoDataUrl = "";
              await statementRequest(
                "/designs",
                jsonRequest("POST", {
                  companyId: row.companyId,
                  logoDataUrl,
                  style: form.get("style"),
                  accent: form.get("accent"),
                  locked: form.get("locked") === "on",
                  brandingAuthorized: form.get("brandingAuthorized") === "on",
                  expectedVersion: row.design?.version ?? 0,
                }),
              );
              onSaved();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Design save failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <strong>{companyName(row.companyId)}</strong>
          <label>
            Template
            <select
              name="style"
              defaultValue={row.design?.style ?? "corporate"}
            >
              {[
                "corporate",
                "minimal",
                "technology",
                "insurance",
                "professional_services",
                "retail",
                "subscription",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Brand color
            <Input
              name="accent"
              type="color"
              defaultValue={
                row.design
                  ? JSON.parse(row.design.designJson).accent
                  : "#7248b5"
              }
            />
          </label>
          <label>
            Company logo
            <Input name="logo" type="file" accept="image/png,image/jpeg" />
          </label>
          {row.design && JSON.parse(row.design.designJson).logoDataUrl && (
            <label>
              <input type="checkbox" name="removeLogo" />
              Remove uploaded logo
            </label>
          )}
          <label>
            <input
              type="checkbox"
              name="brandingAuthorized"
              defaultChecked={row.design?.brandingAuthorized}
            />
            Authorized company branding
          </label>
          <label>
            <input
              type="checkbox"
              name="locked"
              defaultChecked={row.design?.locked}
            />
            Lock design
          </label>
          <SubmitButton busy={busy}>Save version</SubmitButton>
          <Button
            type="button"
            variant="outline"
            disabled={!row.design || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch(
                  "/api/statements/created-invoices/design-preview",
                  jsonRequest("POST", { companyId: row.companyId }),
                );
                if (!response.ok)
                  throw new Error((await response.json()).message);
                setPreview(URL.createObjectURL(await response.blob()));
              } catch (e) {
                setError(e instanceof Error ? e.message : "Preview failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview saved design
          </Button>
          <details>
            <summary>Version history ({row.versions.length})</summary>
            {row.versions.map((v) => (
              <p key={v.version}>
                Version {v.version}: {v.style} ·{" "}
                {new Date(v.createdAt).toLocaleString()}
              </p>
            ))}
          </details>
        </form>
      ))}
      {preview && (
        <StatementModal
          title="Approved template preview"
          wide
          onClose={() => setPreview("")}
        >
          <iframe
            title="Template PDF"
            src={preview}
            className="statement-invoice-pdf"
          />
        </StatementModal>
      )}
    </section>
  );
}
export function StatementNotifications({ revision }: { revision: number }) {
  type Notice = {
    _id: string;
    message: string;
    dueAt: number;
    readAt?: number;
  };
  const [rows, setRows] = useState<Notice[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    void statementRequest<Notice[]>("/notifications")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [revision]);
  return (
    <section className="statement-panel">
      <h2>Reminders</h2>
      <ErrorMessage error={error} />
      {rows
        .filter((r) => !r.readAt)
        .map((r) => (
          <div className="statement-section-heading" key={r._id}>
            <span>
              {r.message} · {new Date(r.dueAt).toLocaleString()}
            </span>
            <Button
              variant="outline"
              onClick={() =>
                void statementRequest(`/notifications/${r._id}`, {
                  method: "POST",
                })
                  .then(() =>
                    setRows((old) => old.filter((n) => n._id !== r._id)),
                  )
                  .catch((e) => setError(e.message))
              }
            >
              Dismiss
            </Button>
          </div>
        ))}
    </section>
  );
}

export function TransactionReminder({
  transactionId,
  onClose,
  onSaved,
}: {
  transactionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [due, setDue] = useState(""),
    [message, setMessage] = useState("Follow up on missing financial document"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <StatementModal title="Set reminder" busy={busy} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await statementRequest(
              "/reminders",
              jsonRequest("POST", {
                transactionId,
                dueAt: new Date(due).getTime(),
                message,
              }),
            );
            onSaved();
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Reminder failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Remind me at
          <Input
            required
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <label>
          Reminder
          <Textarea
            required
            maxLength={500}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <ErrorMessage error={error} />
        <SubmitButton busy={busy}>Save reminder</SubmitButton>
      </form>
    </StatementModal>
  );
}

function AddFinancialAccount({
  busy,
  save,
}: {
  busy: boolean;
  save: (v: unknown) => Promise<void>;
}) {
  return (
    <details>
      <summary>Add financial account</summary>
      <form
        className="statement-fields"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget,
            data = new FormData(form);
          await save({
            key: data.get("key"),
            name: data.get("name"),
            companyId: data.get("companyId"),
            provider: data.get("provider"),
            historical: data.get("historical") === "on",
            verified: false,
            notes: "",
          });
        }}
      >
        <label>
          Account key
          <Input
            required
            name="key"
            pattern="[a-z0-9-]{1,80}"
            placeholder="company-bank-account"
          />
        </label>
        <label>
          Account name
          <Input required name="name" maxLength={100} />
        </label>
        <label>
          Legal company
          <select name="companyId">
            {statementCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bank / provider
          <Input required name="provider" maxLength={100} />
        </label>
        <label>
          <input type="checkbox" name="historical" />
          Historical account
        </label>
        <SubmitButton busy={busy}>Create unverified account</SubmitButton>
      </form>
    </details>
  );
}
