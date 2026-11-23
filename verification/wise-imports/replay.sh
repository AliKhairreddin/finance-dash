#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

replay() (
  revision=$1
  expected=$2
  mkdir "$scratch/$revision"
  cd "$scratch/$revision"
  git -C "$root" archive "$revision" -- convex shared package.json | tar -xf -
  mkdir -p verification/wise-imports
  cp "$root/verification/local-convex.sh" verification/
  cp "$root/verification/wise-imports/check.ts" verification/wise-imports/
  ln -s "$root/node_modules" node_modules
  if bash verification/local-convex.sh verification/wise-imports/check.ts banking > replay.log 2>&1; then
    echo "The pre-fix code at $revision passed. Check the Wise fixture and model." >&2
    exit 1
  fi
  if ! grep -F "$expected" replay.log; then cat replay.log >&2; exit 1; fi
  echo "Reproduced the Wise failure on $revision."
)

replay 8aa27c7e413114c7f9947e1c9620aacd9909a929 'contains extra field `wiseEntity`'
replay 3a09e812dfd8b4362c2096dd203f36a19859c1e4 '["out 12.34 USD","out 12.34 USD"]'
