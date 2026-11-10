import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { normalizeFinanceUsername } from "./telegram";

export const statementPasswordHostname = "statements.thatcanadian.dev";
export const statementPasswordUsers = ["ali m", "alaa"] as const;
export const statementPasswordWindowMs = 15 * 60 * 1000;
export const statementPasswordMaxAttempts = 10;

export interface StatementPasswordCredential { salt: string; hash: string }

export function usesStatementPassword(hostname: string, username: string): boolean {
  return hostname === statementPasswordHostname && statementPasswordUsers.some(user => user === normalizeFinanceUsername(username));
}

export function parseStatementPasswords(value: string | undefined): Map<string, StatementPasswordCredential> | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const credentials = new Map<string, StatementPasswordCredential>();
    for (const [username, credential] of Object.entries(parsed)) {
      if (!statementPasswordUsers.some(user => user === username) || !credential || typeof credential !== "object") return null;
      const { salt, hash } = credential as Record<string, unknown>;
      if (typeof salt !== "string" || !/^[a-f0-9]{64}$/.test(salt) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) return null;
      credentials.set(username, { salt, hash });
    }
    return credentials.size === statementPasswordUsers.length ? credentials : null;
  } catch { return null; }
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  // scrypt: 16 MiB of memory, five passes. Fixed parameters cannot be weakened by configuration.
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 32, { N: 16384, r: 8, p: 5 }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function createStatementPassword(password: string): Promise<StatementPasswordCredential> {
  if (password.length < 16 || password.length > 256) throw new Error("Statement passwords must contain 16–256 characters");
  const salt = randomBytes(32).toString("hex");
  return { salt, hash: (await derivePassword(password, salt)).toString("hex") };
}

export async function verifyStatementPassword(password: string, credential: StatementPasswordCredential): Promise<boolean> {
  if (!password || password.length > 256) return false;
  return timingSafeEqual(await derivePassword(password, credential.salt), Buffer.from(credential.hash, "hex"));
}

export function statementPasswordAttempt(times: number[], now: number): { times: number[]; retryAfterSeconds: number } {
  const recent = times.filter(time => time > now - statementPasswordWindowMs && time <= now);
  if (recent.length >= statementPasswordMaxAttempts) {
    return { times: recent, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + statementPasswordWindowMs - now) / 1000)) };
  }
  return { times: [...recent, now], retryAfterSeconds: 0 };
}
