#!/usr/bin/env bash
# KB: see docs/kb/README.md — fails if Tier-2 generated facts are stale vs the
# live schema / API surface. Ignores the volatile `generatedAt` timestamp so a
# no-op re-run is clean. Part of the KB drift discipline (mirrors check-fk-consistency).
set -euo pipefail

cd "$(dirname "$0")/../.."   # -> apps/admin
npx tsx scripts/capture/model-map.ts >/dev/null
npx tsx scripts/capture/route-inventory.ts >/dev/null
npx tsx scripts/capture/coupling-graph.ts >/dev/null
npx tsx scripts/capture/demo-knobs.ts >/dev/null
npx tsx scripts/capture/operator-surfaces.ts >/dev/null

cd ../..                     # -> repo root (git compares the generated/ tree)
if git diff --exit-code -I '"generatedAt":' -- docs/kb/generated/ >/dev/null; then
  echo "✔ KB generated facts fresh."
else
  echo "✖ KB generated facts are STALE — regenerate and commit:"
  echo "    cd apps/admin && npm run kb:model-map && npm run kb:routes && npm run kb:coupling && npm run kb:demo-knobs && npm run kb:operator-surfaces"
  git --no-pager diff --stat -- docs/kb/generated/
  exit 1
fi
