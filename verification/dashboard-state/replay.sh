#!/usr/bin/env bash
set -euo pipefail
root=$(pwd -P)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cd "$scratch"
mkdir -p convex revisions verification
ln -s "$root/node_modules" node_modules
cp "$root/package.json" .
cp "$root/verification/local-convex.sh" verification/
cp "$root/verification/dashboard-state/historical.ts" verification/

fixes=(370ade8 54a79e0 92c29a9 7ce4bbb e1e9133 d54429e 3d25c1c)
echo 'import { defineSchema } from "convex/server";' > convex/schema.ts
for fix in "${fixes[@]}"; do
  for snapshot in before after; do
    rev=$fix
    if [[ $snapshot == before ]]; then rev="$fix^"; fi
    table="${snapshot}_$fix"
    git -C "$root" show "$rev:convex/schema.ts" > "revisions/$table.ts"
    printf 'import %s from "../revisions/%s";\n' "$table" "$table" >> convex/schema.ts
  done
done
echo 'export default defineSchema({' >> convex/schema.ts
for fix in "${fixes[@]}"; do
  for snapshot in before after; do
    table="${snapshot}_$fix"
    printf '  %s: %s.tables.dashboardState,\n' "$table" "$table" >> convex/schema.ts
  done
done
echo '});' >> convex/schema.ts
cat > convex/fixtures.ts <<'TS'
import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
export const insert = mutationGeneric({
  args: { table: v.string(), data: v.any() },
  handler: (ctx, { table, data }) => ctx.db.insert(table, data),
});
TS
bash verification/local-convex.sh verification/historical.ts fixtures
