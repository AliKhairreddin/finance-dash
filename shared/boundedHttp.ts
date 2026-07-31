export const maximumBankProviderResponseBytes = 4 * 1024 * 1024;

export const maximumBankProviderFetchAttempts = 3;
export const maximumBankProviderRequestTimeoutMs = 60_000;
export const maximumBankProviderRetryDelayMs = 30_000;
export const bankProviderResponseBodyTimeoutMs = 10_000;

export type BankProviderFetchPolicy = Readonly<{
  timeoutMs: number;
  maxAttempts: number;
  maxRetryDelayMs: number;
}>;

export type BankProviderFetchOptions = Partial<BankProviderFetchPolicy> & {
  provider: string;
};

export const bankProviderGetFetchPolicy = {
  timeoutMs: 10_000,
  maxAttempts: 2,
  maxRetryDelayMs: 1_500,
} as const satisfies BankProviderFetchPolicy;

export const bankProviderOAuthFetchPolicy = {
  timeoutMs: 10_000,
  maxAttempts: 1,
  maxRetryDelayMs: 0,
} as const satisfies BankProviderFetchPolicy;

const retryableBankProviderStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function validateFetchPolicy(options: BankProviderFetchOptions): BankProviderFetchPolicy {
  const timeoutMs = options.timeoutMs ?? bankProviderGetFetchPolicy.timeoutMs;
  const maxAttempts = options.maxAttempts ?? bankProviderGetFetchPolicy.maxAttempts;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? bankProviderGetFetchPolicy.maxRetryDelayMs;

  if (!options.provider.trim()) throw new Error("Bank provider name is required");
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > maximumBankProviderRequestTimeoutMs
  ) {
    throw new Error("Bank provider request timeout is invalid");
  }
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > maximumBankProviderFetchAttempts
  ) {
    throw new Error("Bank provider fetch attempt limit is invalid");
  }
  if (
    !Number.isSafeInteger(maxRetryDelayMs) ||
    maxRetryDelayMs < 0 ||
    maxRetryDelayMs > maximumBankProviderRetryDelayMs
  ) {
    throw new Error("Bank provider retry delay is invalid");
  }
  return { timeoutMs, maxAttempts, maxRetryDelayMs };
}

function retryAfterDelayMs(value: string | null, now: number, maximumDelayMs: number): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const seconds = Number(normalized);
    if (!Number.isFinite(seconds)) return maximumDelayMs;
    return Math.min(seconds * 1_000, maximumDelayMs);
  }
  const retryAt = Date.parse(normalized);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(Math.max(0, retryAt - now), maximumDelayMs);
}

function retryDelayMs(response: Response | undefined, attempt: number, maximumDelayMs: number): number {
  const requestedDelay = retryAfterDelayMs(response?.headers.get("retry-after") ?? null, Date.now(), maximumDelayMs);
  if (requestedDelay !== null) return requestedDelay;
  return Math.min(250 * 2 ** (attempt - 1), maximumDelayMs);
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  return error.name === "NetworkError" || error.name === "TimeoutError";
}

async function waitForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  if (delayMs === 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
      reject(signal ? abortReason(signal) : new DOMException("The operation was aborted", "AbortError"));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function requestSignal(input: string | URL | Request, init: RequestInit | undefined): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  return input instanceof Request ? input.signal : undefined;
}

async function fetchBankProviderAttempt(
  fetcher: typeof fetch,
  input: string | URL | Request,
  init: RequestInit | undefined,
  provider: string,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined
): Promise<{ response?: Response; error?: unknown; timedOut: boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutError = new DOMException(`${provider} API request timed out after ${timeoutMs}ms`, "TimeoutError");
  const handleCallerAbort = () => controller.abort(callerSignal ? abortReason(callerSignal) : undefined);
  if (callerSignal) {
    if (callerSignal.aborted) throw abortReason(callerSignal);
    callerSignal.addEventListener("abort", handleCallerAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
  }, timeoutMs);
  let handleAttemptAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    handleAttemptAbort = () => reject(abortReason(controller.signal));
    controller.signal.addEventListener("abort", handleAttemptAbort, { once: true });
  });

  try {
    const response = await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      abortPromise,
    ]);
    return { response, timedOut };
  } catch (error) {
    return { error, timedOut };
  } finally {
    clearTimeout(timer);
    if (handleAttemptAbort) controller.signal.removeEventListener("abort", handleAttemptAbort);
    callerSignal?.removeEventListener("abort", handleCallerAbort);
  }
}

export async function fetchBankProvider(
  fetcher: typeof fetch,
  input: string | URL | Request,
  init: RequestInit | undefined,
  options: BankProviderFetchOptions
): Promise<Response> {
  const policy = validateFetchPolicy(options);
  const callerSignal = requestSignal(input, init);

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const result = await fetchBankProviderAttempt(
      fetcher,
      input,
      init,
      options.provider,
      policy.timeoutMs,
      callerSignal
    );

    if (result.response) {
      if (!retryableBankProviderStatuses.has(result.response.status) || attempt === policy.maxAttempts) {
        return result.response;
      }
      void result.response.body?.cancel().catch(() => undefined);
      await waitForRetry(retryDelayMs(result.response, attempt, policy.maxRetryDelayMs), callerSignal);
      continue;
    }

    if (callerSignal?.aborted) throw result.error;
    if ((!result.timedOut && !isNetworkError(result.error)) || attempt === policy.maxAttempts) {
      throw result.error;
    }
    await waitForRetry(retryDelayMs(undefined, attempt, policy.maxRetryDelayMs), callerSignal);
  }

  throw new Error("Bank provider fetch exhausted its attempt limit");
}

export async function readBoundedResponseText(
  response: Response,
  provider: string,
  maximumBytes = maximumBankProviderResponseBytes,
  timeoutMs = bankProviderResponseBodyTimeoutMs
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Bank provider response limit is invalid");
  }
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > maximumBankProviderRequestTimeoutMs
  ) {
    throw new Error("Bank provider response timeout is invalid");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${provider} API response exceeded ${maximumBytes} bytes`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  const readBody = async (): Promise<string> => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        throw new Error(`${provider} API response exceeded ${maximumBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  };
  const timeoutError = new DOMException(
    `${provider} API response body timed out after ${timeoutMs}ms`,
    "TimeoutError"
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  try {
    return await Promise.race([readBody(), timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    // Cancellation is deliberately not awaited: a broken upstream stream may
    // also fail to settle its cancel hook, and must not defeat the deadline.
    void reader.cancel().catch(() => undefined);
  }
}

export async function readBoundedResponseJson<T>(
  response: Response,
  provider: string,
  maximumBytes = maximumBankProviderResponseBytes
): Promise<T> {
  const text = await readBoundedResponseText(response, provider, maximumBytes);
  if (!text) throw new Error(`${provider} API returned an empty response`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${provider} API returned invalid JSON`);
  }
}
