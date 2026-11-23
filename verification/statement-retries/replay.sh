#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

replay() (
  revision=$1
  reason=$2
  mkdir "$scratch/$revision"
  cd "$scratch/$revision"
  git -C "$root" archive "$revision" -- convex shared worker package.json | tar -xf -
  mkdir -p verification/statement-retries
  cp "$root/verification/local-convex.sh" verification/
  cp "$root/verification/statement-retries/"{check,fixture}.ts verification/statement-retries/
  ln -s "$root/node_modules" node_modules
  if bash verification/local-convex.sh verification/statement-retries/check.ts --fixture statements statementProcessing > output.log 2>&1; then
    echo "Unexpected pass on $revision" >&2
    exit 1
  fi
  if ! grep -F "$reason" output.log; then cat output.log >&2; exit 1; fi
  echo "Reproduced the statement retry failure on $revision."
)

replay 87cb0746479c5907af00e88f829b2181b5dd3bb1 'Stored OCR retry must honor Retry-After: 7200'
replay 63e73bae20a1f51cb53e6d960b72601776c71b39 'old callback in old callback, claim, old worker failure'
