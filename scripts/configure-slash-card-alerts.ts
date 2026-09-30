import { spawnSync } from "node:child_process";
import { productionEnvironment } from "./deploy-production";
import { slashCardWebhookEvents } from "../shared/slashApi";

const env = productionEnvironment(process.env);
const selection = env.CONVEX_DEPLOY_KEY ? [] : ["--deployment", "famous-oyster-878"];
const token = spawnSync("npx", ["convex", "env", "get", "CONVEX_SERVICE_TOKEN", ...selection], {
  env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
});
if (token.error || token.status !== 0 || !token.stdout.trim()) throw new Error("Cannot read the production service token to configure Slash alerts");
const url = "https://finance.thatcanadian.dev/api/internal/slash/card-alerts";
for (const method of ["POST", "GET"]) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token.stdout.trim()}` }, signal: AbortSignal.timeout(60_000) });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(`Slash card webhook ${method === "POST" ? "setup" : "verification"} failed (${response.status}): ${JSON.stringify(value)}`);
  if (!value || typeof value !== "object" || !("status" in value) || value.status !== "active"
    || !("url" in value) || value.url !== "https://finance.thatcanadian.dev/api/slash/card-events"
    || !("enabledEvents" in value) || !Array.isArray(value.enabledEvents)) {
    throw new Error("Production Slash card webhook is not active with the required transaction events");
  }
  const enabledEvents = value.enabledEvents;
  if (!slashCardWebhookEvents.every((event) => enabledEvents.includes(event))) throw new Error("Production Slash card webhook is missing required transaction events");
  console.log(JSON.stringify({ event: method === "POST" ? "slash_card_alerts_configured" : "slash_card_alerts_verified", webhook: value }));
}
