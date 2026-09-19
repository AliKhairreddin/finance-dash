import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";
import ts from "typescript";

export const productionDeployment = "prod:famous-oyster-878";
export const productionUrl = "https://famous-oyster-878.convex.cloud";

export function productionEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (input.CONVEX_DEPLOY_KEY && !input.CONVEX_DEPLOY_KEY.startsWith(`${productionDeployment}|`)) {
    throw new Error("CONVEX_DEPLOY_KEY must belong to production famous-oyster-878.");
  }
  for (const name of ["CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY", "CONVEX_DEPLOYMENT_TOKEN", "CONVEX_PROVISION_HOST"]) {
    if (input[name]) throw new Error(`${name} cannot override the production release target.`);
  }
  return {
    ...input,
    CONVEX_DEPLOYMENT: productionDeployment,
    CONVEX_URL: productionUrl,
    VITE_CONVEX_URL: productionUrl,
    // Never use a local development service token to verify production.
    CONVEX_SERVICE_TOKEN: undefined
  };
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}).`);
}

function verify(env: NodeJS.ProcessEnv): void {
  const selection = env.CONVEX_DEPLOY_KEY ? [] : ["--deployment", "famous-oyster-878"];
  const result = spawnSync("npx", ["convex", "env", "get", "CONVEX_SERVICE_TOKEN", ...selection], {
    env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0 || !result.stdout.trim()) {
    throw new Error("Could not read the production Convex service token. Check production access and environment configuration.");
  }
  run("npm", ["run", "ledger:verify"], { ...env, CONVEX_SERVICE_TOKEN: result.stdout.trim() });
}

function main(): void {
  const mode = process.argv[2];
  if (!["all", "convex", "cloudflare", "verify"].includes(mode)) throw new Error("Choose all, convex, cloudflare, or verify.");
  const local = Object.assign({}, ...[".env", ".env.local"].map(file => existsSync(file) ? parse(readFileSync(file)) : {}));
  const env = productionEnvironment({ ...local, ...process.env });
  const selectors = parse(readFileSync(".env.production"));
  if (selectors.CONVEX_DEPLOYMENT !== productionDeployment || selectors.CONVEX_URL !== productionUrl || selectors.VITE_CONVEX_URL !== productionUrl) {
    throw new Error(".env.production must select production famous-oyster-878.");
  }
  const workerConfig = ts.parseConfigFileTextToJson("wrangler.jsonc", readFileSync("wrangler.jsonc", "utf8"));
  if (workerConfig.error || workerConfig.config?.vars?.CONVEX_URL !== productionUrl) {
    throw new Error("The live Cloudflare Worker must connect to production famous-oyster-878.");
  }
  console.log(`Production target: ${productionUrl}`);
  if (mode === "all" || mode === "cloudflare") run("npm", ["run", "build"], env);
  if (mode === "all" || mode === "convex") run("npx", ["convex", "deploy", "--env-file", ".env.production"], env);
  if (mode !== "convex") verify(env);
  if (mode === "all" || mode === "cloudflare") run("npx", ["wrangler", "deploy"], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
