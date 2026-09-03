import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const prompt = createInterface({ input: stdin, output: stdout });
const username = (await prompt.question("Transaction reviewer username: ")).trim().replace(/\s+/gu, " ");
const chatId = (await prompt.question("Telegram chat ID: ")).trim();
prompt.close();

if (!/^[a-z0-9][a-z0-9._ -]{0,63}$/iu.test(username)) {
  throw new Error("Username must be 1–64 letters, numbers, spaces, dots, underscores, or hyphens.");
}
if (!/^[1-9][0-9]{0,19}$/u.test(chatId)) throw new Error("Telegram chat ID is invalid.");

const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
  cwd: process.cwd(),
  encoding: "utf8",
  input: JSON.stringify({
    TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON: JSON.stringify({ [username]: chatId })
  }),
  stdio: ["pipe", "inherit", "inherit"]
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Wrangler exited with status ${result.status ?? "unknown"}.`);

console.log(`${username} can now sign in as a transaction reviewer. No Telegram code was disclosed.`);
