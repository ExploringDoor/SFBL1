# ETBL — East Texas Basketball League (tenant data)

New build (Sept 2026) for **BJ Threlkeld**, Mineola, TX (903-497-1187). Youth developmental basketball, roughly 3rd–6th grade. **96 teams / 6 divisions / 7 towns**, run by **one commissioner per town** — no central office. Each town runs its own program (Mineola's is the Mineola Little Dribblers).

First basketball tenant on the platform. `sport: "basketball"` is score-only: standings come from final scores (PCT, tiebreak on point differential), there are no player stats, and the standings columns read PF / PA.

## What's REAL
- League name, abbrev, the contact above, the 96 / 6 / 7 shape, the town count, Mineola as home base, and the league's stated purpose (to prepare kids for middle-school ball, "not a league for coaches to chase rings").
- The site structure: scores, schedule, teams, gyms, standings, sponsors, volunteers, sign-ups by town, admin with per-town commissioner passwords, and an optional live scoreboard (Admin → Scores → **Live** on any unplayed game: Q1–Q4/OT, +1/+2/+3, shows on the home page and game page in real time).

## What's PLACEHOLDER (all marked `demo: true`)
- **Towns** — only Mineola is real; "Town B" … "Town G" are stand-ins.
- **Divisions** — 3rd / 4th / 5th-6th Grade × Boys / Girls (16 teams each). A guess at the shape; the real grade bands may differ.
- **Teams** — `teams.csv`, 96 invented teams (`Mineola 3B Red` …), spread across the towns. Each carries its town in `organization`, which is what the commissioner passwords are gated on.
- **Schedule** — `schedule.csv`, six Saturdays from 2026-08-29 (two with invented scores, four upcoming) so scores, standings and the volunteer generator all have something to show.
- **Gyms** — `fields.json`, one per town (two in Mineola), "Address TBD".
- **Pages** — `pages/*.md` (about, contact, sponsors, rules, and `commissioner-guide`, which is not in the nav — share `/content/commissioner-guide` with the seven commissioners directly). Rules are a generic draft.
- **Branding** — navy / burnt-orange theme, a generated logo and banner. See "Swap the branding" below.
- **Season dates** — `season_label` "2026-27"; the real window is likely Nov–Feb.

Everything above regenerates from `scripts/gen-etbl-demo.mjs` (deterministic). The admin's Health tab has **Remove sample season**, which deletes every `demo: true` team and game (and their box-score docs) and turns the banner off.

## Still needed from the league
- The 7 town names (and each town's commissioner: name, phone, email).
- The 6 real divisions and the team list — ideally as a spreadsheet with team name, town, division, coach.
- The season schedule (dates, times, gyms) or the rules for generating one.
- Gym names and street addresses.
- The rulebook, a logo (square, transparent background), sponsor logos, and the domain name.

## Local bring-up (emulator)

```bash
cd ~/Desktop/league-platform

# 0) placeholder data + brand assets (already committed; re-run to regenerate)
node scripts/gen-etbl-demo.mjs
NODE_PATH=/path/to/any/node_modules/with/sharp node scripts/build-etbl-brand.js   # or: npm i --no-save sharp

# 1) emulators (terminal 1; often already running)
npm run emulators

# 2) validate, then write the tenant, teams and schedule
npm run provision:emulator -- --config ./data/etbl/provision.json --dry-run
npm run provision:emulator -- --config ./data/etbl/provision.json

# 3) pages and gyms
FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=league-platform-5f3c8 node scripts/seed-pages-frontmatter.mjs etbl data/etbl/pages
GCLOUD_PROJECT=league-platform-5f3c8 npm run seed:fields:emulator -- --league etbl --file data/etbl/fields.json

# 4) commissioner passwords (one per town; throwaway values for local dev).
#    --town must match the teams' `organization` spelling exactly (case-insensitive).
while read -r role town; do
  GCLOUD_PROJECT=league-platform-5f3c8 npm run -s set-admin-role:emulator -- --league etbl \
    --role "$role" --town "$town" --scopes scores,volunteers --password "test-$role"
done <<'EOF'
mineola Mineola
town-b Town B
town-c Town C
town-d Town D
town-e Town E
town-f Town F
town-g Town G
EOF

# 5) sanity
npm run audit:tenant:emulator -- --league etbl

# 6) dev server (terminal 2)
ETBL_ADMIN_PASSWORD=etbl-dev FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 GCLOUD_PROJECT=league-platform-5f3c8 npm run dev
```

Preview: http://etbl.localhost:3000 · Admin: http://etbl.localhost:3000/admin (full password `etbl-dev`; a town password such as `test-mineola` lands on Scores + Volunteers for that town only).

## Swap the branding
1. Drop the real logo at `public/etbl/logo.png` (square, transparent background).
2. `node scripts/build-etbl-brand.js` (with sharp on `NODE_PATH`) regenerates the favicons, PWA icons and `og.png`.
3. Replace `public/etbl/banner.svg` (1600×544) or point `theme.banner_url` elsewhere.
4. Colors: `theme.primary / accent / secondary` in `provision.json` (or Admin → Branding once live), then re-provision.

## Replace the placeholder season (the intake sheets)
The league fills in three plain spreadsheets in `intake/` — no ids, just names:

| Sheet | Columns | Notes |
|---|---|---|
| `intake/teams.csv` | `town, division, team, color, coach, coach_phone, coach_email` | One row per team. Spell each town the same way every time (it is what the commissioner passwords key on). Division text like "3rd Grade Boys" turns on the age sections automatically. Colour and coach columns optional; a coach goes to the admin's private coach list (Admin → Captains), never the public site. |
| `intake/schedule.csv` | `date, time, gym, away_team, home_team, division[, away_score, home_score]` | Team names exactly as in teams.csv. `9:00 AM` or `09:00`; `2026-11-07` or `11/7/2026`. Scores only for games already played. |
| `intake/gyms.csv` | `name, town, address, maps_url` | Address gives one-tap directions; `maps_url` optional. |

The rows shipped in those files are examples — replace them. Then:

1. `node scripts/etbl-intake.mjs --dry-run` — validates and summarises (unknown team names, cross-division games, gyms not in the list). Fix the sheets until it is clean.
2. `node scripts/etbl-intake.mjs` — writes `teams.csv`, `schedule.csv`, `fields.json`, updates the gym list in `provision.json` and turns the sample-data banner off.
3. Admin → Health → **Remove sample season** (if it is still up).
4. `npm run provision -- --config ./data/etbl/provision.json` and `npm run seed:fields -- --league etbl --file data/etbl/fields.json` (both idempotent; re-run whenever the sheets change).
5. Set the real commissioner passwords with `npm run set-admin-role` (see step 4 of the bring-up, against production); each `--town` must match the teams' town spelling.

Standings tiebreak is head-to-head, then point differential (`standings.tiebreaker: "h2h"` in `provision.json`). The league is on **Central time** (`timezone: "America/Chicago"`) — that is what the calendar feed and the opening-day countdown use; every other tenant is Eastern by default. Playoffs: Admin → Playoffs builds the bracket; the public page (More → Playoffs) shows it once marked active.

Two more unlinked pages exist for the people running the site: `/content/commissioner-guide` (the seven town commissioners) and `/content/admin-guide` (whoever holds the league password).

## Launch (prod) — the parts Adam does
Vercel project for `etbl` + env vars (see `DEPLOY.md`, plus `ETBL_ADMIN_PASSWORD`); Firebase Auth authorized domain; tell Claude the custom domain **before** DNS moves so it lands in `HOST_ALIAS_BASELINE` (`lib/tenants.ts`) first; then `npm run provision` against prod, `scripts/deploy-safe.sh etbl`, and the `SHIPPING_CHECKLIST.md` smoke.
