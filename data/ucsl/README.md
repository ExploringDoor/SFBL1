# UCSL — United Coed Softball League (tenant data)

New build (Sept 2026), migrating off LeagueLineup (shut down Aug 2026). Location: **Hamden, CT**. Sport scope: **softball only** for now (volleyball/kickball/soccer deferred — the platform's stats/standings engine covers softball & baseball only).

## What's REAL (recovered from the old GoDaddy site + PDFs)
- **Playing rules** → `content/rules.md` (the full 31-rule 2024 umpire ruleset; seeded to `page_content/rules`).
- **Waiver** → `content/waiver.md` (Waiver & Release of Liability text).
- **Divisions** — Gold / Silver / Bronze (from the 2023 championship pages).
- **Venues** — Hamden Middle, Hamden High, Eli Whitney, Dunbar Hill (in `provision.json` `fields`).
- **About / philosophy / vow, Est. 2016, YouTube** — in `provision.json`.
- **Sponsors (10, with contact details)** and everything else → `recovered-content.json`.
- **Downloadable PDFs** → `public/ucsl/docs/` (umpire rules, waiver & release, roster forms).

## What's PLACEHOLDER (needs the commissioner)
- `teams.csv` — real HISTORICAL team names spread across Gold/Silver/Bronze with **invented W/L + scores** so pages populate. NOT the current roster.
- `schedule.csv` — invented Aug/Sept 2026 games (some final, some upcoming) so schedule/scores/standings render.
- `season_label` "Fall 2026" — an assumption; the recovered source says **Fall 2025**. Confirm.

## Still needed before a real launch
See `recovered-content.json` → `still_needed_from_league` (current roster, current schedule, division assignments, fees/dates, real Facebook URL, sponsor **logo** images, current Approved Bat List, whether 2021 COVID rules still apply).

## Provision (local emulator only)
```bash
# validate
npm run provision:emulator -- --config ./data/ucsl/provision.json --dry-run
# write into the running emulator
npm run provision:emulator -- --config ./data/ucsl/provision.json
# seed the Rules page content
npm run seed:page:emulator -- --league ucsl --page rules --file data/ucsl/content/rules.md
```

Preview (emulator + dev server up): http://ucsl.localhost:3000
Run dev with the emulator env (the shared emulator is usually already running):
```bash
FIRESTORE_EMULATOR_HOST=localhost:8080 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 GCLOUD_PROJECT=league-platform-5f3c8 npm run dev
```
