export const statementCallbackTimeoutMs = 8 * 60_000;
export const statementProcessingLeaseMs = statementCallbackTimeoutMs + 2 * 60_000;

export function statementRetryAfterMs(value: string, now = Date.now()): number | undefined {
  const milliseconds = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(1000, milliseconds) : undefined;
}
