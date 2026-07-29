import type { WorkerEnv as Env } from "../worker-configuration";
import { timingSafeEqual } from "node:crypto";

const AUTH_COOKIE_NAME = "__Host-finance_session";
const AUTH_SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const textEncoder = new TextEncoder();

type AuthEnv = Pick<Env, "AUTH_USERNAME" | "AUTH_PASSWORD_HASH" | "AUTH_SESSION_SECRET">;

interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

interface PasswordVerifier {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
}

class InvalidLoginBodyError extends Error {}

function base64UrlEncode(value: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function parsePasswordVerifier(value: string): PasswordVerifier | null {
  const [algorithm, iterationsValue, saltValue, hashValue, extra] = value.split("$");
  const iterations = Number(iterationsValue);
  const salt = base64UrlDecode(saltValue ?? "");
  const hash = base64UrlDecode(hashValue ?? "");
  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    extra !== undefined ||
    iterations !== PASSWORD_HASH_ITERATIONS ||
    !salt ||
    salt.byteLength < 16 ||
    !hash ||
    hash.byteLength !== 32
  ) {
    return null;
  }
  return { iterations, salt, hash };
}

function authConfig(env: AuthEnv): AuthConfig | null {
  const username = env.AUTH_USERNAME?.trim();
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim();
  const sessionSecret = env.AUTH_SESSION_SECRET?.trim();
  if (!username || !passwordHash || !sessionSecret || !parsePasswordVerifier(passwordHash)) return null;
  return { username, passwordHash, sessionSecret };
}

async function derivePasswordHash(
  password: string,
  verifier: PasswordVerifier
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: verifier.salt,
      iterations: verifier.iterations
    },
    key,
    256
  );
  return new Uint8Array(derived);
}

async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(right))
  ]);
  return timingSafeEqual(new Uint8Array(leftDigest), new Uint8Array(rightDigest));
}

export async function verifyLoginCredentials(
  username: string,
  password: string,
  config: Pick<AuthConfig, "username" | "passwordHash">
): Promise<boolean> {
  const verifier = parsePasswordVerifier(config.passwordHash);
  if (!verifier || username.length > 256 || password.length > 1024) return false;

  const [usernameMatches, candidateHash] = await Promise.all([
    timingSafeStringEqual(username, config.username),
    derivePasswordHash(password, verifier)
  ]);
  return usernameMatches && timingSafeEqual(candidateHash, verifier.hash);
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createAuthSessionToken(
  secret: string,
  nowMilliseconds = Date.now()
): Promise<string> {
  const issuedAt = Math.floor(nowMilliseconds / 1000);
  const expiresAt = issuedAt + AUTH_SESSION_SECONDS;
  const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${issuedAt}.${expiresAt}.${nonce}`;
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), textEncoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyAuthSessionToken(
  token: string,
  secret: string,
  nowMilliseconds = Date.now()
): Promise<boolean> {
  const [version, issuedAtValue, expiresAtValue, nonce, signatureValue, extra] = token.split(".");
  const issuedAt = Number(issuedAtValue);
  const expiresAt = Number(expiresAtValue);
  const signature = base64UrlDecode(signatureValue ?? "");
  const now = Math.floor(nowMilliseconds / 1000);
  if (
    version !== "v1" ||
    extra !== undefined ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !nonce ||
    !signature ||
    signature.byteLength !== 32 ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > AUTH_SESSION_SECONDS
  ) {
    return false;
  }

  const payload = `${version}.${issuedAt}.${expiresAt}.${nonce}`;
  return crypto.subtle.verify(
    "HMAC",
    await sessionKey(secret),
    signature,
    textEncoder.encode(payload)
  );
}

function cookieValue(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== AUTH_COOKIE_NAME) continue;
    return cookie.slice(separator + 1).trim() || null;
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; Max-Age=${AUTH_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredSessionCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://finance.invalid");
    if (url.origin !== "https://finance.invalid" || url.pathname === "/login" || url.pathname === "/logout") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function securityHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
}

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  const headers = securityHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  if (init.headers) {
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  }
  return new Response(body, { ...init, headers });
}

function loginPage(returnTo: string, error?: string): string {
  const errorMarkup = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Sign in · Finance Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: #f5f7fa; background: radial-gradient(circle at top, #1b2638 0, #0c111b 48%, #070a10 100%); }
    main { width: min(100%, 400px); padding: 32px; border: 1px solid #273349; border-radius: 18px; background: rgba(14, 20, 31, .94); box-shadow: 0 24px 70px rgba(0, 0, 0, .42); }
    .mark { width: 44px; height: 44px; display: grid; place-items: center; margin-bottom: 22px; border-radius: 13px; color: #08101d; background: #8dd8ff; font-size: 22px; font-weight: 800; }
    h1 { margin: 0; font-size: 26px; letter-spacing: -.035em; }
    .subhead { margin: 8px 0 26px; color: #9ba9bd; font-size: 14px; line-height: 1.5; }
    label { display: block; margin: 0 0 8px; color: #c8d1de; font-size: 13px; font-weight: 650; }
    input { width: 100%; height: 46px; margin-bottom: 18px; padding: 0 13px; border: 1px solid #344259; border-radius: 10px; outline: none; color: #f7f9fc; background: #0a101a; font: inherit; transition: border-color .15s, box-shadow .15s; }
    input:focus { border-color: #79cfff; box-shadow: 0 0 0 3px rgba(121, 207, 255, .14); }
    button { width: 100%; height: 46px; border: 0; border-radius: 10px; color: #07101c; background: #8dd8ff; font: inherit; font-weight: 750; cursor: pointer; }
    button:hover { background: #a4e1ff; }
    .error { margin: -4px 0 18px; padding: 10px 12px; border: 1px solid #713a43; border-radius: 9px; color: #ffc0c7; background: #2a151a; font-size: 13px; }
    .note { margin: 20px 0 0; color: #68768a; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">$</div>
    <h1>Finance Dashboard</h1>
    <p class="subhead">Sign in to continue to the private finance workspace.</p>
    ${errorMarkup}
    <form method="post" action="/login">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
    <p class="note">Protected by a secure, time-limited session.</p>
  </main>
</body>
</html>`;
}

async function readLoginForm(request: Request): Promise<URLSearchParams> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (
    contentType !== "application/x-www-form-urlencoded" ||
    !Number.isFinite(contentLength) ||
    contentLength > LOGIN_BODY_LIMIT_BYTES ||
    !request.body
  ) {
    throw new InvalidLoginBodyError();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > LOGIN_BODY_LIMIT_BYTES) {
        await reader.cancel();
        throw new InvalidLoginBodyError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(body));
}

