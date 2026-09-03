import cors from "cors";
import "dotenv/config";
import express from "express";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import type {
  AssignTransactionTeamPayload,
  AiPromptPayload,
  AutoCategorizeTransactionsPayload,
  BulkRecordInvoicePaymentsPayload,
  BankTransactionSource,
  CreateExpensePayload,
  CreateHoldingPayload,
  CreateInvoicePayload,
  CreateManualReceivablePayload,
  CreateProviderPayload,
  CreateRevenuePartnerPayload,
  CreateTeamPayload,
  CreateTransactionCategoryPayload,
  DeleteInvoicesPayload,
  Direction,
  DraftRevenueRunPayload,
  ImportWiseStatementPayload,
  MatchTransactionPayload,
  MatchInvoicePaymentPayload,
  MatchExpensePaymentPayload,
  RecordInvoicePaymentPayload,
  SaveProfitDistributionAdjustmentPayload,
  SaveAiSettingsPayload,
  SaveCashFlowSnapshotPayload,
  SendInvoicesPayload,
  SyncRevenuePayload,
  TransactionMatchFilter,
  TransactionSortKey,
  UpdateHoldingPayload,
  UpdateInvoicePayload,
  UpdateTransactionCategoryDefinitionPayload,
  UpdateTransactionCategoryPayload,
  UpdateRevenuePartnerPayload
} from "../shared/types";
import type {
  AssignMediaFundingTargetsPayload,
  CreateMediaFundingEntryPayload,
  CreateMediaFundingProviderPayload,
  MediaFundingMutationResult,
  UpdateMediaFundingProviderPayload
} from "../shared/mediaFunding";
import {
  mediaSpendMaximumResultRows,
  summarizeMediaSpend,
  validateMediaSpendDateRange,
  type MediaSpendApiResponse,
  type MediaSpendRow
} from "../shared/mediaSpend";
import { parseSlashTransactionDateRange } from "../shared/slashApi";
import { transactionBusinessCategory } from "../shared/categories";
import { financeOperatingDate } from "../shared/operatingDate";
import { transactionReviewBootstrap } from "../shared/transactionReview";
import {
  assignTransactionTeam,
  autoMatchInvoicePayments,
  autoCategorizeTransactions,
  createExpense,
  createHolding,
  createInvoice,
  createManualReceivable,
  createProvider,
  createRevenuePartner,
  createTeam,
  createTransactionCategory,
  deleteInvoiceDrafts,
  deleteProvider,
  deleteRevenuePartner,
  deleteTransactionCategoryDefinition,
  deleteHolding,
  deleteManualReceivable,
  downloadInvoicePdf,
  draftRevenueRun,
  getSnapshot,
  getBankActivitySummary,
  getTransactionPage,
  getInvoicePaymentCandidates,
  getOpenRouterZdrModels,
  expenseDocumentById,
  getAnalyticsCategoryCompaniesPage,
  getAnalyticsSnapshot,
  initializeStore,
  importWiseStatement,
  matchTransaction,
  matchExpensePayment,
  previewInvoiceDuplicate,
  matchInvoicePayment,
  recordBulkInvoicePayments,
  recordInvoicePayment,
  refreshFxRates,
  runIncomeAutomation,
  runAiPrompt,
  saveAiSettings,
  saveCashFlowSnapshot,
  saveProfitDistributionAdjustment,
  sendInvoices,
  syncExternalActivity,
  syncRevenue,
  updateTransactionCategory,
  updateTransactionCategoryDefinition,
  updateHolding,
  updateInvoice,
  updateProvider,
  updateRevenuePartner
} from "./store";
import {
  readLocalExpenseDocument,
  saveLocalExpenseDocument
} from "./expenseDocuments";
import { loadManagementReportDashboard } from "./managementReportStore";

const app = express();
const port = Number(process.env.PORT ?? 8787);

class ClientRequestError extends Error {}

function localConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL?.trim();
  if (!url) throw new Error("Dashboard storage is not configured");
  return new ConvexHttpClient(url);
}

function localConvexServiceToken(): string {
  const token = process.env.CONVEX_SERVICE_TOKEN?.trim();
  if (!token) throw new Error("Dashboard storage authentication is not configured");
  return token;
}

