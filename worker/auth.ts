import { timingSafeEqual } from "node:crypto";
import {
  normalizeFinanceUsername,
  parseTelegramAuthUsers,
  sendTelegramOtp,
  sendTelegramSignInAlert,
  type TelegramAuthUser
} from "./telegram";
import { TELEGRAM_OTP_EXPIRY_MS } from "./telegramOtp";
import type { DashboardSession } from "../shared/types";

const AUTH_COOKIE_NAME = "__Host-finance_session";
const LOGIN_COOKIE_NAME = "__Host-finance_login";
const AUTH_SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORDLESS_SESSION_SUBJECT_PREFIX = "passwordless:";
const SLASH_APP_HOSTNAME = "slash.thatcanadian.dev";
const textEncoder = new TextEncoder();
const PUBLIC_APP_ASSET_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/site.webmanifest"
]);

type AuthEnv = Pick<
  WorkerEnv,
  | "AUTH_SESSION_SECRET"
  | "SLASH_AUTH_PASSWORD_HASH"
  | "SLASH_AUTH_USERNAME"
  | "TELEGRAM_AUTH_USERS_JSON"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_OTP_STATE"
  | "TELEGRAM_PASSWORDLESS_USERS_JSON"
> & {
  TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?: string;
};

interface AuthCredential {
  username: string;
  passwordHash: string;
}

interface PasswordVerifier {
  iterations: number;
  salt: Uint8Array<ArrayBuffer>;
  hash: Uint8Array<ArrayBuffer>;
}

interface TelegramAuthConfig {
  users: TelegramAuthUser[];
  passwordlessUsernames: Set<string>;
  transactionReviewerUsernames: Set<string>;
  sessionSecret: string;
}

interface LoginChallenge {
  username: string;
  challengeId: string;
}

interface AuthDependencies {
  now?: () => number;
  generateOtp?: () => string;
  sendTelegramOtp?: typeof sendTelegramOtp;
  sendTelegramSignInAlert?: typeof sendTelegramSignInAlert;
}

type LoginMode = "telegram-username" | "telegram-code" | "password";

