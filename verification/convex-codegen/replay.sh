#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

for revision in a587db0a7dadb71da63dafd7532f78b1d73468bb dcc0c84ef8742c364b618e748fcafed90ea5d58a; do
  checkout="$scratch/$revision"
  mkdir -p "$checkout/verification/convex-codegen"
  git archive "$revision" -- convex shared convex.json package.json | tar -xf - -C "$checkout"
  cp verification/local-convex.sh "$checkout/verification/"
  cp verification/convex-codegen/check.ts "$checkout/verification/convex-codegen/"
  ln -s "$root/node_modules" "$checkout/node_modules"
  if (cd "$checkout" && bash verification/local-convex.sh verification/convex-codegen/check.ts) > "$checkout/check.log" 2>&1; then
    if [[ "$revision" != dcc0c84* ]]; then echo "The stale Convex declarations passed the check." >&2; exit 1; fi
    echo "Confirmed the generated files match the historic fix $revision."
  elif [[ "$revision" == a587db0* ]] && grep -F '+import type * as mediaFundingSourceSchema' "$checkout/check.log"; then
    echo "Caught the missing generated module declaration on $revision."
  else
    cat "$checkout/check.log" >&2
    exit 1
  fi
done