function localIsoDateShift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localMediaSpendDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (let date = fromDate; date <= toDate; date = localIsoDateShift(date, 1)) dates.push(date);
  return dates;
}

async function readLocalMediaSpendRange(
  fromDate: string,
  toDate: string
): Promise<Pick<MediaSpendApiResponse, "rows" | "summary" | "sync">> {
  const convex = localConvexClient();
  const serviceToken = localConvexServiceToken();
  const includeZeroSpend = fromDate === toDate;
  const syncPromise = convex.query(api.mediaSpend.getSyncState, { serviceToken });
  const dates = localMediaSpendDates(fromDate, toDate);
  const rows: MediaSpendRow[] = [];
  let reportedDays = 0;
  for (let index = 0; index < dates.length; index += 6) {
    const results = await Promise.all(dates.slice(index, index + 6).map((date) =>
      convex.query(api.mediaSpend.listDate, { serviceToken, date, includeZeroSpend })
    ));
    for (const result of results) {
      if (result.storedRowCount > 0) reportedDays += 1;
      rows.push(...result.rows);
      if (rows.length > mediaSpendMaximumResultRows) {
        throw new ClientRequestError(
          `Media spend period exceeds ${mediaSpendMaximumResultRows.toLocaleString("en-US")} active account-day rows; choose a shorter period`
        );
      }
    }
  }
  const summary = summarizeMediaSpend(rows);
  summary.days = reportedDays;
  return {
    rows,
    summary,
    sync: (await syncPromise) ?? { status: "never" }
  };
}

async function rebuildLocalMediaFunding(range: MediaFundingMutationResult): Promise<void> {
  if (!range.rebuildFrom || !range.rebuildTo) return;
  const convex = localConvexClient();
  const serviceToken = localConvexServiceToken();
  const updatedAt = new Date().toISOString();
  for (let date = range.rebuildFrom; date <= range.rebuildTo; date = localIsoDateShift(date, 1)) {
    await convex.mutation(api.mediaFunding.rebuildDate, { serviceToken, date, updatedAt });
  }
}

app.use(cors());
app.post(
  "/api/expense-documents/upload",
  express.raw({ type: ["application/pdf", "image/jpeg", "image/png", "image/webp"], limit: "10mb" }),
  async (request, response, next) => {
    try {
      const contentType = request.headers["content-type"]?.split(";")[0]?.trim() ?? "";
      const encodedName = typeof request.headers["x-file-name"] === "string" ? request.headers["x-file-name"] : "";
      const fileName = encodedName ? decodeURIComponent(encodedName) : "expense-document";
      if (!Buffer.isBuffer(request.body)) throw new Error("Expense document body is required");
      const storageId = await saveLocalExpenseDocument(request.body, fileName, contentType);
      response.status(201).json({ storageId, size: request.body.byteLength });
    } catch (error) {
      next(error);
    }
  }
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "finance-dash-api", time: new Date().toISOString() });
});

app.get("/api/session", (_request, response) => {
  response.json({ username: "Local developer", role: "administrator" });
});

app.get("/api/transaction-review", (_request, response) => {
  response.json(transactionReviewBootstrap(getSnapshot()));
});

app.get("/api/dashboard", (_request, response) => {
  response.json(getSnapshot());
});

