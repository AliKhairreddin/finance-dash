import { readFile, stat, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import { productionEnvironment, productionServiceEnvironment } from "./deploy-production";

// The short-lived OAuth code is read from a protected file, never a command-line
// argument. Neither the code nor the refresh token is printed or saved in repo.
const file = process.argv[2];
if (!file) throw new Error("Pass the absolute path to a protected authorization-code file.");
if ((await stat(file)).mode & 0o077) throw new Error("Authorization-code file must have mode 600.");
const code = (await readFile(file, "utf8")).trim();
if (!code || code.length > 2000) throw new Error("Invalid authorization code file.");
const local = parse(await readFile(".env.local", "utf8"));
const env = productionServiceEnvironment(productionEnvironment({ ...local, ...process.env }));
const response = await fetch("https://finance.thatcanadian.dev/api/internal/revolut/authorize", { method: "POST", headers: { Authorization: `Bearer ${env.CONVEX_SERVICE_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error("Revolut code exchange failed. Start a fresh consent flow.");
const body = await response.json() as { refreshToken?: string };
if (!body.refreshToken) throw new Error("No refresh token was returned.");
const result = spawnSync("npx", ["wrangler", "secret", "put", "REVOLUT_REFRESH_TOKEN"], { env, input: body.refreshToken, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
if (result.status !== 0 || result.error) throw new Error("Could not install the Revolut refresh token. Repeat authorization after checking Cloudflare access.");
await unlink(file);
console.log("Revolut authorization installed in the production Worker. Credentials were not printed.");
