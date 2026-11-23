#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
fix=60c1dbed5050b169bd82343edb56893aa7b06980
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git -C "$root" archive "$fix" -- shared package.json | tar -x -C "$scratch"
ln -s "$root/node_modules" "$scratch/node_modules"
check() { bash "$root/verification/management-report/check.sh" "$1" "$scratch"; }

check "$fix^"
echo '// Nonsemantic change for the control run.' >> "$scratch/shared/managementReport.ts"
check "$fix"

parser="$scratch/shared/managementReport.ts"
sed 's/stableHash/fixtureHash/g' "$parser" > "$scratch/renamed.ts"
grep -Fq 'function fixtureHash(' "$scratch/renamed.ts"
mv "$scratch/renamed.ts" "$parser"
check "$fix"

sed 's/managementReportParserVersion = "2"/managementReportParserVersion = "1"/' "$parser" > "$scratch/reverted.ts"
grep -Fq 'managementReportParserVersion = "1"' "$scratch/reverted.ts"
mv "$scratch/reverted.ts" "$parser"
if check "$fix^" > "$scratch/result.log" 2>&1; then
  echo "The redacted dashboard reused the previous parser version." >&2
  exit 1
fi
grep -F 'Normalized management report changed (dashboard) at version 1. Increment managementReportParserVersion' "$scratch/result.log"
