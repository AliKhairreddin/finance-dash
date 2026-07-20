import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  AutomationRun,
  FxRate,
  Holding,
  Invoice,
  PaymentAllocation,
  PersistedAiSettings,
  Provider,
  RevenueAccrual,
  RevenuePartner,
  RevenueRun,
  ProfitDistributionAdjustment,
  Team,
  Transaction,
  TransactionCategoryRule,
  TransactionTeamAssignment,
  WiseCardHolderTeamAssignment,
  WiseStatementImport
} from "../shared/types";

function storePath(): string {
  return resolve(process.cwd(), ".local", "finance-dashboard-store.json");
}

export interface PersistedState {
  providers: Provider[];
  invoices: Invoice[];
  paymentAllocations: PaymentAllocation[];
  holdings: Holding[];
  fxRates: FxRate[];
  automationRuns: AutomationRun[];
  teams: Team[];
  transactionCategoryRules: TransactionCategoryRule[];
  revenuePartners: RevenuePartner[];
  transactionTeamAssignments: TransactionTeamAssignment[];
  wiseCardHolderTeamAssignments: WiseCardHolderTeamAssignment[];
  transactions: Transaction[];
  wiseStatementTransactions: Transaction[];
  wiseStatementImports: WiseStatementImport[];
  revenueRuns: RevenueRun[];
  revenueAccruals: RevenueAccrual[];
  profitDistributionAdjustments: ProfitDistributionAdjustment[];
  aiSettings?: PersistedAiSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function sanitizePersistedState(value: unknown): Partial<PersistedState> {
  if (!isRecord(value)) throw new Error("Dashboard state must be a JSON object");
  if (value.aiSettings === undefined) return value as Partial<PersistedState>;
  if (!isRecord(value.aiSettings) || value.aiSettings.provider !== "openrouter" || typeof value.aiSettings.model !== "string") {
    throw new Error("Stored AI settings are invalid");
  }
  if (value.aiSettings.updatedAt !== undefined && typeof value.aiSettings.updatedAt !== "string") {
    throw new Error("Stored AI settings updatedAt must be a string");
  }

  return {
    ...value,
    aiSettings: {
      provider: "openrouter",
      model: value.aiSettings.model,
      updatedAt: value.aiSettings.updatedAt
    }
  } as Partial<PersistedState>;
}

export async function loadPersistedState(): Promise<Partial<PersistedState>> {
  try {
    const path = storePath();
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const sanitized = sanitizePersistedState(parsed);
    if (isRecord(parsed) && isRecord(parsed.aiSettings) && Object.prototype.hasOwnProperty.call(parsed.aiSettings, "openRouterApiKey")) {
      await writeFile(path, JSON.stringify(sanitized, null, 2), "utf8");
    }
    return sanitized;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  const path = storePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}