interface LoginPageOptions {
  mode: LoginMode;
  returnTo: string;
  scriptNonce: string;
  username?: string;
  error?: string;
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

function slashCredential(env: AuthEnv): { credential: AuthCredential; sessionSecret: string } | null {
  const username = env.SLASH_AUTH_USERNAME?.trim();
  const passwordHash = env.SLASH_AUTH_PASSWORD_HASH?.trim();
  const sessionSecret = env.AUTH_SESSION_SECRET?.trim();
  if (!username || !passwordHash || !sessionSecret || !parsePasswordVerifier(passwordHash)) return null;
  return { credential: { username, passwordHash }, sessionSecret };
}

function telegramConfig(env: AuthEnv): TelegramAuthConfig | null {
  const sessionSecret = env.AUTH_SESSION_SECRET?.trim();
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const administratorUsers = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  const transactionReviewerUsers = parseOptionalTelegramUsers(env.TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON);
  if (!sessionSecret || !botToken || !administratorUsers || !transactionReviewerUsers || !env.TELEGRAM_OTP_STATE) return null;
  const users = [...administratorUsers, ...transactionReviewerUsers];
  const normalizedUsernames = new Set<string>();
  const chatIds = new Set<string>();
  for (const user of users) {
    if (normalizedUsernames.has(user.normalizedUsername) || chatIds.has(user.chatId)) return null;
    normalizedUsernames.add(user.normalizedUsername);
    chatIds.add(user.chatId);
  }
  const passwordlessUsernames = parsePasswordlessTelegramUsers(env.TELEGRAM_PASSWORDLESS_USERS_JSON, users);
  if (!passwordlessUsernames) return null;
  const transactionReviewerUsernames = new Set(transactionReviewerUsers.map((user) => user.normalizedUsername));
  if ([...transactionReviewerUsernames].some((username) => passwordlessUsernames.has(username))) return null;
  return {
    users,
    passwordlessUsernames,
    transactionReviewerUsernames,
    sessionSecret
  };
}

function parseOptionalTelegramUsers(value: string | undefined): TelegramAuthUser[] | null {
  if (!value?.trim()) return [];
  return parseTelegramAuthUsers(value);
}

function parsePasswordlessTelegramUsers(
  value: string | undefined,
  users: TelegramAuthUser[]
): Set<string> | null {
  if (!value?.trim()) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const configuredUsers = new Set(users.map((user) => user.normalizedUsername));
  const passwordlessUsernames = new Set<string>();
  for (const username of parsed) {
    if (typeof username !== "string") return null;
    const normalizedUsername = normalizeFinanceUsername(username);
    if (!configuredUsers.has(normalizedUsername) || passwordlessUsernames.has(normalizedUsername)) return null;
    passwordlessUsernames.add(normalizedUsername);
  }
  return passwordlessUsernames;
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
  config: AuthCredential
): Promise<boolean> {
  const verifier = parsePasswordVerifier(config.passwordHash);
  if (!verifier || username.length > 256 || password.length > 1024) return false;
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const [usernameMatches, candidateHash] = await Promise.all([
    timingSafeStringEqual(username, config.username),
    crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: verifier.salt,
        iterations: verifier.iterations
      },
      key,
      256
    )
  ]);
  return usernameMatches && timingSafeEqual(new Uint8Array(candidateHash), verifier.hash);
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
  audience: string,
  subject: string,
  nowMilliseconds = Date.now()
): Promise<string> {
  const issuedAt = Math.floor(nowMilliseconds / 1000);
  const expiresAt = issuedAt + AUTH_SESSION_SECONDS;
  const payload = [
    "v3",
    issuedAt,
    expiresAt,
    base64UrlEncode(textEncoder.encode(audience)),
    base64UrlEncode(textEncoder.encode(subject)),
    base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))
  ].join(".");
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), textEncoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifiedAuthSessionSubject(
  token: string,
  secret: string,
  expectedAudience: string,
  nowMilliseconds = Date.now()
): Promise<string | null> {
  const [version, issuedValue, expiresValue, audienceValue, subjectValue, nonce, signatureValue, extra] =
    token.split(".");
  const issuedAt = Number(issuedValue);
  const expiresAt = Number(expiresValue);
  const audience = base64UrlDecode(audienceValue ?? "");
  const subject = base64UrlDecode(subjectValue ?? "");
  const signature = base64UrlDecode(signatureValue ?? "");
  const now = Math.floor(nowMilliseconds / 1000);
  if (
    version !== "v3" ||
    extra !== undefined ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !audience ||
    !subject ||
    subject.byteLength === 0 ||
    subject.byteLength > 256 ||
    !nonce ||
    !signature ||
    signature.byteLength !== 32 ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > AUTH_SESSION_SECONDS
  ) {
    return null;
  }
  const payload = `${version}.${issuedAt}.${expiresAt}.${audienceValue}.${subjectValue}.${nonce}`;
  if (!(await crypto.subtle.verify("HMAC", await sessionKey(secret), signature, textEncoder.encode(payload)))) {
    return null;
  }
  if (new TextDecoder().decode(audience) !== expectedAudience) return null;
  return new TextDecoder().decode(subject);
}

export async function verifyAuthSessionToken(
  token: string,
  secret: string,
  expectedAudience: string,
  nowMilliseconds = Date.now()
): Promise<boolean> {
  return (await verifiedAuthSessionSubject(token, secret, expectedAudience, nowMilliseconds)) !== null;
}

