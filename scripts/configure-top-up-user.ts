import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
const prompt = createInterface({ input: stdin, output: stdout });
const chatId = (await prompt.question("Alaa's numeric Telegram chat ID: ")).trim(); prompt.close();
if (!/^[1-9][0-9]{0,19}$/u.test(chatId)) throw new Error("Telegram chat ID is invalid");
const result = spawnSync("npx", ["wrangler", "secret", "bulk"], { encoding: "utf8", input: JSON.stringify({ TELEGRAM_TOPUP_USERS_JSON: JSON.stringify({ Alaa: chatId }) }), stdio: ["pipe", "inherit", "inherit"] });
if (result.error || result.status !== 0) throw new Error("Could not configure Alaa's restricted sign-in");
console.log("Alaa can sign in with a Telegram code and access Top-up requests and Documents only.");
