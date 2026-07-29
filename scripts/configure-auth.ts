import { pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

// Cloudflare Workers supports PBKDF2 iteration counts up to 100,000.
const PASSWORD_ITERATIONS = 100_000;

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Authentication setup must run in an interactive terminal.");
  }

  stdout.write(prompt);
  stdin.setEncoding("utf8");
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Authentication setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    };
    stdin.on("data", onData);
  });
}

const prompt = createInterface({ input: stdin, output: stdout });
const username = (await prompt.question("Authentication username: ")).trim();
prompt.close();
if (!username) throw new Error("Username is required.");

const password = await readHidden("Authentication password (input hidden): ");
if (password.length < 12) throw new Error("Password must be at least 12 characters.");

const salt = randomBytes(16);
const passwordHash = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
const verifier = [
  "pbkdf2-sha256",
  PASSWORD_ITERATIONS,
  salt.toString("base64url"),
  passwordHash.toString("base64url")
].join("$");

const secrets = JSON.stringify({
  AUTH_USERNAME: username,
  AUTH_PASSWORD_HASH: verifier,
  AUTH_SESSION_SECRET: randomBytes(32).toString("base64url")
});
const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
  cwd: process.cwd(),
  encoding: "utf8",
  input: secrets,
  stdio: ["pipe", "inherit", "inherit"]
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Wrangler exited with status ${result.status ?? "unknown"}.`);

console.log("Authentication secrets configured. The password and derived values were not printed or written to disk.");