async function createLoginToken(
  secret: string,
  audience: string,
  username: string,
  challengeId: string,
  expiresAtMilliseconds: number,
  nowMilliseconds: number
): Promise<string> {
  const payload = [
    "v1",
    Math.floor(nowMilliseconds / 1000),
    Math.floor(expiresAtMilliseconds / 1000),
    base64UrlEncode(textEncoder.encode(audience)),
    base64UrlEncode(textEncoder.encode(username)),
    base64UrlEncode(textEncoder.encode(challengeId))
  ].join(".");
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), textEncoder.encode(payload));
  return `${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyLoginToken(
  token: string,
  secret: string,
  expectedAudience: string,
  nowMilliseconds: number
): Promise<LoginChallenge | null> {
  const [version, issuedValue, expiresValue, audienceValue, usernameValue, challengeValue, signatureValue, extra] =
    token.split(".");
  const issuedAt = Number(issuedValue);
  const expiresAt = Number(expiresValue);
  const audience = base64UrlDecode(audienceValue ?? "");
  const username = base64UrlDecode(usernameValue ?? "");
  const challenge = base64UrlDecode(challengeValue ?? "");
  const signature = base64UrlDecode(signatureValue ?? "");
  const now = Math.floor(nowMilliseconds / 1000);
  if (
    version !== "v1" ||
    extra !== undefined ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !audience ||
    !username ||
    username.byteLength === 0 ||
    username.byteLength > 64 ||
    !challenge ||
    challenge.byteLength === 0 ||
    challenge.byteLength > 128 ||
    !signature ||
    signature.byteLength !== 32 ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > Math.ceil(TELEGRAM_OTP_EXPIRY_MS / 1000)
  ) {
    return null;
  }
  const payload = `${version}.${issuedAt}.${expiresAt}.${audienceValue}.${usernameValue}.${challengeValue}`;
  if (!(await crypto.subtle.verify("HMAC", await sessionKey(secret), signature, textEncoder.encode(payload)))) {
    return null;
  }
  if (new TextDecoder().decode(audience) !== expectedAudience) return null;
  return {
    username: new TextDecoder().decode(username),
    challengeId: new TextDecoder().decode(challenge)
  };
}

async function otpCodeHash(
  secret: string,
  username: string,
  challengeId: string,
  code: string
): Promise<string> {
  const payload = `finance-telegram-otp.v1\u0000${username}\u0000${challengeId}\u0000${code}`;
  const signature = await crypto.subtle.sign("HMAC", await sessionKey(secret), textEncoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

function generateTelegramOtp(): string {
  const range = 1_000_000;
  const maximum = 0x1_0000_0000 - (0x1_0000_0000 % range);
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= maximum);
  return String(value[0] % range).padStart(6, "0");
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const cookie of header.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator >= 0 && cookie.slice(0, separator).trim() === name) {
      return cookie.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function sessionCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; Max-Age=${AUTH_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`;
}

