import { spawnSync } from "node:child_process";
import { contractsInbox } from "../shared/companyDocuments";

type Rule = { id: string; enabled: boolean; matchers: { type: string; field?: string; value?: string }[]; actions: { type: string; value?: string[] }[] };
const credentials = spawnSync("npx", ["wrangler", "auth", "token", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (credentials.error || credentials.status !== 0) throw new Error("Wrangler authentication is required to configure the contracts inbox");
const { token } = JSON.parse(credentials.stdout) as { token?: string };
if (!token) throw new Error("Cloudflare API token or OAuth login is required");
async function cloudflare<T>(path: string, payload?: unknown): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, { method: payload ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(30000) });
  const body = await response.json() as { success: boolean; result: T; errors?: { code: number; message: string }[] };
  if (!response.ok || !body.success) throw new Error(`Cloudflare email routing failed (${response.status}): ${body.errors?.map(e => e.message).join("; ") ?? "unknown error"}`);
  return body.result;
}
const zones = await cloudflare<{ id: string; name: string }[]>("zones?name=thatcanadian.dev");
if (zones.length !== 1 || zones[0].name !== "thatcanadian.dev") throw new Error("Cannot locate the finance domain's Cloudflare zone");
const path = `zones/${zones[0].id}/email/routing/rules`;
const matchingRules = (rules: Rule[]) => rules.filter(rule => rule.matchers.some(m => m.type === "literal" && m.field === "to" && m.value?.toLowerCase() === contractsInbox));
const correct = (rule: Rule) => rule.enabled && rule.actions.length === 1 && rule.actions[0].type === "worker" && rule.actions[0].value?.length === 1 && rule.actions[0].value[0] === "finance-dash";
const existing = matchingRules(await cloudflare<Rule[]>(`${path}?per_page=50`));
if (existing.length > 1 || existing.some(rule => !correct(rule))) throw new Error("The contracts address already has conflicting routing. Existing routes were preserved.");
if (!existing.length) await cloudflare<Rule>(path, { name: "Finance contract intake", enabled: true, matchers: [{ type: "literal", field: "to", value: contractsInbox }], actions: [{ type: "worker", value: ["finance-dash"] }] });
const verified = matchingRules(await cloudflare<Rule[]>(`${path}?per_page=50`));
if (verified.length !== 1 || !correct(verified[0])) throw new Error("Could not verify contracts email routing");
console.log(`Verified ${contractsInbox} → finance-dash`);
