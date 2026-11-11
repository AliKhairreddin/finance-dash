import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createStatementPassword } from "../worker/statementPassword";

const output = process.argv[2];
if (!output) throw new Error("Provide a private output filename outside the repository for the new passwords.");
const filename = resolve(output);
if (filename.startsWith(`${process.cwd()}/`)) throw new Error("Save passwords outside the repository.");
const users = ["Ali M", "Alaa"].map(username => ({ username, password: randomBytes(18).toString("base64url") }));
const credentials = Object.fromEntries(await Promise.all(users.map(async user => [user.username.toLowerCase(), await createStatementPassword(user.password)])));
mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
// Refuse to overwrite a prior delivery. No passwords or hashes go to stdout.
writeFileSync(filename, JSON.stringify({ loginUrls: ["https://statements.thatcanadian.dev/login", "https://finance.thatcanadian.dev/login"], users }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const result = spawnSync("npx", ["wrangler", "secret", "put", "STATEMENT_PASSWORD_USERS_JSON"], {
  input: JSON.stringify(credentials), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]
});
if (result.error || result.status !== 0) throw new Error(`Password hash upload failed. The private password file is preserved at ${filename}.`);
console.log(`Configured Finance and Statements password hashes for Ali M and Alaa. Private password file: ${filename}`);
