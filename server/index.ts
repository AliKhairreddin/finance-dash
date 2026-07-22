import cors from "cors";
import "dotenv/config";
import express from "express";
import type {
  AssignTransactionTeamPayload,
  AiPromptPayload,
  AutoCategorizeTransactionsPayload,
  CreateHoldingPayload,
  CreateInvoicePayload,
  CreateProviderPayload,
  CreateRevenuePartnerPayload,
  CreateTeamPayload,
  AssignWiseCardHolderTeamPayload,
  ImportWiseStatementPayload,
  MatchTransactionPayload,
  RecordInvoicePaymentPayload,
  SaveProfitDistributionAdjustmentPayload,
  SaveAiSettingsPayload,
  SendInvoicesPayload,
  SyncRevenuePayload,
  UpdateHoldingPayload,
  UpdateInvoicePayload,
  UpdateTransactionCategoryPayload
} from "../shared/types";
import {
  assignTransactionTeam,
  assignWiseCardHolderTeam,
  autoCategorizeTransactions,
  createHolding,
  createInvoice,
  createProvider,
  createRevenuePartner,
  createTeam,
  deleteProvider,
  deleteRevenuePartner,
  deleteHolding,
  draftRevenueRun,
  getSnapshot,
  initializeStore,
  importWiseStatement,
  matchTransaction,
  recordInvoicePayment,
  refreshFxRates,
  runIncomeAutomation,
  runAiPrompt,
  saveAiSettings,
  saveProfitDistributionAdjustment,
  sendInvoices,
  syncExternalActivity,
  syncRevenue,
  updateTransactionCategory,
  updateHolding,
  updateInvoice,
  updateProvider,
  updateRevenuePartner
} from "./store";
import { loadManagementReportDashboard } from "./managementReportStore";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "finance-dash-api", time: new Date().toISOString() });
});

app.get("/api/dashboard", (_request, response) => {
  response.json(getSnapshot());
});

app.get("/api/management-report", async (_request, response, next) => {
  try {
    response.json(await loadManagementReportDashboard());
  } catch (error) {
    next(error);
  }
});

app.post("/api/sync", async (_request, response, next) => {
  try {
    response.json(await syncExternalActivity());
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

app.post("/api/wise/card-holder-team", async (request, response, next) => {
  try {
    const payload = request.body as AssignWiseCardHolderTeamPayload;
    if (!payload.cardHolderName?.trim() || !payload.teamId?.trim()) {
      response.status(400).json({ message: "cardHolderName and teamId are required" });
      return;
    }
    response.json(await assignWiseCardHolderTeam(payload));
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

app.post("/api/revenue/runs/:runId/draft", async (request, response, next) => {
  try {
    response.status(201).json(await draftRevenueRun(request.params.runId));
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
    const payload = request.body;
    if (
      !payload.name?.trim() ||
      !payload.providerId?.trim() ||
      !payload.revenueCategory?.trim() ||
      !payload.networkIdEnv?.trim() ||
      !payload.apiKeyEnv?.trim()
    ) {
      response.status(400).json({ message: "name, providerId, revenueCategory, networkIdEnv, and apiKeyEnv are required" });
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

app.post("/api/settings/ai", async (request, response, next) => {
  try {
    response.json(await saveAiSettings(request.body as SaveAiSettingsPayload));
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

app.post("/api/transactions/auto-categorize", async (request, response, next) => {
  try {
    response.json(await autoCategorizeTransactions((request.body ?? {}) as AutoCategorizeTransactionsPayload));
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
      rememberAlias: request.body?.rememberAlias !== false
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
      response.status(400).json({ message: "Team name is required" });
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
  response.status(500).json({ message });
});

await initializeStore();

app.listen(port, () => {
  console.log(`Finance dashboard API listening on http://localhost:${port}`);
});
