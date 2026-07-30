import type {
  AiPromptPayload,
  AiPromptResult,
  AiSettings,
  AiTransactionCategorization,
  OpenRouterZdrModel,
  Provider,
  StoredAiSettings,
  Transaction,
  TransactionCategory
} from "./types";
import {
  initialTransactionCategories,
  isRequiredTransactionCategory,
  transactionCategoryOptionsForDirection,
  transactionBusinessCategory
} from "./categories";

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
  model?: string;
}

interface OpenRouterModelsResponse {
  data?: Array<{
    architecture?: {
      output_modalities?: unknown;
    };
    context_length?: unknown;
    id?: unknown;
    name?: unknown;
  }>;
}

const openRouterZdrModelsUrl = "https://openrouter.ai/api/v1/models?zdr=true&output_modalities=text";

export const defaultAiSettings: StoredAiSettings = {
  provider: "openrouter",
  model: "openai/gpt-5.6-sol"
};

export async function listOpenRouterZdrModels(): Promise<OpenRouterZdrModel[]> {
  const response = await fetch(openRouterZdrModelsUrl, {
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`OpenRouter ZDR model catalog failed with ${response.status}`);
  }

  const body = (await response.json()) as OpenRouterModelsResponse;
  if (!Array.isArray(body.data)) {
    throw new Error("OpenRouter returned an invalid ZDR model catalog");
  }

  const models = new Map<string, OpenRouterZdrModel>();
  for (const candidate of body.data) {
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    if (!id) continue;
    const outputModalities = candidate.architecture?.output_modalities;
    if (Array.isArray(outputModalities) && !outputModalities.includes("text")) continue;
    const name = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : id;
    const contextLength =
      typeof candidate.context_length === "number" && Number.isFinite(candidate.context_length)
        ? candidate.context_length
        : undefined;
    models.set(id, { id, name, contextLength });
  }

  if (models.size === 0) {
    throw new Error("OpenRouter returned no Zero Data Retention text models");
  }

  return [...models.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export async function requireOpenRouterZdrModel(model: unknown): Promise<string> {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedModel) {
    throw new Error("OpenRouter model is required");
  }
  const models = await listOpenRouterZdrModels();
  if (!models.some((candidate) => candidate.id === normalizedModel)) {
    throw new Error("Choose a Zero Data Retention model from the OpenRouter model picker");
  }
  return normalizedModel;
}

export function publicAiSettings(settings: StoredAiSettings): AiSettings {
  const key = settings.openRouterApiKey?.trim();
  return {
    provider: "openrouter",
    model: settings.model,
    apiKeyConfigured: Boolean(key),
    updatedAt: settings.updatedAt
  };
}

export async function runOpenRouterPrompt(
  settings: StoredAiSettings,
  payload: AiPromptPayload,
  referer?: string
): Promise<AiPromptResult> {
  const apiKey = settings.openRouterApiKey?.trim();
  const model = settings.model.trim();
  const prompt = payload.prompt.trim();

  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured");
  }
  if (!model) {
    throw new Error("OpenRouter model is required");
  }
  if (!prompt) {
    throw new Error("Prompt is required");
  }

  const messages = [
    ...(payload.systemPrompt?.trim()
      ? [
          {
            role: "system",
            content: payload.systemPrompt.trim()
          }
        ]
      : []),
    {
      role: "user",
      content: prompt
    }
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(referer ? { "HTTP-Referer": referer } : {}),
      "X-OpenRouter-Title": "Finance Dash"
    },
    body: JSON.stringify({
      model,
      messages,
      provider: {
        zdr: true
      }
    })
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as OpenRouterChatResponse) : {};
  if (!response.ok) {
    throw new Error(body.error?.message || `OpenRouter request failed with ${response.status}`);
  }
  if (body.error?.message) {
    throw new Error(body.error.message);
  }

  const content = body.choices?.[0]?.message?.content;
  const output = Array.isArray(content)
    ? content.map((item) => item.text).filter(Boolean).join("\n")
    : content;

  if (!output?.trim()) {
    throw new Error("OpenRouter returned an empty response");
  }

  return {
    output: output.trim(),
    model: body.model || model,
    createdAt: new Date().toISOString()
  };
}

function jsonObjectFromText(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("AI categorization did not return JSON");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function chunk<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function validAiCategorization(
  value: unknown,
  providerIds: Set<string>,
  transactionsById: Map<string, Transaction>,
  categories: readonly Pick<TransactionCategory, "name" | "direction">[]
): AiTransactionCategorization | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const transactionId = typeof row.transactionId === "string" ? row.transactionId : undefined;
  const transaction = transactionId ? transactionsById.get(transactionId) : undefined;
  const providerId = typeof row.providerId === "string" && providerIds.has(row.providerId) ? row.providerId : undefined;
  const categoryValue = typeof row.category === "string" ? transactionBusinessCategory(row.category) : undefined;
  const category =
    categoryValue &&
    transaction &&
    isRequiredTransactionCategory(categoryValue, transaction.direction, categories)
      ? categoryValue
      : undefined;
  const merchantName = typeof row.merchantName === "string" ? row.merchantName.trim().replace(/\s+/g, " ") : "";
  const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0;
  const reason = typeof row.reason === "string" ? row.reason.trim() : "AI categorization";

  if (!transactionId || !transaction) return undefined;
  if (!category || !merchantName) return undefined;

  return {
    transactionId,
    ...(providerId ? { providerId } : {}),
    category,
    merchantName,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason
  };
}