app.get("/api/media-spend", async (request, response, next) => {
  try {
    const fromDate = typeof request.query.fromDate === "string" ? request.query.fromDate : "";
    const toDate = typeof request.query.toDate === "string" ? request.query.toDate : "";
    try {
      validateMediaSpendDateRange(fromDate, toDate);
    } catch (error) {
      response.status(400).json({
        message: error instanceof Error ? error.message : "Media spend date range is invalid"
      });
      return;
    }
    const result = await readLocalMediaSpendRange(fromDate, toDate);
    const payload: MediaSpendApiResponse = {
      version: 1,
      fromDate,
      toDate,
      currency: "USD",
      configured: false,
      missingConfiguration: ["LemonMax sync is available from the deployed dashboard"],
      rows: result.rows,
      summary: result.summary,
      sync: result.sync
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/media-funding", async (_request, response, next) => {
  try {
    response.json(await localConvexClient().query(api.mediaFunding.listOverview, {
      serviceToken: localConvexServiceToken()
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/media-funding/providers", async (request, response, next) => {
  try {
    const payload = request.body as CreateMediaFundingProviderPayload;
    const id = await localConvexClient().mutation(api.mediaFunding.createProvider, {
      serviceToken: localConvexServiceToken(),
      ...payload,
      createdAt: new Date().toISOString()
    });
    response.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/media-funding/providers/:providerId", async (request, response, next) => {
  try {
    const payload = request.body as UpdateMediaFundingProviderPayload;
    await localConvexClient().mutation(api.mediaFunding.updateProvider, {
      serviceToken: localConvexServiceToken(),
      providerId: request.params.providerId as Id<"mediaFundingProviders">,
      ...payload,
      updatedAt: new Date().toISOString()
    });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/media-funding/providers/:providerId", async (request, response, next) => {
  try {
    await localConvexClient().mutation(api.mediaFunding.deleteProvider, {
      serviceToken: localConvexServiceToken(),
      providerId: request.params.providerId as Id<"mediaFundingProviders">
    });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/media-funding/entries", async (request, response, next) => {
  try {
    const payload = request.body as CreateMediaFundingEntryPayload;
    const id = await localConvexClient().mutation(api.mediaFunding.createEntry, {
      serviceToken: localConvexServiceToken(),
      providerId: payload.providerId as Id<"mediaFundingProviders">,
      type: payload.type,
      date: payload.date,
      adjustmentAmount: payload.adjustmentAmount,
      note: payload.note,
      createdAt: new Date().toISOString()
    });
    response.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/media-funding/entries/:entryId", async (request, response, next) => {
  try {
    await localConvexClient().mutation(api.mediaFunding.deleteEntry, {
      serviceToken: localConvexServiceToken(),
      entryId: request.params.entryId as Id<"mediaFundingEntries">,
      updatedAt: new Date().toISOString()
    });
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/media-funding/assignments", async (request, response, next) => {
  try {
    const payload = request.body as AssignMediaFundingTargetsPayload;
    const result = await localConvexClient().mutation(api.mediaFunding.assignTargets, {
      serviceToken: localConvexServiceToken(),
      providerId: payload.providerId as Id<"mediaFundingProviders">,
      effectiveFrom: payload.effectiveFrom,
      targets: payload.targets,
      updatedAt: new Date().toISOString()
    });
    await rebuildLocalMediaFunding(result);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/media-funding/assignments/:assignmentId", async (request, response, next) => {
  try {
    const result = await localConvexClient().mutation(api.mediaFunding.deleteAssignment, {
      serviceToken: localConvexServiceToken(),
      assignmentId: request.params.assignmentId as Id<"mediaFundingAssignments">
    });
    await rebuildLocalMediaFunding(result);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/analytics", (request, response, next) => {
  try {
    const fromDate = typeof request.query.fromDate === "string" ? request.query.fromDate : "";
    const toDate = typeof request.query.toDate === "string" ? request.query.toDate : "";
    const today = financeOperatingDate();
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
      || fromDate > toDate
      || toDate > today
    ) {
      response.status(400).json({ message: "Analytics date range is invalid" });
      return;
    }
    response.json(getAnalyticsSnapshot(fromDate, toDate));
  } catch (error) {
    next(error);
  }
});

app.get("/api/analytics/category-companies", (request, response, next) => {
  try {
    const fromDate = typeof request.query.fromDate === "string" ? request.query.fromDate : "";
    const toDate = typeof request.query.toDate === "string" ? request.query.toDate : "";
    const today = financeOperatingDate();
    const direction = request.query.direction;
    const currency = typeof request.query.currency === "string" ? request.query.currency.trim().toUpperCase() : "";
    const rawCategory = typeof request.query.category === "string" ? request.query.category.trim() : "";
    const category = transactionBusinessCategory(rawCategory);
    const rawLimit = typeof request.query.limit === "string" ? request.query.limit : "200";
    const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
      || fromDate > toDate
      || toDate > today
      || (direction !== "in" && direction !== "out")
      || !/^[A-Z0-9]{2,12}$/.test(currency)
      || !rawCategory
      || category.length > 160
      || limit < 1
      || limit > 200
    ) {
      response.status(400).json({ message: "Analytics category selection is invalid" });
      return;
    }
    response.json(getAnalyticsCategoryCompaniesPage({
      fromDate,
      toDate,
      direction,
      currency,
      category,
      cursor: typeof request.query.cursor === "string" && request.query.cursor ? request.query.cursor : null,
      limit
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/management-report", async (_request, response, next) => {
  try {
    response.json(await loadManagementReportDashboard());
  } catch (error) {
    next(error);
  }
});

app.post("/api/sync", async (request, response, next) => {
  try {
    const slashFromDate = typeof request.query.slashFromDate === "string" ? request.query.slashFromDate : undefined;
    const slashToDate = typeof request.query.slashToDate === "string" ? request.query.slashToDate : undefined;
    response.json(await syncExternalActivity(parseSlashTransactionDateRange(slashFromDate, slashToDate)));
  } catch (error) {
    next(error);
  }
});

function localTransactionPageOptions(request: express.Request): Parameters<typeof getTransactionPage>[0] {
    const fromDate = typeof request.query.fromDate === "string" ? request.query.fromDate : "";
    const toDate = typeof request.query.toDate === "string" ? request.query.toDate : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate) || fromDate > toDate || toDate > financeOperatingDate()) {
      throw new ClientRequestError("Transaction date range is invalid");
    }
    const rawSource = typeof request.query.source === "string" ? request.query.source : undefined;
    if (rawSource && rawSource !== "wise" && rawSource !== "revolut" && rawSource !== "slash" && rawSource !== "amex") {
      throw new ClientRequestError("Transaction source is invalid");
    }
    const source: BankTransactionSource | undefined =
      rawSource === "wise" || rawSource === "revolut" || rawSource === "slash" || rawSource === "amex"
        ? rawSource
        : undefined;
    const rawDirection = typeof request.query.direction === "string" ? request.query.direction : undefined;
    if (rawDirection && rawDirection !== "in" && rawDirection !== "out") {
      throw new ClientRequestError("Transaction direction is invalid");
    }
    const direction: Direction | undefined = rawDirection === "in" || rawDirection === "out" ? rawDirection : undefined;
    const order = request.query.order === "asc" ? "asc" : "desc";
    const rawLimit = typeof request.query.limit === "string" ? request.query.limit : "200";
    const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > 200) {
      throw new ClientRequestError("Transaction limit must be between 1 and 200");
    }
    const cursor = typeof request.query.cursor === "string" && request.query.cursor ? request.query.cursor : null;
    const wiseEntity = request.query.wiseEntity;
    if (wiseEntity !== undefined && wiseEntity !== "dn" && wiseEntity !== "lmd") {
      throw new ClientRequestError("Transaction Wise entity is invalid");
    }
    const match = typeof request.query.match === "string" ? request.query.match : "all";
    if (match !== "all" && match !== "matched" && match !== "needs-review") {
      throw new ClientRequestError("Transaction category status is invalid");
    }
    const sortKey = typeof request.query.sort === "string" ? request.query.sort : "date";
    const sortKeys: readonly TransactionSortKey[] = ["account", "amount", "category", "company", "counterparty", "date", "direction", "document", "match", "period", "source", "team"];
    if (!sortKeys.includes(sortKey as TransactionSortKey)) throw new ClientRequestError("Transaction sort is invalid");
    const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
    const accountId = typeof request.query.accountId === "string" ? request.query.accountId.trim() : "";
    const category = typeof request.query.category === "string" ? request.query.category.trim() : "";
    const team = typeof request.query.team === "string" ? request.query.team.trim() : "";
    const rawGroupType = typeof request.query.groupType === "string" ? request.query.groupType.trim() : "";
    const groupKey = typeof request.query.groupKey === "string" ? request.query.groupKey.trim() : "";
    if (rawGroupType && rawGroupType !== "merchant" && rawGroupType !== "card" && rawGroupType !== "account") {
      throw new ClientRequestError("Transaction group type is invalid");
    }
    if (Boolean(rawGroupType) !== Boolean(groupKey) || groupKey.length > 512) {
      throw new ClientRequestError("Transaction group filter is invalid");
    }
    return {
      fromDate,
      toDate,
      ...(source ? { source } : {}),
      ...(direction ? { direction } : {}),
      ...(wiseEntity ? { wiseEntity } : {}),
      ...(accountId ? { accountId } : {}),
      ...(category ? { category } : {}),
      ...(team ? { team } : {}),
      ...(rawGroupType ? { groupType: rawGroupType as "merchant" | "card" | "account", groupKey } : {}),
      ...(search ? { search } : {}),
      match: match as TransactionMatchFilter,
      sortKey: sortKey as TransactionSortKey,
      order,
      cursor,
      limit
    };
}

app.get("/api/transactions", (request, response, next) => {
  try {
    response.json(getTransactionPage(localTransactionPageOptions(request)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/transactions/summary", (request, response, next) => {
  try {
    response.json(getBankActivitySummary(localTransactionPageOptions(request)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/invoice-payment-candidates", (request, response, next) => {
  try {
    const currency = typeof request.query.currency === "string" ? request.query.currency.trim().toUpperCase() : "";
    if (!currency) {
      response.status(400).json({ message: "Invoice payment candidate currency is required" });
      return;
    }
    const rawLimit = typeof request.query.limit === "string" ? request.query.limit : "200";
    const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : 0;
    if (limit < 1 || limit > 200) {
      response.status(400).json({ message: "Transaction limit must be between 1 and 200" });
      return;
    }
    const cursor = typeof request.query.cursor === "string" && request.query.cursor ? request.query.cursor : null;
    response.json(getInvoicePaymentCandidates(currency, cursor, limit));
  } catch (error) {
    next(error);
  }
});

app.post("/api/wise/import-statement", async (request, response, next) => {
  try {
    response.json(await importWiseStatement(request.body as ImportWiseStatementPayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/revenue/sync", async (request, response, next) => {
  try {
    response.json(await syncRevenue(request.body as SyncRevenuePayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/revenue/draft", async (request, response, next) => {
  try {
    response.status(201).json(await draftRevenueRun(request.body as DraftRevenueRunPayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/revenue/automation", async (request, response, next) => {
  try {
    const scheduledTime = request.body?.scheduledTime ? new Date(String(request.body.scheduledTime)) : new Date();
    if (!Number.isFinite(scheduledTime.getTime())) {
      response.status(400).json({ message: "scheduledTime is invalid" });
      return;
    }
    response.json(await runIncomeAutomation(scheduledTime, request.body?.force === true));
  } catch (error) {
    next(error);
  }
});

app.post("/api/providers", async (request, response, next) => {
  try {
    const payload = request.body as CreateProviderPayload;
    if (!payload.name?.trim()) {
      response.status(400).json({ message: "Company name is required" });
      return;
    }
    response.status(201).json(await createProvider(payload));
  } catch (error) {
    next(error);
  }
});

app.put("/api/providers/:providerId", async (request, response, next) => {
  try {
    const payload = request.body as CreateProviderPayload;
    if (!payload.name?.trim()) {
      response.status(400).json({ message: "Company name is required" });
      return;
    }
    response.json(await updateProvider(request.params.providerId, payload));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/providers/:providerId", async (request, response, next) => {
  try {
    const mediaFundingProvider = await localConvexClient().query(api.mediaFunding.providerForCompany, {
      serviceToken: localConvexServiceToken(),
      companyProviderId: request.params.providerId
    });
    if (mediaFundingProvider) {
      response.status(409).json({ message: "Remove this company's funding-provider setup before deleting the company" });
      return;
    }
    response.json(await deleteProvider(request.params.providerId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/revenue-partners", async (request, response, next) => {
  try {
    response.status(201).json(await createRevenuePartner(request.body as CreateRevenuePartnerPayload));
  } catch (error) {
    next(error);
  }
});

app.put("/api/revenue-partners/:partnerId", async (request, response, next) => {
  try {
    const payload = request.body as UpdateRevenuePartnerPayload;
    const sourceFieldsMissing = payload.source === "tune"
      ? !payload.networkIdEnv?.trim() || !payload.apiKeyEnv?.trim() || !payload.networkTimezone?.trim()
      : payload.source === "quinstreet"
        ? !payload.publisherName?.trim()
          || !payload.reportKeyEnv?.trim()
          || !payload.clientIdEnv?.trim()
          || !payload.clientSecretEnv?.trim()
          || !payload.revenueField?.trim()
        : true;
    if (
      !payload.name?.trim()
      || !payload.providerId?.trim()
      || !payload.revenueCategory?.trim()
      || sourceFieldsMissing
    ) {
      response.status(400).json({ message: "Revenue rule source and configuration fields are required" });
      return;
    }
    response.json(await updateRevenuePartner(request.params.partnerId, payload));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/revenue-partners/:partnerId", async (request, response, next) => {
  try {
    response.json(await deleteRevenuePartner(request.params.partnerId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/categories", async (request, response, next) => {
  try {
    response.status(201).json(await createTransactionCategory(request.body as CreateTransactionCategoryPayload));
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings/categories/:categoryId", async (request, response, next) => {
  try {
    response.json(
      await updateTransactionCategoryDefinition(
        request.params.categoryId,
        request.body as UpdateTransactionCategoryDefinitionPayload
      )
    );
  } catch (error) {
    next(error);
  }
});

app.delete("/api/settings/categories/:categoryId", async (request, response, next) => {
  try {
    response.json(await deleteTransactionCategoryDefinition(request.params.categoryId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/ai", async (request, response, next) => {
  try {
    response.json(await saveAiSettings(request.body as SaveAiSettingsPayload));
  } catch (error) {
    next(error);
  }
});

app.get("/api/ai/models", async (_request, response, next) => {
  try {
    response.json(await getOpenRouterZdrModels());
  } catch (error) {
    next(error);
  }
});

app.post("/api/ai/prompt", async (request, response, next) => {
  try {
    const payload = request.body as AiPromptPayload;
    if (!payload.prompt?.trim()) {
      response.status(400).json({ message: "Prompt is required" });
      return;
    }
    response.json(await runAiPrompt(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/matches", async (request, response, next) => {
  try {
    const payload = request.body as MatchTransactionPayload;
    if (!payload.transactionId || !payload.providerId) {
      response.status(400).json({ message: "transactionId and providerId are required" });
      return;
    }
    response.json(await matchTransaction(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:transactionId/company", async (request, response, next) => {
  try {
    const providerId = typeof request.body?.providerId === "string" ? request.body.providerId.trim() : "";
    const scope = request.body?.scope;
    if (!providerId || providerId.length > 256) {
      response.status(400).json({ message: "A valid company selection is required" });
      return;
    }
    if (scope !== undefined && scope !== "transaction" && scope !== "merchant") {
      response.status(400).json({ message: "Company update scope must be transaction or merchant" });
      return;
    }
    response.json(await matchTransaction({
      transactionId: request.params.transactionId,
      providerId,
      scope: scope === "merchant" ? "merchant" : "transaction"
    }, true));
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/auto-categorize", async (request, response, next) => {
  try {
    response.json(await autoCategorizeTransactions((request.body ?? {}) as AutoCategorizeTransactionsPayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices/auto-match-payments", async (_request, response, next) => {
  try {
    response.json(await autoMatchInvoicePayments());
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:transactionId/invoice-match", async (request, response, next) => {
  try {
    response.json(
      await matchInvoicePayment(request.params.transactionId, request.body as MatchInvoicePaymentPayload)
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:transactionId/team", async (request, response, next) => {
  try {
    const payload = {
      transactionId: request.params.transactionId,
      teamId: request.body?.teamId || undefined
    } satisfies AssignTransactionTeamPayload;
    response.json(await assignTransactionTeam(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/transactions/:transactionId/category", async (request, response, next) => {
  try {
    const payload = {
      transactionId: request.params.transactionId,
      category: request.body?.category,
      scope: request.body?.scope === "merchant" ? "merchant" as const : "transaction" as const
    } satisfies UpdateTransactionCategoryPayload;
    if (!payload.category?.trim()) {
      response.status(400).json({ message: "category is required" });
      return;
    }
    response.json(await updateTransactionCategory(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/distribution/adjustments", async (request, response, next) => {
  try {
    response.json(await saveProfitDistributionAdjustment(request.body as SaveProfitDistributionAdjustmentPayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/teams", async (request, response, next) => {
  try {
    const payload = request.body as CreateTeamPayload;
    if (!payload.name?.trim()) {
      response.status(400).json({ message: "Owner name is required" });
      return;
    }
    response.status(201).json(await createTeam(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices", async (request, response, next) => {
  try {
    const payload = request.body as CreateInvoicePayload;
    if (
      !payload.customerName?.trim() ||
      !payload.amount ||
      !payload.dueDate ||
      (payload.documentType !== "sales_invoice" && payload.documentType !== "supplier_bill")
    ) {
      response.status(400).json({ message: "customerName, amount, dueDate, and documentType are required" });
      return;
    }
    response.status(201).json(await createInvoice(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/expenses", async (request, response, next) => {
  try {
    response.status(201).json(await createExpense(request.body as CreateExpensePayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/expenses/:expenseId/match-payment", async (request, response, next) => {
  try {
    response.json(await matchExpensePayment(request.params.expenseId, request.body as MatchExpensePaymentPayload));
  } catch (error) {
    next(error);
  }
});

app.get("/api/expense-documents/:documentId", async (request, response, next) => {
  try {
    const document = expenseDocumentById(request.params.documentId);
    if (!document) {
      response.status(404).json({ message: "Expense document not found" });
      return;
    }
    const bytes = await readLocalExpenseDocument(document.storageId);
    const safeFileName = document.fileName.replaceAll(/[\r\n"]/g, "_");
    response.setHeader("Content-Type", document.contentType);
    response.setHeader("Content-Disposition", `inline; filename="${safeFileName}"`);
    response.send(Buffer.from(bytes));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/invoices", async (request, response, next) => {
  try {
    const payload = (request.body ?? {}) as Partial<DeleteInvoicesPayload>;
    response.json(await deleteInvoiceDrafts(Array.isArray(payload.invoiceIds) ? payload.invoiceIds : []));
  } catch (error) {
    next(error);
  }
});

app.get("/api/invoices/:invoiceId/duplicate-preview", async (request, response, next) => {
  try {
    response.json(await previewInvoiceDuplicate(request.params.invoiceId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/invoices/:invoiceId/pdf", async (request, response, next) => {
  try {
    const pdf = await downloadInvoicePdf(request.params.invoiceId);
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `attachment; filename="${pdf.fileName}"`);
    response.send(Buffer.from(pdf.bytes));
  } catch (error) {
    next(error);
  }
});

app.post("/api/receivables", async (request, response, next) => {
  try {
    response.status(201).json(await createManualReceivable(request.body as CreateManualReceivablePayload));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/receivables/:receivableId", async (request, response, next) => {
  try {
    await deleteManualReceivable(request.params.receivableId);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/cash-flow/snapshots", async (request, response, next) => {
  try {
    response.status(201).json(await saveCashFlowSnapshot(request.body as SaveCashFlowSnapshotPayload));
  } catch (error) {
    next(error);
  }
});

app.put("/api/invoices/:invoiceId", async (request, response, next) => {
  try {
    response.json(await updateInvoice(request.params.invoiceId, request.body as UpdateInvoicePayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices/send", async (request, response, next) => {
  try {
    response.json(await sendInvoices(request.body as SendInvoicesPayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices/:invoiceId/payments", async (request, response, next) => {
  try {
    response.json(
      await recordInvoicePayment(request.params.invoiceId, request.body as RecordInvoicePaymentPayload)
    );
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices/payments/bulk", async (request, response, next) => {
  try {
    response.json(await recordBulkInvoicePayments(request.body as BulkRecordInvoicePaymentsPayload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/holdings", async (request, response, next) => {
  try {
    response.status(201).json(await createHolding(request.body as CreateHoldingPayload));
  } catch (error) {
    next(error);
  }
});

app.put("/api/holdings/:holdingId", async (request, response, next) => {
  try {
    response.json(await updateHolding(request.params.holdingId, request.body as UpdateHoldingPayload));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/holdings/:holdingId", async (request, response, next) => {
  try {
    response.json(await deleteHolding(request.params.holdingId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/fx/refresh", async (_request, response, next) => {
  try {
    response.json(await refreshFxRates());
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unknown server error";
  response.status(error instanceof ClientRequestError ? 400 : 500).json({ message });
});

await initializeStore();

app.listen(port, () => {
  console.log(`Finance dashboard API listening on http://localhost:${port}`);
});
