#!/usr/bin/env bash
#
# deploy-all.sh — push the CURRENT code in this folder LIVE to every league
# site at once, on purpose.
#
# Why this exists: every league site shares this one codebase, but each is a
# separate Vercel project with its own domain, so "update everyone" means one
# production deploy per site. Auto-build on git push used to do this wastefully
# (a throwaway preview build on every half-finished commit). This does it
# deliberately: one real deploy per site, only when you run it.
#
# Usage:
#   bash scripts/deploy-all.sh              # lists the sites, asks to confirm
#   bash scripts/deploy-all.sh --dry-run    # show what it WOULD do, build nothing
#   bash scripts/deploy-all.sh -y           # skip the confirmation prompt
#
# It ships whatever is in this folder RIGHT NOW, including uncommitted changes —
# so commit/push first if you want git to match what went live.
#
# It briefly repoints .vercel/project.json at each site and ALWAYS puts your
# original link back when it finishes (even on error or Ctrl-C). Don't run it at
# the same moment your other window is deploying.

set -uo pipefail

ORG_ID="team_7O6fyvsxUHRXLc7Fz5dHcajT"

# --- the league sites to deploy -------------------------------------------
# "Label|ProjectID" — add or remove a line to change who gets updated.
# LBDC is intentionally left out (you asked to stop updating it). To include it
# in a release, delete the leading "# " on its line.
TENANTS=(
  "Island Fastpitch (island-fastpitch.vercel.app)|prj_ecoDgk2YDYb7jnMLHaFFy7D1Ph8y"
  "COYBL (coybl.net)|prj_rfvXgVTyTqNVYiaGWeWYExWs9H7r"
  "SFBL (sfbl.com)|prj_vI6KktUD8lqvd705egSekx5pRrld"
  # "LBDC (lbdc1.vercel.app)|prj_eAzA97QQx4LPt3goJ0gMbKHxpFep"
)

# --- flags ----------------------------------------------------------------
AUTO_YES=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) AUTO_YES=1 ;;
    -n|--dry-run) DRY_RUN=1 ;;
    -h|--help)
      echo "Usage: bash scripts/deploy-all.sh [--dry-run] [-y]"; exit 0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# --- run from the repo root so .vercel is found ---------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- snapshot the current Vercel link and guarantee we restore it ---------
LINK=".vercel/project.json"
BACKUP="$(mktemp)"
HAD_LINK=0
if [ -f "$LINK" ]; then cp "$LINK" "$BACKUP"; HAD_LINK=1; fi
restore_link() {
  if [ "$HAD_LINK" -eq 1 ]; then mkdir -p .vercel; cp "$BACKUP" "$LINK"
  else rm -f "$LINK"; fi
  rm -f "$BACKUP"
}
trap restore_link EXIT

# --- show the plan --------------------------------------------------------
echo
if [ "$DRY_RUN" -eq 1 ]; then echo "DRY RUN — nothing will be built."; echo; fi
echo "This will deploy the CURRENT code in this folder to PRODUCTION on:"
for t in "${TENANTS[@]}"; do echo "   • ${t%%|*}"; done
echo "(each site builds separately, ~2-4 min each)"
echo
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "!  You have uncommitted changes — they WILL go live on every site above."
  echo
fi

# --- confirm --------------------------------------------------------------
if [ "$DRY_RUN" -ne 1 ] && [ "$AUTO_YES" -ne 1 ]; then
  read -r -p "Deploy all of these now? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Cancelled."; exit 0 ;;
  esac
fi

# --- deploy each in turn --------------------------------------------------
mkdir -p .vercel
OK=()
FAIL=()
for t in "${TENANTS[@]}"; do
  label="${t%%|*}"
  pid="${t##*|}"
  echo
  echo "──────────────────────────────────────────────"
  echo ">  $label"
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "   [dry-run] would deploy project $pid to production"
    OK+=("$label")
    continue
  fi
  printf '{"orgId":"%s","projectId":"%s"}\n' "$ORG_ID" "$pid" > "$LINK"
  if npx vercel deploy --prod --yes; then
    OK+=("$label")
  else
    FAIL+=("$label")
    echo "x  FAILED: $label (continuing with the rest)"
  fi
done

# --- summary --------------------------------------------------------------
echo
echo "════════════ deploy-all summary ════════════"
if [ ${#OK[@]} -gt 0 ];   then for l in "${OK[@]}";   do echo "  ok   $l"; done; fi
if [ ${#FAIL[@]} -gt 0 ]; then for l in "${FAIL[@]}"; do echo "  FAIL $l"; done; fi
echo
if [ ${#FAIL[@]} -eq 0 ]; then
  [ "$DRY_RUN" -eq 1 ] && echo "Dry run OK — remove --dry-run to deploy for real." \
                       || echo "Done. Every site above is now running the current code."
else
  echo "${#FAIL[@]} site(s) failed — rerun or deploy those by hand."
  exit 1
fi
