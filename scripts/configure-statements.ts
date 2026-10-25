import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolveMx } from "node:dns/promises";
import { parse } from "dotenv";
import { productionEnvironment, productionServiceEnvironment } from "./deploy-production";
import { statementCompanies } from "../shared/statements";

const hostname = "statements.thatcanadian.dev";
const inbox = "statements@finance.thatcanadian.dev";
const credentials = spawnSync("npx", ["wrangler", "auth", "token", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (credentials.error || credentials.status !== 0) throw new Error("Wrangler authentication is required to configure the statements inbox");
const { token } = JSON.parse(credentials.stdout) as { token?: string };
if (!token) throw new Error("Cloudflare API token or OAuth login is required");
type Rule = { id: string; enabled: boolean; matchers: { type: string; field?: string; value?: string }[]; actions: { type: string; value?: string[] }[] };
async function cloudflare<T>(path: string, payload?: unknown): Promise<{ result: T; result_info?: { total_pages?: number } }> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/${path}`, { method: payload ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(30_000) });
  const body = await response.json() as { success: boolean; result: T; result_info?: { total_pages?: number }; errors?: { message: string }[] };
  if (!response.ok || !body.success) throw new Error(`Cloudflare statements configuration failed (${response.status}): ${body.errors?.map(error => error.message).join("; ") ?? "unknown error"}`);
  return body;
}
const { result: zones } = await cloudflare<{ id: string; name: string }[]>("zones?name=thatcanadian.dev");
if (zones.length !== 1 || zones[0].name !== "thatcanadian.dev") throw new Error("Cannot locate thatcanadian.dev in Cloudflare");
const path = `zones/${zones[0].id}/email/routing/rules`;
async function allRules() {
  const rules: Rule[] = [];
  for (let page = 1; page <= 100; page++) {
    const body = await cloudflare<Rule[]>(`${path}?per_page=50&page=${page}`);
    rules.push(...body.result);
    if (body.result_info?.total_pages ? page >= body.result_info.total_pages : body.result.length < 50) return rules;
  }
  throw new Error("Email routing pagination exceeded its safety limit");
}
const matching = (rules: Rule[]) => rules.filter(rule => rule.matchers.some(item => item.type === "literal" && item.field === "to" && item.value?.toLowerCase() === inbox));
const correct = (rule: Rule) => rule.enabled && rule.actions.length === 1 && rule.actions[0].type === "worker" && rule.actions[0].value?.length === 1 && rule.actions[0].value[0] === "finance-dash";
const existing = matching(await allRules());
if (existing.length > 1 || existing.some(rule => !correct(rule))) throw new Error("The statements address has conflicting routing. Existing rules were preserved.");
if (!existing.length) await cloudflare(path, { name: "Statement dashboard intake", enabled: true, matchers: [{ type: "literal", field: "to", value: inbox }], actions: [{ type: "worker", value: ["finance-dash"] }] });
const verified = matching(await allRules());
if (verified.length !== 1 || !correct(verified[0])) throw new Error("Could not verify statement email routing");
// Public DNS is authoritative here; email-routing credentials need not carry
// broad DNS-edit/read permissions simply to verify existing mail records.
const mx = await resolveMx("finance.thatcanadian.dev");
if (!mx.length || !mx.every(record => record.exchange.replace(/\.$/, "").endsWith("mx.cloudflare.net"))) throw new Error("The finance subdomain's inbound MX records are missing or use a different mail service");
const env = productionServiceEnvironment(productionEnvironment({ ...(existsSync(".env.local") ? parse(readFileSync(".env.local")) : {}), ...process.env }));
const response = await fetch(`https://${hostname}/api/internal/statements/setup`, { method: "POST", headers: { Authorization: `Bearer ${env.CONVEX_SERVICE_TOKEN}` }, signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw new Error(`Statement setup returned ${response.status}`);
const result = await response.json() as { companies: { id: string; name: string }[]; cards: { companyId: string; lastFour: string }[]; users: string[]; model: string; zdr: boolean };
if (JSON.stringify(result.companies) !== JSON.stringify(statementCompanies)) throw new Error("Statement company configuration does not match the six requested companies");
if (["Ali", "Ali M", "Alaa"].some(user => !result.users.includes(user))) throw new Error("One or more requested Telegram sign-in users are missing");
if (!result.model || result.zdr !== true) throw new Error("The saved AI model or ZDR requirement could not be verified");
const login = await fetch(`https://${hostname}/`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
if (login.status !== 303 || !login.headers.get("Location")?.startsWith("/login")) throw new Error("Statement HTTPS sign-in gate did not respond as expected");
const isolated = await fetch(`https://${hostname}/api/snapshot`, { signal: AbortSignal.timeout(30_000) });
if (isolated.status !== 404) throw new Error("Statement host unexpectedly exposes a finance API route");
console.log(JSON.stringify({ hostname, inbox, users: result.users, companies: result.companies.map(company => company.name), model: result.model, zdr: result.zdr, emailRouting: "verified", https: "verified", financeApiIsolation: "verified" }, null, 2));
