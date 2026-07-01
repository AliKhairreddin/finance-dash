import type {
  AiPromptPayload,
  AiPromptResult,
  AiSettings,
  AiTransactionCategorization,
  Provider,
  StoredAiSettings,
  Transaction
} from "./types";

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

export const defaultAiSettings: StoredAiSettings = {
  provider: "openrouter",
  model: "~openai/gpt-latest"
};

export function publicAiSettings(settings: StoredAiSettings): AiSettings {
  const key = settings.openRouterApiKey?.trim();
  return {
    provider: "openrouter",
    model: settings.model,
    apiKeyConfigured: Boolean(key),
    apiKeyPreview: key ? `...${key.slice(-4)}` : undefined,
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
    body: JSON.stringify({ model, messages })
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

function validAiCategorization(value: unknown, providerIds: Set<string>, transactionIds: Set<string>): AiTransactionCategorization | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const transactionId = typeof row.transactionId === "string" ? row.transactionId : undefined;
  const providerId = typeof row.providerId === "string" && providerIds.has(row.providerId) ? row.providerId : undefined;
  const category = typeof row.category === "string" ? row.category.trim() : undefined;
  const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0;
  const reason = typeof row.reason === "string" ? row.reason.trim() : "AI categorization";

  if (!transactionId || !transactionIds.has(transactionId)) return undefined;
  if (!providerId && !category) return undefined;

  return {
    transactionId,
    providerId,
    category,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason
  };
}

export async function runOpenRouterTransactionCategorization(
  settings: StoredAiSettings,
  transactions: Transaction[],
  providers: Provider[],
  referer?: string
): Promise<AiTransactionCategorization[]> {
  if (transactions.length === 0) return [];

  const providerIds = new Set(providers.map((provider) => provider.id));
  const allMatches: AiTransactionCategorization[] = [];

  for (const transactionBatch of chunk(transactions, 24)) {
    const transactionIds = new Set(transactionBatch.map((transaction) => transaction.id));
    const result = await runOpenRouterPrompt(
      settings,
      {
        systemPrompt: [
          "You categorize finance dashboard transactions for a media buying business.",
          "Use only providerId values present in provider_directory. Do not invent companies.",
          "Return only JSON with this shape: {\"matches\":[{\"transactionId\":\"...\",\"providerId\":\"... or null\",\"category\":\"...\",\"confidence\":0.0,\"reason\":\"short reason\"}]}",
          "Taxonomy: P2W, Rezono, and Position2 are Ad account provider. Meta/Facebook, TikTok, Bigo, Snapchat, and Google/YouTube are Ad platform. Cursor, Namecheap, Cloudflare, Vercel, OpenAI, GitHub, and similar SaaS/tools are Subscription.",
          "If the row is not clearly matchable, omit it from matches."
        ].join(" "),
        prompt: JSON.stringify(
          {
            provider_directory: providers.map((provider) => ({
              id: provider.id,
              name: provider.name,
              type: provider.type,
              category: provider.category,
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
    const matches = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as { matches?: unknown }).matches : undefined;
    if (!Array.isArray(matches)) {
      throw new Error("AI categorization JSON needs a matches array");
    }

    for (const match of matches) {
      const valid = validAiCategorization(match, providerIds, transactionIds);
      if (valid) allMatches.push(valid);
    }
  }

  return allMatches;
}
