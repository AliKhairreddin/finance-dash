import cors from "cors";
import "dotenv/config";
import express from "express";
import type { CreateInvoicePayload, CreateProviderPayload, MatchTransactionPayload } from "../shared/types";
import {
  createInvoice,
  createProvider,
  getSnapshot,
  initializeStore,
  markInvoicePaidLocally,
  matchTransaction,
  setInvoiceApproval,
  syncExternalActivity
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

app.post("/api/providers", async (request, response, next) => {
  try {
    const payload = request.body as CreateProviderPayload;
    if (!payload.name?.trim()) {
      response.status(400).json({ message: "Provider name is required" });
      return;
    }
    response.status(201).json(await createProvider(payload));
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

app.post("/api/invoices", async (request, response, next) => {
  try {
    const payload = request.body as CreateInvoicePayload;
    if (!payload.customerName?.trim() || !payload.amount || !payload.dueDate) {
      response.status(400).json({ message: "customerName, amount, and dueDate are required" });
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
