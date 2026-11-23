#!/usr/bin/env bash
set -euo pipefail

root=$(pwd -P)
runner="${root}/${1:?expected a verification script followed by Convex module names}"
shift
version=precompiled-2026-08-10-c0cb7ae
backend="${HOME}/.cache/convex/binaries/${version}/convex-local-backend"
scratch=$(mktemp -d)
backend_pid=
cleanup() {
  if [[ -n "$backend_pid" ]]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -x "$backend" ]]; then
  case "$(uname -sm)" in
    'Linux x86_64') platform=x86_64-unknown-linux-gnu; digest=25a5c7c6969b36b382a2651a8e44a30452879b5c8194e89f6e972b5857919d46 ;;
    'Linux aarch64') platform=aarch64-unknown-linux-gnu; digest=f420034e15e6a18e0f251b0cb2908fdc8c0fca2ccc49a4a8d55378dd5e129749 ;;
    'Darwin arm64') platform=aarch64-apple-darwin; digest=95159c96cf9348fc49d94a1fd5bdffb49fe27a5e0442f8787939b4d871ec0b5e ;;
    'Darwin x86_64') platform=x86_64-apple-darwin; digest=2504571b9f1a4c7123abde534153bc72b4c95d7112662084117b2534f6afabdf ;;
    *) echo "Run the local Convex checks on Linux or macOS." >&2; exit 1 ;;
  esac
  curl --fail --silent --show-error --location --retry 3 "https://github.com/get-convex/convex-backend/releases/download/$version/convex-local-backend-$platform.zip" -o "$scratch/backend.zip"
  (cd "$scratch" && echo "$digest  backend.zip" | shasum -a 256 -c - && unzip -q backend.zip)
  backend="$scratch/convex-local-backend"
  chmod +x "$backend"
fi

cd "$scratch"
mkdir convex
ln -s "$root" source
ln -s "$root/node_modules" node_modules
cp "$root/package.json" .
echo 'export { default } from "../source/convex/schema";' > convex/schema.ts
if [[ "${1:-}" == --fixture ]]; then
  fixture_dir=${runner%/*}
  [[ "$fixture_dir" == "$root"/verification/* && -f "$fixture_dir/fixture.ts" ]]
  printf 'export * from "../source/%s/fixture";\n' "${fixture_dir#"$root/"}" > convex/verificationFixture.ts
  shift
fi
for module in "$@"; do
  [[ "$module" =~ ^[[:alnum:]_]+$ && -f "source/convex/$module.ts" ]]
  printf 'export * from "../source/convex/%s";\n' "$module" > "convex/$module.ts"
done
read -r port site_port < <(node --input-type=module -e '
  import { createServer } from "node:net";
  const servers = await Promise.all([0, 1].map(() => new Promise(resolve => {
    const server = createServer().listen(0, "127.0.0.1", () => resolve(server));
  })));
  console.log(...servers.map(server => server.address().port));
  servers.forEach(server => server.close());
')
instance=verify-$port
secret=$(openssl rand -hex 32)
admin_key=$("$backend" keygen admin-key --instance-name "$instance" --instance-secret "$secret")
"$backend" --interface 127.0.0.1 --port "$port" --site-proxy-port "$site_port" --instance-name "$instance" --instance-secret "$secret" --disable-beacon > backend.log 2>&1 &
backend_pid=$!
export TEST_CONVEX_URL="http://127.0.0.1:$port"
for ((i=0; i<150; i++)); do
  if ! kill -0 "$backend_pid" 2>/dev/null; then cat backend.log >&2; exit 1; fi
  if [[ "$(curl -fsS "$TEST_CONVEX_URL/instance_name" 2>/dev/null || true)" == "$instance" ]]; then break; fi
  sleep 0.2
done
[[ "$(curl -fsS "$TEST_CONVEX_URL/instance_name")" == "$instance" ]]
cli=(env -i PATH="$PATH" CI=1 CONVEX_PROVISION_HOST="$TEST_CONVEX_URL" CONVEX_SELF_HOSTED_URL="$TEST_CONVEX_URL" CONVEX_SELF_HOSTED_ADMIN_KEY="$admin_key" "$root/node_modules/.bin/convex")
export TEST_SERVICE_TOKEN
TEST_SERVICE_TOKEN=$(openssl rand -hex 32)
"${cli[@]}" env set CONVEX_SERVICE_TOKEN "$TEST_SERVICE_TOKEN"
if ! "${cli[@]}" deploy --typecheck disable --codegen disable -y > deploy.log 2>&1; then cat deploy.log >&2; exit 1; fi
env -i PATH="$PATH" TEST_CONVEX_URL="$TEST_CONVEX_URL" TEST_SERVICE_TOKEN="$TEST_SERVICE_TOKEN" TEST_CONVEX_ADMIN_KEY="$admin_key" "$root/node_modules/.bin/tsx" "$runner"