export async function runOpenRouterTransactionCategorization(
  settings: StoredAiSettings,
  transactions: Transaction[],
  providers: Provider[],
  referer?: string,
  categories: readonly Pick<TransactionCategory, "name" | "direction">[] = initialTransactionCategories
): Promise<AiTransactionCategorization[]> {
  if (transactions.length === 0) return [];

  const providerIds = new Set(providers.map((provider) => provider.id));
  const categorizeBatch = async (transactionBatch: Transaction[]): Promise<AiTransactionCategorization[]> => {
    const transactionsById = new Map(transactionBatch.map((transaction) => [transaction.id, transaction]));
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await runOpenRouterPrompt(
          settings,
          {
            systemPrompt: [
              "You categorize finance dashboard transactions for a media buying business.",
              "Use only providerId values present in provider_directory. Do not invent companies.",
              "provider_directory.tags are company metadata; transaction category should describe what the money is for.",
              "Every transaction must produce exactly one match. Category and merchantName are required. providerId is optional.",
              "Never return Uncategorized. When evidence is ambiguous, choose the most probable valid category and lower confidence.",
              "merchantName is a concise, title-cased merchant or payer identity derived from the bank text. Remove terminal IDs, payment references, card suffixes, store numbers, and location noise so repeated variants of the same real merchant use exactly the same merchantName.",
              "Never use DEBIT, CREDIT, card, transfer, source names, or money-in/money-out direction as transaction categories.",
              "Use money_in_categories only for direction=in and money_out_categories only for direction=out.",
              "Return only JSON with this shape: {\"matches\":[{\"transactionId\":\"...\",\"providerId\":\"... or null\",\"category\":\"...\",\"merchantName\":\"...\",\"confidence\":0.0,\"reason\":\"short reason\"}]}",
              "Taxonomy: Cognitive Pixel is the internal media buying team. Wagner is an affiliate team; WGNR means Wagner and is not a separate team. Kissterra, Lead Economy, and other revenue/customer/affiliate companies are clients. P2W, Rezono, and Position2 are Ad account provider suppliers. Meta/Facebook, TikTok, Bigo, Snapchat, and Google/YouTube are Ad platform suppliers. Wise, Revolut, Slash, and Amex are bank/card sources, not categories. Cursor, Namecheap, Cloudflare, Vercel, OpenAI, GitHub, and similar SaaS/tools are Subscription suppliers.",
              "Do not omit transactions."
            ].join(" "),
            prompt: JSON.stringify(
              {
                money_in_categories: transactionCategoryOptionsForDirection("in", categories),
                money_out_categories: transactionCategoryOptionsForDirection("out", categories),
                provider_directory: providers.map((provider) => ({
                  id: provider.id,
                  name: provider.name,
                  type: provider.type,
                  tags: provider.tags,
                  aliases: provider.aliases.slice(0, 16)
                })),
                transactions: transactionBatch.map((transaction) => ({
                  id: transaction.id,
                  source: transaction.source,
                  date: transaction.date,
                  accountName: transaction.accountName,
                  description: transaction.description,
                  rawName: transaction.rawName,
                  counterparty: transaction.counterparty,
                  amount: transaction.amount,
                  currency: transaction.currency,
                  direction: transaction.direction,
                  bankCategory: transaction.category
                }))
              },
              null,
              2
            )
          },
          referer
        );

        const parsed = jsonObjectFromText(result.output);
        const matches = parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as { matches?: unknown }).matches
          : undefined;
        if (!Array.isArray(matches)) {
          throw new Error("AI categorization JSON needs a matches array");
        }

        const validBatchMatches: AiTransactionCategorization[] = [];
        for (const match of matches) {
          const valid = validAiCategorization(match, providerIds, transactionsById, categories);
          if (valid) validBatchMatches.push(valid);
        }
        const resultIds = new Set(validBatchMatches.map((match) => match.transactionId));
        if (
          validBatchMatches.length !== transactionBatch.length
          || resultIds.size !== transactionBatch.length
          || transactionBatch.some((transaction) => !resultIds.has(transaction.id))
        ) {
          throw new Error("AI categorization must return one valid category and merchant for every transaction");
        }
        return validBatchMatches;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AI categorization failed");
  };

  const allMatches: AiTransactionCategorization[] = [];
  for (const wave of chunk(chunk(transactions, 20), 12)) {
    const results = await Promise.all(wave.map(categorizeBatch));
    allMatches.push(...results.flat());
  }

  return allMatches;
}
