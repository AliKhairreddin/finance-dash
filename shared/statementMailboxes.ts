export type MailProvider = "gmail" | "outlook";
export const mailboxOrigin = "https://statements.thatcanadian.dev";
export const mailboxCallback = (provider: MailProvider) => `${mailboxOrigin}/api/statements/mailboxes/${provider}/callback`;
export function mailProvider(value: unknown): MailProvider {
  if (value !== "gmail" && value !== "outlook") throw new Error("Choose Gmail or Outlook");
  return value;
}
export function mailboxScanDate(value: unknown, now = Date.now()): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value < "1970-01-01" || value > new Date(now).toISOString().slice(0, 10)) throw new Error("Choose a valid scan starting date, today or earlier");
  return value;
}
export const mailboxProviderNames = { gmail: "Gmail", outlook: "Outlook" };
export type MailboxView = { id: string; provider: MailProvider; email: string; scanFrom: string; state: string; scanned: number; imported: number; skipped: number; issues: number; latestIssue?: string; lastCompletedAt?: number; completedThrough?: number; error?: string; nextRunAt: number; actor: string };
export type MailboxStatus = { providers: Record<MailProvider, boolean>; mailboxes: MailboxView[] };
