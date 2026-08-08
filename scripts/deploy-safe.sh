#!/usr/bin/env bash
#
# Deploy one league safely, from COMMITTED code, to the RIGHT project.
#
# Usage:
#   scripts/deploy-safe.sh island
#   scripts/deploy-safe.sh coybl  --dry-run
#   scripts/deploy-safe.sh sfbl
#
# ---------------------------------------------------------------------------
# WHY THIS EXISTS
#
# Two things have gone wrong on this repo, both because more than one session
# works in the same folder:
#
#   1. WRONG PROJECT. `.vercel/project.json` is shared mutable state, and
#      deploy-all.sh temporarily repoints it at each project in turn. Run a
#      deploy while that is mid-flight and your code goes to whichever client
#      site the link is parked on. On 2026-08-07 COYBL work shipped to Island
#      Fastpitch's production this way.
#
#   2. WRONG CODE. `vercel deploy` uploads the WORKING DIRECTORY, not the
#      commit — including whatever another session has half-finished. On
#      2026-08-08 Island's live site was serving a build from before July 29
#      (no tenant-island class, every image 404) and had to be rebuilt by hand.
#
# scripts/deploy-coybl.sh guards (1) only, and only for COYBL. This guards
# both, for any tenant, by never deploying the working directory at all:
# it clones HEAD to a temp folder, links THAT folder, builds, deploys, then
# verifies a real asset over HTTP. Your repo's own .vercel/project.json is
# never read and never written, so this is safe to run while another session
# is mid-deploy.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

ORG_ID="team_7O6fyvsxUHRXLc7Fz5dHcajT"

# tenant | project name | project id | live url | an asset that must exist
TENANTS="
island|island-fastpitch|prj_ecoDgk2YDYb7jnMLHaFFy7D1Ph8y|https://island-fastpitch.vercel.app|/island/headers/home.jpg
coybl|coybl-preview|prj_rfvXgVTyTqNVYiaGWeWYExWs9H7r|https://coybl.org|/coybl/og.png
sfbl|sfbl-1|prj_vI6KktUD8lqvd705egSekx5pRrld|https://sfbl.com|/sfbl/favicon.svg
"

TENANT="${1:-}"
DRY_RUN=0
for a in "$@"; do [ "$a" = "--dry-run" ] || [ "$a" = "-n" ] && DRY_RUN=1; done

row=$(printf '%s\n' "$TENANTS" | awk -F'|' -v t="$TENANT" '$1==t {print; exit}')
if [ -z "$row" ]; then
  echo "Usage: scripts/deploy-safe.sh <tenant> [--dry-run]"
  echo
  echo "Known tenants:"
  printf '%s\n' "$TENANTS" | awk -F'|' 'NF>1 {printf "  %-8s -> %s (%s)\n", $1, $2, $4}'
  exit 1
fi

PROJECT=$(echo "$row" | cut -d'|' -f2)
PROJECT_ID=$(echo "$row" | cut -d'|' -f3)
LIVE_URL=$(echo "$row" | cut -d'|' -f4)
PROBE=$(echo "$row" | cut -d'|' -f5)

SHA=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "=============================================================="
echo " Deploying : $TENANT  ->  $PROJECT"
echo " Commit    : $SHA on $BRANCH"
echo " Live URL  : $LIVE_URL"
echo "=============================================================="

# Uncommitted work is NOT an error — another session is probably mid-edit and
# that is normal here. But say plainly what is being left behind, because the
# whole point is that it will not ship.
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  echo
  echo "NOTE: $DIRTY uncommitted file(s) will NOT be deployed:"
  git status --porcelain | sed 's/^/    /'
  echo "  Deploying commit $SHA instead. Commit them first if you want them live."
fi

# Anything committed that imports a file nobody committed will build here (the
# file is on disk) and fail from a clean checkout. Catch it before deploying.
echo
echo "Checking every import resolves to a COMMITTED file…"
python3 - <<'PY'
import subprocess, re, os, sys
tracked = set(subprocess.run(["git","ls-files"],capture_output=True,text=True).stdout.split())
EXT = (".ts",".tsx",".js",".jsx")
def resolve(spec, frm):
    if spec.startswith("@/"): base = spec[2:]
    elif spec.startswith("."): base = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    else: return None
    for c in [base+e for e in EXT] + [base+"/index"+e for e in EXT] + [base]:
        if os.path.isfile(c): return c
    return None
missing = {}
for f in tracked:
    if not f.endswith((".ts",".tsx")): continue
    try: src = open(f, encoding="utf-8").read()
    except Exception: continue
    for m in re.finditer(r'from\s+["\']([^"\']+)["\']|import\(["\']([^"\']+)["\']\)', src):
        r = resolve(m.group(1) or m.group(2), f)
        if r and r not in tracked:
            missing.setdefault(r, set()).add(f)
if missing:
    print("  REFUSING: committed code imports files that are NOT committed.")
    print("  A clean checkout cannot build. Commit these first:\n")
    for k, v in sorted(missing.items()):
        print(f"    {k}")
        print(f"        imported by {sorted(v)[0]}")
    sys.exit(1)
print("  OK — every import is committed.")
PY

WORK="$(mktemp -d)/deploy-$TENANT"
cleanup() { rm -rf "$(dirname "$WORK")"; }
trap cleanup EXIT

echo
echo "Cloning $SHA to a clean folder (your working directory is not touched)…"
git clone -q --local --no-hardlinks --branch "$BRANCH" "$REPO" "$WORK"
cd "$WORK"
[ "$(git rev-parse --short HEAD)" = "$SHA" ] || { echo "clone is not at $SHA — aborting"; exit 1; }

# Reuse the installed modules rather than a fresh npm ci; the lockfile is the
# same commit, and this turns a multi-minute install into a symlink.
ln -s "$REPO/node_modules" node_modules
[ -f "$REPO/.env.local" ] && cp "$REPO/.env.local" .

# Link the CLONE, never the repo. This is what makes the script safe to run
# while deploy-all.sh has the repo's own link repointed somewhere else.
mkdir -p .vercel
printf '{"projectId":"%s","orgId":"%s","projectName":"%s"}' \
  "$PROJECT_ID" "$ORG_ID" "$PROJECT" > .vercel/project.json

echo "Building…"
if ! npx next build >/tmp/deploy-safe-build.log 2>&1; then
  echo
  echo "BUILD FAILED — nothing deployed. Last 25 lines:"
  tail -25 /tmp/deploy-safe-build.log | sed 's/^/    /'
  exit 1
fi
echo "  Build clean."

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "--dry-run: stopping before deploy. Everything above passed."
  exit 0
fi

echo
echo "Deploying to $PROJECT production…"
npx vercel deploy --prod --yes >/tmp/deploy-safe-deploy.log 2>&1 || {
  echo "DEPLOY FAILED. Last 20 lines:"; tail -20 /tmp/deploy-safe-deploy.log | sed 's/^/    /'; exit 1; }

# A deploy that "succeeds" while the site serves an old build is exactly the
# failure this script exists for, so prove it over HTTP rather than trusting
# the CLI's exit code.
echo "Verifying $LIVE_URL$PROBE …"
sleep 5
CODE=$(curl -s -o /dev/null -w '%{http_code}' -L "$LIVE_URL$PROBE")
if [ "$CODE" != "200" ]; then
  echo
  echo "  WARNING: $PROBE returned $CODE, expected 200."
  echo "  The deploy reported success but the live site is not serving that asset."
  echo "  Check the alias in the Vercel dashboard before walking away."
  exit 1
fi
echo "  $PROBE -> 200. Live and serving."
echo
echo "Done. $TENANT is on $SHA."
