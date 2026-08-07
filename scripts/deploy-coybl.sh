#!/usr/bin/env bash
# Deploy COYBL — refuses if this directory is linked to another project.
#
# On 2026-08-07 a parallel session relinked .vercel/project.json to
# island-fastpitch and the next deploy silently shipped to a different
# client's live site. The link is shared mutable state; check it, never
# assume it.
set -euo pipefail
cd "$(dirname "$0")/.."

WANT="coybl-preview"
GOT=$(python3 -c "import json;print(json.load(open('.vercel/project.json')).get('projectName',''))" 2>/dev/null || echo "")

if [ "$GOT" != "$WANT" ]; then
  echo "REFUSING TO DEPLOY."
  echo "  This directory is linked to: ${GOT:-<none>}"
  echo "  Expected:                    $WANT"
  echo
  echo "  Another session probably relinked it. To deploy COYBL:"
  echo "    npx vercel link --project $WANT --yes"
  exit 1
fi

echo "Linked to $GOT — building…"
npm run build >/dev/null 2>&1 || { echo "BUILD FAILED — not deploying."; npm run build 2>&1 | tail -20; exit 1; }
echo "Build clean. Deploying to production…"
npx vercel deploy --prod --yes