function loginCookie(token: string, expiresAt: number, now: number): string {
  return `${LOGIN_COOKIE_NAME}=${token}; Path=/; Max-Age=${Math.max(1, Math.ceil((expiresAt - now) / 1000))}; HttpOnly; Secure; SameSite=Strict`;
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

function securityHeaders(scriptNonce?: string): Headers {
  const scriptSource = scriptNonce ? `'nonce-${scriptNonce}'` : "'none'";
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      `default-src 'none'; img-src 'self'; manifest-src 'self'; style-src 'unsafe-inline'; script-src ${scriptSource}; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
}

function htmlResponse(
  body: string,
  init: ResponseInit = {},
  scriptNonce?: string,
  cookies: string[] = []
): Response {
  const headers = securityHeaders(scriptNonce);
  headers.set("Content-Type", "text/html; charset=utf-8");
  if (init.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(body, { ...init, headers });
}

function loginForm(options: LoginPageOptions): string {
  const returnTo = escapeHtml(options.returnTo);
  const username = escapeHtml(options.username ?? "");
  if (options.mode === "telegram-code") {
    return `<p class="subhead">Enter the 6-digit code sent to ${username} on Telegram.</p>
      <form method="post" action="/login">
        <input type="hidden" name="step" value="verify">
        <input type="hidden" name="returnTo" value="${returnTo}">
        <div class="field"><label for="code">Verification code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required autofocus></div>
        <button class="submit" type="submit">Verify code</button>
      </form>
      <div class="secondary-actions">
        <form method="post" action="/login"><input type="hidden" name="step" value="request"><input type="hidden" name="username" value="${username}"><input type="hidden" name="returnTo" value="${returnTo}"><button class="link-button" type="submit">Send a new code</button></form>
        <a href="/login?returnTo=${encodeURIComponent(options.returnTo)}">Use another username</a>
      </div>`;
  }
  if (options.mode === "password") {
    return `<p class="subhead">Use your Slash credentials to continue.</p>
      <form method="post" action="/login">
        <input type="hidden" name="returnTo" value="${returnTo}">
        <div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="submit" type="submit">Sign in</button>
      </form>`;
  }
  return `<p class="subhead">Enter your username to continue.</p>
      <form method="post" action="/login">
        <input type="hidden" name="step" value="request">
        <input type="hidden" name="returnTo" value="${returnTo}">
        <div class="field"><label for="username">Username</label><input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus></div>
        <button class="submit" type="submit">Continue</button>
      </form>`;
}

function loginPage(options: LoginPageOptions): string {
  const error = options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20260729-2"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20260729-2"><link rel="manifest" href="/site.webmanifest?v=20260729-2" crossorigin="use-credentials">
  <meta name="theme-color" content="#09090b"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black"><meta name="apple-mobile-web-app-title" content="Finance">
  <title>Sign in · Finance Dashboard</title>
  <style>
    :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--ink:#09090b;--muted:#71717a;--line:#e4e4e7;--line2:#a1a1aa;--panel:#fff;--page:#fff;--control:#fff;--button:#09090b;--button2:#27272a;--buttonText:#fff;--focus:rgba(24,24,27,.14);--error:#b42318;--errorBg:#fff1f1;--errorLine:#ffd0cc;--track:#f4f4f5;--thumb:#fff;--shadow:0 8px 24px rgba(9,9,11,.05)}
    html[data-theme="dark"]{color-scheme:dark;--ink:#fafafa;--muted:#a1a1aa;--line:#27272a;--line2:#52525b;--panel:#050505;--page:#000;--control:#050505;--button:#fafafa;--button2:#e4e4e7;--buttonText:#000;--focus:rgba(250,250,250,.22);--error:#ff8f85;--errorBg:rgba(180,35,24,.22);--errorLine:rgba(255,143,133,.34);--track:#111;--thumb:#fafafa;--shadow:0 10px 28px rgba(0,0,0,.42)}
    *{box-sizing:border-box}html,body{min-height:100%}body{min-width:320px;margin:0;color:var(--ink);background:var(--page)}button,input{font:inherit}button{cursor:pointer}
    header{position:fixed;inset:0 0 auto;display:flex;align-items:center;justify-content:space-between;min-height:72px;padding:18px 24px;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--page) 94%,transparent);backdrop-filter:blur(16px)}
    .brand{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:760}.brand svg{width:19px;height:19px;color:var(--muted)}
    .theme{width:42px;height:36px;border:1px solid var(--line);border-radius:12px;color:var(--ink);background:var(--track)}.theme svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2}
    main{min-height:100vh;display:grid;place-items:center;padding:104px 24px 48px}.card{width:min(100%,400px);padding:28px;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow)}
    .eyebrow{margin:0 0 10px;color:var(--muted);font-size:11px;font-weight:720;letter-spacing:.09em;text-transform:uppercase}h1{margin:0;font-size:25px;line-height:1.18;letter-spacing:-.04em}.subhead{margin:9px 0 26px;color:var(--muted);font-size:14px;line-height:1.5}
    .field{margin-bottom:17px}label{display:block;margin:0 0 7px;font-size:13px;font-weight:650}input{width:100%;height:42px;padding:0 12px;border:1px solid var(--line);border-radius:10px;outline:none;color:var(--ink);background:var(--control)}input:hover,input:focus{border-color:var(--line2)}input:focus{box-shadow:0 0 0 3px var(--focus)}
    .submit{width:100%;min-height:42px;margin-top:3px;border:0;border-radius:10px;color:var(--buttonText);background:var(--button);font-size:14px;font-weight:680}.submit:hover{background:var(--button2)}
    .error{margin:-5px 0 18px;padding:10px 12px;border:1px solid var(--errorLine);border-radius:10px;color:var(--error);background:var(--errorBg);font-size:13px}.secondary-actions{display:flex;justify-content:space-between;gap:12px;margin-top:18px;font-size:12px}.secondary-actions form{margin:0}.secondary-actions a,.link-button{padding:0;border:0;color:var(--muted);background:transparent;text-decoration:underline;text-underline-offset:3px}
    .session{display:flex;align-items:center;justify-content:center;gap:6px;margin:20px 0 0;color:var(--muted);font-size:12px}.session svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2}
    button:focus-visible,a:focus-visible{outline:3px solid var(--focus);outline-offset:2px}@media(max-width:520px){header{min-height:64px;padding:14px 16px}main{padding:88px 16px 28px}.card{padding:24px 22px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
  </style>
</head>
<body>
  <header><div class="brand"><svg aria-hidden="true" viewBox="0 0 24 24"><rect width="18" height="14" x="3" y="5" rx="2" fill="none" stroke="currentColor"></rect><path d="M3 10h18M7 15h.01" fill="none" stroke="currentColor"></path></svg><span>Finance</span></div><button class="theme" type="button" data-theme-toggle aria-label="Switch color theme"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4 12h2M18 12h2"></path></svg></button></header>
  <main><section class="card" aria-labelledby="login-title"><p class="eyebrow">Secure access</p><h1 id="login-title">Sign in to Finance</h1>${error}${loginForm(options)}<p class="session"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"></path><path d="m9 12 2 2 4-4"></path></svg>Secure session · 12 hours</p></section></main>
  <script nonce="${options.scriptNonce}">(()=>{const key="finance-dash-theme";const root=document.documentElement;let theme="light";try{theme=localStorage.getItem(key)==="dark"?"dark":"light"}catch{}const apply=()=>{root.dataset.theme=theme};apply();document.querySelector("[data-theme-toggle]")?.addEventListener("click",()=>{theme=theme==="dark"?"light":"dark";try{localStorage.setItem(key,theme)}catch{}apply()})})();</script>
</body>
</html>`;
}

function loginHtmlResponse(
  options: Omit<LoginPageOptions, "scriptNonce">,
  init: ResponseInit = {},
  cookies: string[] = []
): Response {
  const scriptNonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(18)));
  return htmlResponse(loginPage({ ...options, scriptNonce }), init, scriptNonce, cookies);
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

