# lib/gameslate — the GameSlate scheduling engine, side by side

The admin's **Build Schedule** tab can run on one of two engines:

| | File | Who uses it |
|---|---|---|
| Platform engine | `lib/schedule-generator.ts` (+ `lib/schedule-conflicts.ts`) | Every league, unless it opts out. **Not modified** by this arrangement. |
| GameSlate engine | `lib/gameslate/schedule-generator.ts` (+ `schedule-conflicts.ts`) | Leagues with `flags.gameslate_scheduler: true` in their config. ETBL first. |

GameSlate (`~/Desktop/gameslate`, gameslate-nine.vercel.app) took its engine from this repo on 2026-08-13 and then grew it for three weeks — holidays and makeup dates, per-venue availability, game length, rest days, same-coach linking, doubleheaders, a home-venue rule, travel rules, fairness balancing, a quality grade — while this repo's copy grew in a different direction (games-per-team targets, club guessing, host choice). Each fixed bugs the other still has.

Rather than merge the two under every league at once, the GameSlate engine is **copied here verbatim** and switched on per league. A league that has not opted in runs byte-for-byte the code it ran yesterday.

## Files
- `schedule-generator.ts`, `schedule-conflicts.ts` — **do not edit.** Verbatim copies, header says which GameSlate commit. Fix bugs in GameSlate, then `scripts/sync-gameslate-engine.sh`, which also refreshes `tests/gameslate/` (GameSlate's own engine tests, 20 files).
- `rules.ts` — the extra rules the screen collects (game length, one game a day, doubleheaders, gaps, rest days, home-venue rule, rematch spacing, home/away streak cap, home-and-home, linked teams) and the **one normaliser** the screen and the API both run, so bounds live in one place.
- `adapter.ts` — `buildWithGameslate()`: platform-shaped inputs in, platform-shaped `GeneratorResult` out (plus `quality` and `seed`), so the preview, drafts, host-choice picker and Create button are one code path for both engines.

## Turning it on for a league
`"flags": { "gameslate_scheduler": true }` in the league's `provision.json`, re-provision. The rules the admin sets are saved to `site_config/schedule_rules.gameslate` (and `game_minutes`, which the server's conflict gate already honours) by the existing `save_rules` action.

## Tests
`npx vitest run tests/gameslate` — the ported engine tests, `adapter.test.ts`, and `etbl-season.test.ts`, which builds ETBL's real shape (96 teams, 6 divisions, 8 gyms, Saturdays) division by division and proves the union has no double-booking.
