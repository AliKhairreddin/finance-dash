import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Invoice, Provider } from "../shared/types";

const storePath = resolve(process.cwd(), ".local", "finance-dashboard-store.json");

export interface PersistedState {
  providers: Provider[];
  invoices: Invoice[];
}

export async function loadPersistedState(): Promise<Partial<PersistedState>> {
  try {
    const raw = await readFile(storePath, "utf8");
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return {};
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(state, null, 2), "utf8");
}
