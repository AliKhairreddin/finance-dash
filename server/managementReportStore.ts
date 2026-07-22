import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function managementReportPath(): string {
  return resolve(process.cwd(), ".local", "management-report.json");
}

export async function loadManagementReportDashboard(): Promise<unknown | null> {
  try {
    const raw = await readFile(managementReportPath(), "utf8");
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveManagementReportDashboard(value: unknown): Promise<void> {
  const path = managementReportPath();
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}