function redirect(location: string, cookies: string[] = []): Response {
  const headers = securityHeaders();
  headers.set("Location", location);
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
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

async function hasValidSession(request: Request, secret: string, audience: string): Promise<boolean> {
  const token = cookieValue(request, AUTH_COOKIE_NAME);
  return token ? verifyAuthSessionToken(token, secret, audience) : false;
}

async function hasValidTelegramSession(
  request: Request,
  config: TelegramAuthConfig,
  audience: string
): Promise<boolean> {
  return (await telegramSessionUsername(request, config, audience)) !== null;
}

async function telegramSessionUsername(
  request: Request,
  config: TelegramAuthConfig,
  audience: string
): Promise<string | null> {
  const token = cookieValue(request, AUTH_COOKIE_NAME);
  const subject = token
    ? await verifiedAuthSessionSubject(token, config.sessionSecret, audience)
    : null;
  if (!subject) return null;
  const passwordless = subject.startsWith(PASSWORDLESS_SESSION_SUBJECT_PREFIX);
  const username = passwordless
    ? subject.slice(PASSWORDLESS_SESSION_SUBJECT_PREFIX.length)
    : subject;
  if (!config.users.some((user) => user.normalizedUsername === username)) return null;
  if (passwordless && !config.passwordlessUsernames.has(username)) return null;
  return username;
}

function telegramUser(config: TelegramAuthConfig, username: string): TelegramAuthUser | undefined {
  const normalized = normalizeFinanceUsername(username);
  return config.users.find((user) => user.normalizedUsername === normalized);
}

async function enforceSlashAuth(request: Request, env: AuthEnv, url: URL): Promise<Response | null> {
  const config = slashCredential(env);
  if (!config) return authUnavailable(url.pathname);
  if (url.pathname === "/logout") return redirect("/login", [expiredCookie(AUTH_COOKIE_NAME)]);
  if (url.pathname === "/login") {
    const returnTo = safeReturnTo(request.method === "GET" ? url.searchParams.get("returnTo") : null);
    if (request.method === "GET") {
      return (await hasValidSession(request, config.sessionSecret, url.hostname))
        ? redirect(returnTo)
        : loginHtmlResponse({ mode: "password", returnTo });
    }
    if (request.method !== "POST") {
      return loginHtmlResponse({ mode: "password", returnTo }, { status: 405, headers: { Allow: "GET, POST" } });
    }
    try {
      const form = await readLoginForm(request);
      const formReturnTo = safeReturnTo(form.get("returnTo"));
      const username = form.get("username") ?? "";
      const password = form.get("password") ?? "";
      if (await verifyLoginCredentials(username, password, config.credential)) {
        const token = await createAuthSessionToken(
          config.sessionSecret,
          url.hostname,
          normalizeFinanceUsername(username)
        );
        return redirect(formReturnTo, [sessionCookie(token)]);
      }
      return loginHtmlResponse(
        { mode: "password", returnTo: formReturnTo, error: "Invalid username or password." },
        { status: 401 }
      );
    } catch (error) {
      if (!(error instanceof InvalidLoginBodyError)) throw error;
      return loginHtmlResponse(
        { mode: "password", returnTo: "/", error: "Invalid sign-in request." },
        { status: 400 }
      );
    }
  }
  if (await hasValidSession(request, config.sessionSecret, url.hostname)) return null;
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ message: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const returnTo = safeReturnTo(`${url.pathname}${url.search}${url.hash}`);
  return redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function requestIpAddress(request: Request): string {
  const ipAddress = request.headers.get("CF-Connecting-IP")?.trim();
  return ipAddress && ipAddress.length <= 45 && /^[0-9A-Fa-f:.]+$/u.test(ipAddress)
    ? ipAddress
    : "Unavailable";
}

function requestDevice(request: Request): string {
  const userAgent = request.headers.get("User-Agent") ?? "";
  const platform = /iPhone/iu.test(userAgent)
    ? "iPhone"
    : /iPad/iu.test(userAgent)
      ? "iPad"
      : /Android/iu.test(userAgent)
        ? "Android"
        : /Windows/iu.test(userAgent)
          ? "Windows"
          : /Macintosh|Mac OS X/iu.test(userAgent)
            ? "Mac"
            : /Linux/iu.test(userAgent)
              ? "Linux"
              : "unknown device";
  const browser = /Edg(?:e|A|iOS)?\//iu.test(userAgent)
    ? "Edge"
    : /(?:Chrome|CriOS)\//iu.test(userAgent)
      ? "Chrome"
      : /(?:Firefox|FxiOS)\//iu.test(userAgent)
        ? "Firefox"
        : /Safari\//iu.test(userAgent) && /Version\//iu.test(userAgent)
          ? "Safari"
          : "Unknown browser";
  return `${browser} on ${platform}`;
}

function requestOccurredAt(now: number): string {
  return new Date(now).toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
}

async function requestTelegramLogin(
  request: Request,
  env: AuthEnv,
  config: TelegramAuthConfig,
  url: URL,
  usernameInput: string,
  returnTo: string,
  dependencies: AuthDependencies
): Promise<Response> {
  const now = dependencies.now?.() ?? Date.now();
  const normalizedUsername = normalizeFinanceUsername(usernameInput);
  const user = telegramUser(config, usernameInput);

  if (!user) {
    const generatedChallengeId = crypto.randomUUID();
    const expiresAt = now + TELEGRAM_OTP_EXPIRY_MS;
    const token = await createLoginToken(
      config.sessionSecret,
      url.hostname,
      normalizedUsername || "unknown",
      generatedChallengeId,
      expiresAt,
      now
    );
    return loginHtmlResponse(
      { mode: "telegram-code", returnTo, username: usernameInput.trim() || "that user" },
      {},
      [loginCookie(token, expiresAt, now)]
    );
  }

  if (config.passwordlessUsernames.has(user.normalizedUsername)) {
    try {
      await (dependencies.sendTelegramSignInAlert ?? sendTelegramSignInAlert)(env, user.chatId, {
        username: user.username,
        occurredAt: requestOccurredAt(now),
        ipAddress: requestIpAddress(request),
        device: requestDevice(request)
      });
    } catch {
      return loginHtmlResponse(
        {
          mode: "telegram-username",
          returnTo,
          error: "We couldn’t send the Telegram sign-in alert. Access wasn’t granted. Try again."
        },
        { status: 503 }
      );
    }
    const sessionToken = await createAuthSessionToken(
      config.sessionSecret,
      url.hostname,
      `${PASSWORDLESS_SESSION_SUBJECT_PREFIX}${user.normalizedUsername}`,
      now
    );
    return redirect(returnTo, [sessionCookie(sessionToken), expiredCookie(LOGIN_COOKIE_NAME)]);
  }

  const generatedChallengeId = crypto.randomUUID();
  const generatedCode = dependencies.generateOtp?.() ?? generateTelegramOtp();

  const codeHash = await otpCodeHash(
    config.sessionSecret,
    user.normalizedUsername,
    generatedChallengeId,
    generatedCode
  );
  const state = env.TELEGRAM_OTP_STATE.getByName(`telegram-otp:${user.normalizedUsername}`);
  const result = await state.issueOtp(generatedChallengeId, codeHash, now);
  if (result.status === "rate_limited") {
    return loginHtmlResponse(
      { mode: "telegram-username", returnTo, error: "Too many code requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
    );
  }
  if (result.status === "issued") {
    try {
      await (dependencies.sendTelegramOtp ?? sendTelegramOtp)(
        env,
        user.chatId,
        generatedCode
      );
    } catch {
      await state.cancelOtp(result.challengeId, now);
      return loginHtmlResponse(
        { mode: "telegram-username", returnTo, error: "We couldn’t send the Telegram code. Please try again." },
        { status: 503 }
      );
    }
  }

  const token = await createLoginToken(
    config.sessionSecret,
    url.hostname,
    user.normalizedUsername,
    result.challengeId,
    result.expiresAt,
    now
  );
  return loginHtmlResponse(
    { mode: "telegram-code", returnTo, username: user.username },
    {},
    [loginCookie(token, result.expiresAt, now)]
  );
}

async function verifyTelegramOtp(
  request: Request,
  env: AuthEnv,
  config: TelegramAuthConfig,
  url: URL,
  code: string,
  returnTo: string,
  dependencies: AuthDependencies
): Promise<Response> {
  const now = dependencies.now?.() ?? Date.now();
  const loginToken = cookieValue(request, LOGIN_COOKIE_NAME);
  const challenge = loginToken
    ? await verifyLoginToken(loginToken, config.sessionSecret, url.hostname, now)
    : null;
  const user = challenge ? telegramUser(config, challenge.username) : undefined;
  if (!challenge || !user || !/^[0-9]{6}$/u.test(code)) {
    return loginHtmlResponse(
      {
        mode: challenge && user ? "telegram-code" : "telegram-username",
        returnTo,
        ...(user ? { username: user.username } : {}),
        error: "That code is invalid or has expired. Request a new code."
      },
      { status: 401 },
      challenge ? [] : [expiredCookie(LOGIN_COOKIE_NAME)]
    );
  }

  const codeHash = await otpCodeHash(
    config.sessionSecret,
    user.normalizedUsername,
    challenge.challengeId,
    code
  );
  const result = await env.TELEGRAM_OTP_STATE
    .getByName(`telegram-otp:${user.normalizedUsername}`)
    .verifyOtp(challenge.challengeId, codeHash, now);
  if (result.status === "verified") {
    const sessionToken = await createAuthSessionToken(
      config.sessionSecret,
      url.hostname,
      user.normalizedUsername,
      now
    );
    return redirect(returnTo, [sessionCookie(sessionToken), expiredCookie(LOGIN_COOKIE_NAME)]);
  }
  if (result.status === "invalid") {
    return loginHtmlResponse(
      {
        mode: "telegram-code",
        returnTo,
        username: user.username,
        error: `Incorrect code. ${result.attemptsRemaining} attempts remaining.`
      },
      { status: 401 }
    );
  }
  return loginHtmlResponse(
    { mode: "telegram-username", returnTo, error: "That code has expired. Request a new code." },
    { status: 401 },
    [expiredCookie(LOGIN_COOKIE_NAME)]
  );
}

async function enforceTelegramAuth(
  request: Request,
  env: AuthEnv,
  url: URL,
  dependencies: AuthDependencies
): Promise<Response | null> {
  const config = telegramConfig(env);
  if (!config) return authUnavailable(url.pathname);
  if (url.pathname === "/logout") {
    return redirect("/login", [expiredCookie(AUTH_COOKIE_NAME), expiredCookie(LOGIN_COOKIE_NAME)]);
  }
  if (url.pathname === "/login") {
    const returnTo = safeReturnTo(request.method === "GET" ? url.searchParams.get("returnTo") : null);
    if (request.method === "GET") {
      return (await hasValidTelegramSession(request, config, url.hostname))
        ? redirect(returnTo)
        : loginHtmlResponse({ mode: "telegram-username", returnTo });
    }
    if (request.method !== "POST") {
      return loginHtmlResponse(
        { mode: "telegram-username", returnTo },
        { status: 405, headers: { Allow: "GET, POST" } }
      );
    }
    try {
      const form = await readLoginForm(request);
      const formReturnTo = safeReturnTo(form.get("returnTo"));
      if (form.get("step") === "request") {
        return requestTelegramLogin(
          request,
          env,
          config,
          url,
          form.get("username") ?? "",
          formReturnTo,
          dependencies
        );
      }
      if (form.get("step") === "verify") {
        return verifyTelegramOtp(
          request,
          env,
          config,
          url,
          (form.get("code") ?? "").trim(),
          formReturnTo,
          dependencies
        );
      }
      return loginHtmlResponse(
        { mode: "telegram-username", returnTo: formReturnTo, error: "Invalid sign-in request." },
        { status: 400 }
      );
    } catch (error) {
      if (!(error instanceof InvalidLoginBodyError)) throw error;
      return loginHtmlResponse(
        { mode: "telegram-username", returnTo: "/", error: "Invalid sign-in request." },
        { status: 400 }
      );
    }
  }
  if (await hasValidTelegramSession(request, config, url.hostname)) return null;
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ message: "Authentication required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const returnTo = safeReturnTo(`${url.pathname}${url.search}${url.hash}`);
  return redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function enforceSiteAuthentication(
  request: Request,
  env: AuthEnv,
  dependencies: AuthDependencies = {}
): Promise<Response | null> {
  const url = new URL(request.url);
  if ((request.method === "GET" || request.method === "HEAD") && PUBLIC_APP_ASSET_PATHS.has(url.pathname)) {
    return null;
  }
  return url.hostname === SLASH_APP_HOSTNAME
    ? enforceSlashAuth(request, env, url)
    : enforceTelegramAuth(request, env, url, dependencies);
}

export async function getDashboardSession(
  request: Request,
  env: AuthEnv
): Promise<DashboardSession | null> {
  const url = new URL(request.url);
  if (url.hostname === SLASH_APP_HOSTNAME) {
    const config = slashCredential(env);
    if (!config) return null;
    const token = cookieValue(request, AUTH_COOKIE_NAME);
    const username = token
      ? await verifiedAuthSessionSubject(token, config.sessionSecret, url.hostname)
      : null;
    return username === normalizeFinanceUsername(config.credential.username)
      ? { username: config.credential.username, role: "administrator" }
      : null;
  }

  const config = telegramConfig(env);
  if (!config) return null;
  const normalizedUsername = await telegramSessionUsername(request, config, url.hostname);
  if (!normalizedUsername) return null;
  const user = config.users.find((candidate) => candidate.normalizedUsername === normalizedUsername);
  if (!user) return null;
  return {
    username: user.username,
    role: config.transactionReviewerUsernames.has(normalizedUsername)
      ? "transaction-reviewer"
      : "administrator"
  };
}

export function transactionReviewerCanAccess(request: Request): boolean {
  const url = new URL(request.url);
  if (request.method === "GET") {
    return url.pathname === "/api/session"
      || url.pathname === "/api/transaction-review"
      || url.pathname === "/api/transactions";
  }
  if (request.method !== "POST") return false;
  return /^\/api\/transactions\/[^/]+\/(?:category|company|team)$/u.test(url.pathname);
}
