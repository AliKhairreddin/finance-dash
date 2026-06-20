import type { AiPromptPayload, AiPromptResult, AiSettings, StoredAiSettings } from "./types";

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
