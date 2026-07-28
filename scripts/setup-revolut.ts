import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { exchangeRevolutAuthorizationCode, revolutReadConsentUrl } from "../shared/revolutApi";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const environment = process.env.REVOLUT_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
const clientId = requiredEnvironment("REVOLUT_CLIENT_ID");
const issuer = requiredEnvironment("REVOLUT_ISSUER");
const redirectUri = requiredEnvironment("REVOLUT_REDIRECT_URI");
const privateKeyFile = resolve(requiredEnvironment("REVOLUT_PRIVATE_KEY_FILE"));
const refreshTokenFile = resolve(
  process.env.REVOLUT_REFRESH_TOKEN_FILE?.trim() || resolve(dirname(privateKeyFile), "revolut-refresh-token.txt")
);
const redirectUrl = new URL(redirectUri);

if (redirectUrl.protocol !== "https:" || redirectUrl.hostname !== issuer) {
  throw new Error("REVOLUT_REDIRECT_URI must use https and its hostname must exactly match REVOLUT_ISSUER");
}

const privateKeyPem = await readFile(privateKeyFile, "utf8");
const consentUrl = revolutReadConsentUrl({ environment, clientId, redirectUri });
const prompt = createInterface({ input: stdin, output: stdout });

console.log("\nOpen this read-only Revolut consent URL and approve access:\n");
console.log(consentUrl);
console.log("\nThe authorization code is valid for only two minutes.");
const authorizationCode = await prompt.question("Paste the code query parameter from the redirect URL: ");
prompt.close();

const { refreshToken } = await exchangeRevolutAuthorizationCode({
  environment,
  clientId,
  issuer,
  privateKeyPem,
  authorizationCode
});

await writeFile(refreshTokenFile, `${refreshToken}\n`, { encoding: "utf8", mode: 0o600 });
await chmod(refreshTokenFile, 0o600);
console.log(`\nAuthorization succeeded. The refresh token was written to ${refreshTokenFile} with mode 600.`);
console.log("It was not printed to the terminal.");