function redirect(location: string, cookie?: string): Response {
  const headers = securityHeaders();
  headers.set("Location", location);
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function authUnavailable(pathname: string): Response {
  if (pathname.startsWith("/api/")) {
    return Response.json(
      { message: "Site authentication is not configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  return htmlResponse(
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Authentication unavailable</title><body><h1>Authentication unavailable</h1><p>The site is securely locked until its authentication secrets are configured.</p></body></html>",
    { status: 503 }
  );
}

async function hasValidSession(request: Request, secret: string): Promise<boolean> {
  const token = cookieValue(request);
  return token ? verifyAuthSessionToken(token, secret) : false;
}

export async function enforceSiteAuthentication(request: Request, env: AuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const config = authConfig(env);
  if (!config) return authUnavailable(url.pathname);

  if (url.pathname === "/logout") {
    return redirect("/login", expiredSessionCookie());
  }

  if (url.pathname === "/login") {
    const returnTo = safeReturnTo(
      request.method === "GET" ? url.searchParams.get("returnTo") : null
    );
    if (request.method === "GET") {
      return (await hasValidSession(request, config.sessionSecret))
        ? redirect(returnTo)
        : htmlResponse(loginPage(returnTo));
    }
    if (request.method !== "POST") {
      return htmlResponse(loginPage(returnTo), { status: 405, headers: { Allow: "GET, POST" } });
    }

    try {
      const form = await readLoginForm(request);
      const formReturnTo = safeReturnTo(form.get("returnTo"));
      const username = form.get("username") ?? "";
      const password = form.get("password") ?? "";
      if (await verifyLoginCredentials(username, password, config)) {
        const token = await createAuthSessionToken(config.sessionSecret);
        return redirect(formReturnTo, sessionCookie(token));
      }
      return htmlResponse(loginPage(formReturnTo, "Invalid username or password."), { status: 401 });
    } catch (error) {
      if (!(error instanceof InvalidLoginBodyError)) throw error;
      return htmlResponse(loginPage("/", "Invalid sign-in request."), { status: 400 });
    }
  }

  if (await hasValidSession(request, config.sessionSecret)) return null;
  if (url.pathname.startsWith("/api/")) {
    return Response.json(
      { message: "Authentication required" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }
  const returnTo = safeReturnTo(`${url.pathname}${url.search}${url.hash}`);
  return redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}
