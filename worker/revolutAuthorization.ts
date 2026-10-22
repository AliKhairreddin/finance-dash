import { exchangeRevolutAuthorizationCode } from "../shared/revolutApi";
import { boundedBytes, secureHeaderMatches } from "./documentIntake";

// Only the local administrator setup helper uses this route. The existing signing
// key stays inside the Worker; the new token is installed through Wrangler stdin.
export async function handleRevolutAuthorization(request: Request, env: WorkerEnv): Promise<Response> {
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  if (request.method !== "POST" || !env.CONVEX_SERVICE_TOKEN || !await secureHeaderMatches(request.headers.get("Authorization"), `Bearer ${env.CONVEX_SERVICE_TOKEN}`)) return respond({ message: "Unauthorized" }, 401);
  try {
    const body = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 4096)));
    if (typeof body.code !== "string" || !body.code.trim() || body.code.length > 2000) return respond({ message: "Invalid authorization code" }, 400);
    const { refreshToken } = await exchangeRevolutAuthorizationCode({ environment: env.REVOLUT_ENVIRONMENT, clientId: env.REVOLUT_CLIENT_ID, issuer: env.REVOLUT_ISSUER, privateKeyPem: env.REVOLUT_PRIVATE_KEY_PEM, authorizationCode: body.code });
    return respond({ refreshToken });
  } catch { return respond({ message: "Revolut authorization failed. Start a fresh consent flow." }, 400); }
}
