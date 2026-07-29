import type { WorkerEnv as Env } from "../worker-configuration";
import { timingSafeEqual } from "node:crypto";

const AUTH_COOKIE_NAME = "__Host-finance_session";
const AUTH_SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const textEncoder = new TextEncoder();
const PUBLIC_APP_ASSET_PATHS = new Set([
  "/apple-touch-icon.png",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/site.webmanifest"
]);

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

function htmlResponse(body: string, init: ResponseInit = {}, scriptNonce?: string): Response {
  const headers = securityHeaders(scriptNonce);
  headers.set("Content-Type", "text/html; charset=utf-8");
  if (init.headers) {
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  }
  return new Response(body, { ...init, headers });
}

function loginPage(returnTo: string, scriptNonce: string, error?: string): string {
  const errorMarkup = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20260729-2">
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=20260729-2">
  <link rel="manifest" href="/site.webmanifest?v=20260729-2" crossorigin="use-credentials">
  <meta name="theme-color" content="#09090b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <meta name="apple-mobile-web-app-title" content="Finance">
  <title>Sign in · Finance Dashboard</title>
  <style>
    :root {
      color-scheme: light;
      font-family: "Geist Variable", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --ink: #09090b;
      --muted: #71717a;
      --line: #e4e4e7;
      --line-strong: #a1a1aa;
      --panel: #ffffff;
      --panel-soft: #fafafa;
      --page: #ffffff;
      --control: #ffffff;
      --control-hover: #f4f4f5;
      --button: #09090b;
      --button-hover: #27272a;
      --button-text: #ffffff;
      --focus: rgba(24, 24, 27, .14);
      --shadow: 0 14px 34px rgba(9, 9, 11, .08);
      --shadow-soft: 0 8px 24px rgba(9, 9, 11, .05);
      --error: #b42318;
      --error-bg: #fff1f1;
      --error-border: #ffd0cc;
      --theme-track: #f4f4f5;
      --theme-border: #d4d4d8;
      --theme-option: #71717a;
      --theme-thumb: #ffffff;
      --theme-thumb-color: #09090b;
      --theme-shadow: 0 6px 16px rgba(9, 9, 11, .16);
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --ink: #fafafa;
      --muted: #a1a1aa;
      --line: #27272a;
      --line-strong: #52525b;
      --panel: #050505;
      --panel-soft: #0a0a0a;
      --page: #000000;
      --control: #050505;
      --control-hover: #111111;
      --button: #fafafa;
      --button-hover: #e4e4e7;
      --button-text: #000000;
      --focus: rgba(250, 250, 250, .22);
      --shadow: 0 16px 36px rgba(0, 0, 0, .32);
      --shadow-soft: 0 10px 28px rgba(0, 0, 0, .42);
      --error: #ff8f85;
      --error-bg: rgba(180, 35, 24, .22);
      --error-border: rgba(255, 143, 133, .34);
      --theme-track: #050505;
      --theme-border: #3f3f46;
      --theme-option: #a1a1aa;
      --theme-thumb: #fafafa;
      --theme-thumb-color: #000000;
      --theme-shadow: 0 8px 18px rgba(0, 0, 0, .34);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body { min-width: 320px; min-height: 100vh; margin: 0; color: var(--ink); background: var(--page); }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .site-header {
      position: fixed;
      inset: 0 0 auto;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 72px;
      padding: 18px 24px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--page) 94%, transparent);
      backdrop-filter: blur(16px);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: var(--ink);
      font-size: 15px;
      font-weight: 760;
      letter-spacing: -.02em;
    }
    .brand svg { width: 19px; height: 19px; color: var(--muted); stroke-width: 1.8; }
    .theme-toggle {
      position: relative;
      display: inline-flex;
      flex: 0 0 auto;
      width: 74px;
      height: 36px;
      padding: 3px;
      border: 1px solid var(--theme-border);
      border-radius: 12px;
      color: var(--theme-option);
      background: var(--theme-track);
      box-shadow: var(--shadow-soft);
      transition: border-color .16s, background-color .16s, transform .16s;
    }
    .theme-toggle:hover { border-color: var(--line-strong); transform: translateY(-1px); }
    .theme-option {
      position: relative;
      z-index: 1;
      display: inline-flex;
      width: 32px;
      height: 28px;
      align-items: center;
      justify-content: center;
    }
    .theme-option svg, .theme-thumb svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
    .theme-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      z-index: 2;
      display: grid;
      width: 32px;
      height: 28px;
      place-items: center;
      border-radius: 9px;
      color: var(--theme-thumb-color);
      background: var(--theme-thumb);
      box-shadow: var(--theme-shadow);
      transition: color .18s, background-color .18s, transform .18s;
    }
    .theme-thumb .moon { display: none; }
    html[data-theme="dark"] .theme-thumb { transform: translateX(36px); }
    html[data-theme="dark"] .theme-thumb .sun { display: none; }
    html[data-theme="dark"] .theme-thumb .moon { display: block; }
    .login-shell {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 104px 24px 48px;
    }
    .login-card {
      width: min(100%, 400px);
      padding: 28px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--panel);
      box-shadow: var(--shadow-soft);
    }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 720;
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    h1 { margin: 0; font-size: 25px; line-height: 1.18; font-weight: 760; letter-spacing: -.04em; }
    .subhead { margin: 9px 0 26px; color: var(--muted); font-size: 14px; line-height: 1.5; }
    .field { margin-bottom: 17px; }
    label { display: block; margin: 0 0 7px; color: var(--ink); font-size: 13px; font-weight: 650; }
    input {
      width: 100%;
      height: 42px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      outline: none;
      color: var(--ink);
      background: var(--control);
      box-shadow: 0 1px 2px rgba(9, 9, 11, .04);
      transition: border-color .16s, background-color .16s, box-shadow .16s;
    }
    input:hover { border-color: var(--line-strong); }
    input:focus { border-color: var(--line-strong); box-shadow: 0 0 0 3px var(--focus); }
    input:-webkit-autofill {
      -webkit-text-fill-color: var(--ink);
      box-shadow: 0 0 0 1000px var(--control) inset;
    }
    .submit {
      width: 100%;
      min-height: 42px;
      margin-top: 3px;
      border: 1px solid transparent;
      border-radius: 10px;
      color: var(--button-text);
      background: var(--button);
      box-shadow: 0 10px 22px rgba(9, 9, 11, .16);
      font-size: 14px;
      font-weight: 680;
      transition: background-color .16s, box-shadow .16s, transform .16s;
    }
    .submit:hover { background: var(--button-hover); transform: translateY(-1px); }
    button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    input:focus-visible { outline: none; }
    .error {
      margin: -5px 0 18px;
      padding: 10px 12px;
      border: 1px solid var(--error-border);
      border-radius: 10px;
      color: var(--error);
      background: var(--error-bg);
      font-size: 13px;
      line-height: 1.4;
    }
    .session-note {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin: 20px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    .session-note svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
    @media (max-width: 520px) {
      .site-header { min-height: 64px; padding: 14px 16px; }
      .login-shell { padding: 88px 16px 28px; }
      .login-card { padding: 24px 22px; border-radius: 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <header class="site-header">
    <div class="brand">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect width="18" height="14" x="3" y="5" rx="2" fill="none" stroke="currentColor"></rect>
        <path d="M3 10h18M7 15h.01" fill="none" stroke="currentColor" stroke-linecap="round"></path>
      </svg>
      <span>Finance</span>
    </div>
    <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark mode" aria-pressed="false">
      <span class="theme-option" aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
      </span>
      <span class="theme-option" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
      </span>
      <span class="theme-thumb" data-theme-thumb aria-hidden="true">
        <svg class="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path></svg>
        <svg class="moon" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
      </span>
    </button>
  </header>
  <main class="login-shell">
    <section class="login-card" aria-labelledby="login-title">
      <p class="eyebrow">Secure access</p>
      <h1 id="login-title">Sign in to Finance</h1>
      <p class="subhead">Use your dashboard credentials to continue.</p>
      ${errorMarkup}
      <form method="post" action="/login">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
        <div class="field">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="submit" type="submit">Sign in</button>
      </form>
      <p class="session-note">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"></path><path d="m9 12 2 2 4-4"></path></svg>
        Secure session · 12 hours
      </p>
    </section>
  </main>
  <script nonce="${scriptNonce}">
    (() => {
      const key = "finance-dash-theme";
      const root = document.documentElement;
      const toggle = document.querySelector("[data-theme-toggle]");
      let theme = "light";
      try {
        theme = localStorage.getItem(key) === "dark" ? "dark" : "light";
      } catch {}
      const applyTheme = () => {
        const isDark = theme === "dark";
        root.dataset.theme = theme;
        toggle?.setAttribute("aria-pressed", String(isDark));
        toggle?.setAttribute("aria-label", \`Switch to \${isDark ? "light" : "dark"} mode\`);
      };
      applyTheme();
      toggle?.addEventListener("click", () => {
        theme = theme === "dark" ? "light" : "dark";
        try {
          localStorage.setItem(key, theme);
        } catch {}
        applyTheme();
      });
    })();
  </script>
</body>
</html>`;
}

function loginHtmlResponse(returnTo: string, error?: string, init: ResponseInit = {}): Response {
  const scriptNonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(18)));
  return htmlResponse(loginPage(returnTo, scriptNonce, error), init, scriptNonce);
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
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    PUBLIC_APP_ASSET_PATHS.has(url.pathname)
  ) {
    return null;
  }

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
        : loginHtmlResponse(returnTo);
    }
    if (request.method !== "POST") {
      return loginHtmlResponse(returnTo, undefined, { status: 405, headers: { Allow: "GET, POST" } });
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
      return loginHtmlResponse(formReturnTo, "Invalid username or password.", { status: 401 });
    } catch (error) {
      if (!(error instanceof InvalidLoginBodyError)) throw error;
      return loginHtmlResponse("/", "Invalid sign-in request.", { status: 400 });
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
