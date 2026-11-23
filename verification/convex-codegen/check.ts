import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../", import.meta.url));
const project = path.resolve("codegen-project");
const url = process.env.TEST_CONVEX_URL ?? "";
if (new URL(url).hostname !== "127.0.0.1" || !process.env.TEST_CONVEX_ADMIN_KEY) {
  throw new Error("Use verification/local-convex.sh to start a disposable Convex backend");
}
await mkdir(project);
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.name.startsWith(".") || entry.name === "dist") continue;
  if (entry.name === "convex" || entry.name === "convex.json" || entry.name === "package.json") {
    await cp(path.join(source, entry.name), path.join(project, entry.name), { recursive: true });
  } else if (entry.isDirectory() || entry.name === "node_modules") {
    await symlink(path.join(source, entry.name), path.join(project, entry.name));
  }
}
const generated = path.join("convex", "_generated");
await rm(path.join(project, generated), { recursive: true, force: true });
execFileSync(path.join(source, "node_modules/.bin/convex"), ["codegen", "--typecheck", "disable"], {
  cwd: project, stdio: "inherit",
  env: {
    PATH: process.env.PATH, CI: "1", CONVEX_PROVISION_HOST: url,
    CONVEX_SELF_HOSTED_URL: url, CONVEX_SELF_HOSTED_ADMIN_KEY: process.env.TEST_CONVEX_ADMIN_KEY,
  },
});
const comparison = spawnSync("diff", ["-ru", path.join(source, generated), path.join(project, generated)], { encoding: "utf8" });
if (comparison.error) throw comparison.error;
if (comparison.status !== 0) {
  process.stderr.write(comparison.stdout + comparison.stderr);
  throw new Error("Run npx convex codegen in the development checkout and commit the updated convex/_generated files.");
}
console.log("All committed Convex declarations and JavaScript match the official generator.");
