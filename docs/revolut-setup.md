# Revolut Business API setup

The standard banking setup requests the Revolut Business API `READ` scope. Top-up payment drafts require `READ,WRITE`; the setup helper supports `npm run revolut:setup -- --drafts`. Neither mode requests `PAY`. It generates a fresh RS256 client assertion inside the Worker whenever it refreshes the 40-minute access token.

## 1. Generate the certificate

Run this outside the repository so the private key cannot be committed:

```bash
REVOLUT_SETUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/finance-dash-revolut.XXXXXX")"
chmod 700 "$REVOLUT_SETUP_DIR"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$REVOLUT_SETUP_DIR/privatecert.pem"
chmod 600 "$REVOLUT_SETUP_DIR/privatecert.pem"
openssl req -new -x509 \
  -key "$REVOLUT_SETUP_DIR/privatecert.pem" \
  -out "$REVOLUT_SETUP_DIR/publiccert.cer" \
  -days 1825 \
  -subj "/C=CA/O=Finance Dashboard/CN=finance.thatcanadian.dev"
```

Keep this terminal open. `REVOLUT_SETUP_DIR` exists only in that shell.

## 2. Fill the Revolut form

- Certificate title: `Finance Dashboard`
- OAuth redirect URI: `https://finance.thatcanadian.dev`
- X509 public key: the complete output of `cat "$REVOLUT_SETUP_DIR/publiccert.cer"`, including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines

After continuing, copy the displayed `ClientID`.

## 3. Authorize read-only access and obtain the refresh token

Replace the client ID, then run the helper. It prints the correct `scope=READ` consent URL, prompts for the short-lived authorization code, exchanges it, and stores the refresh token without printing it.

```bash
export REVOLUT_CLIENT_ID='PASTE_CLIENT_ID'
export REVOLUT_ISSUER='finance.thatcanadian.dev'
export REVOLUT_REDIRECT_URI='https://finance.thatcanadian.dev'
export REVOLUT_PRIVATE_KEY_FILE="$REVOLUT_SETUP_DIR/privatecert.pem"
npm run revolut:setup
```

## 4. Store the Cloudflare Worker secrets

`wrangler secret put` deploys a new Worker version. The client ID is entered interactively; the private key and refresh token are read directly from their protected files.

```bash
npx wrangler secret put REVOLUT_CLIENT_ID
npx wrangler secret put REVOLUT_PRIVATE_KEY_PEM < "$REVOLUT_SETUP_DIR/privatecert.pem"
npx wrangler secret put REVOLUT_REFRESH_TOKEN < "$REVOLUT_SETUP_DIR/revolut-refresh-token.txt"
npx wrangler secret list
```

After confirming the three secret names are listed, remove the one-time refresh-token file. Keep the private key in a password manager or another encrypted secret store because it is needed for certificate rotation or disaster recovery.

```bash
rm "$REVOLUT_SETUP_DIR/revolut-refresh-token.txt"
```

Do not enable Revolut production IP whitelisting for this Worker. Cloudflare Workers do not have a stable dedicated egress IP unless a separate fixed-egress architecture is configured. The `READ_SENSITIVE_CARD_DATA` scope is neither requested nor needed.

## Top-up draft permission

Reuse the existing registered certificate/private key and client ID. Run the setup helper with `--drafts`, approve the `READ,WRITE` consent in Revolut, and replace only `REVOLUT_REFRESH_TOKEN` using the protected output file as in step 4. Never add `PAY`. Existing read-only tokens cannot create drafts. This consent must be completed by the Revolut account administrator.

Funding accounts must be reviewed per request in the dashboard. Automatic drafting can use `TOPUP_REVOLUT_DN_ACCOUNT_ID` or `TOPUP_REVOLUT_LMD_ACCOUNT_ID` only after verifying which legal entity owns the account. Do not configure both to the same account merely to make automation run.

## Reauthorize an existing production certificate

If the signing key is already stored only in Cloudflare, use the service-authenticated `POST /api/internal/revolut/authorize` through `npm run revolut:reauthorize -- /absolute/path/to/code.txt`. The administrator must first approve `READ,WRITE` consent (never `PAY`) and finish Revolut verification. Save the short-lived redirect `code` in a mode-600 file outside the repository and run the helper immediately. It exchanges the code with the existing Worker signing key, installs only `REVOLUT_REFRESH_TOKEN` via Wrangler standard input, and removes the code file after success. It does not print either credential. The route rejects browser sessions and unauthenticated callers; it requires the production service token.

`WRITE` is Revolut's broader manage-account permission, including drafts and other account administration. Our integration uses it only for unsent payment drafts. The finance team still sends payments in Revolut.
