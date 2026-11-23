#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
base=${1:?Pass the pull request base commit or the parent of the change}
candidate=${2:-$root}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
git -C "$root" archive "$base" -- shared package.json | tar -x -C "$scratch"
ln -s "$root/node_modules" "$scratch/node_modules"
"$root/node_modules/.bin/tsx" "$root/verification/management-report/check.ts" "$scratch" "$candidate"
