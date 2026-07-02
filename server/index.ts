import cors from "cors";
import "dotenv/config";
import express from "express";
import type {
  AssignTransactionTeamPayload,
  AiPromptPayload,
  AutoCategorizeTransactionsPayload,
  CreateInvoicePayload,
  CreateProviderPayload,
  CreateTeamPayload,
  AssignWiseCardHolderTeamPayload,
  ImportWiseStatementPayload,
  MatchTransactionPayload,
  SaveAiSettingsPayload,
  SyncRevenuePayload,
  UpdateTransactionCategoryPayload
} from "../shared/types";
import {
  assignTransactionTeam,
  assignWiseCardHolderTeam,
  autoCategorizeTransactions,
  createInvoice,
  createProvider,
  createTeam,
  getSnapshot,
  initializeStore,
  importWiseStatement,
  markInvoicePaidLocally,
  matchTransaction,
  runAiPrompt,
  saveAiSettings,
  setInvoiceApproval,
  syncExternalActivity,
  syncRevenue,
  updateTransactionCategory,
  updateProvider,
  updateRevenuePartner
} from "./store";

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

app.post("/api/invoices/:invoiceId/approval", async (request, response, next) => {
  try {
    const approvalStatus = request.body?.approvalStatus;
    if (approvalStatus !== "approved" && approvalStatus !== "denied") {
      response.status(400).json({ message: "approvalStatus must be approved or denied" });
      return;
    }
    response.json(await setInvoiceApproval(request.params.invoiceId, approvalStatus));
  } catch (error) {
    next(error);
  }
});

app.post("/api/invoices/:invoiceId/local-paid", async (request, response, next) => {
  try {
    response.json(await markInvoicePaidLocally(request.params.invoiceId));
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
