# Pre-Launch Audit — read this first

Generated 2026-05-04 23:38 PT while you slept. **Updated 2026-05-05 PT
to mark Bugs #3 + #4 fixed.** Single source of truth for what I did
and what's left.

---

## TL;DR — read this paragraph if nothing else

A fresh-eyes reviewer agent (no context from our chats) found **four
real ship-blockers**. **All four are now fixed** with regression
tests:

- **Bug #1 (push fanout broken on Vercel)** — fixed 2026-05-04 night
- **Bug #2 (middleware running on /api/\* routes)** — fixed 2026-05-04 night
- **Bug #3 + #4 (Firestore rules: captain could write lineup/submission
  for games their team isn't in)** — fixed 2026-05-05 morning

Build is clean, typecheck is clean, **781 tests pass under `npm test`**
(which boots the auth + firestore emulators). All four reviewer
findings are now closed.

---

## Status of the four things I said I'd do

| # | Task                                  | Status                  |
|---|---------------------------------------|-------------------------|
| 1 | `npm run typecheck` + `npm run build` | ✅ both clean (exit 0)   |
| 2 | PLAN.md vs reality inventory          | ✅ this doc, sec 3       |
| 3 | Independent fresh-eyes reviewer agent | ✅ found 4 ship-blockers |
| 4 | Visual smoke (emulator + provision)   | ⚠️ skipped — see below   |

**On #4:** Your Firebase emulator is already running on ports 9099+8080.
I detected it and chose NOT to nuke it or pollute it. To do the visual
smoke yourself in 5 minutes tomorrow morning, see "Visual smoke (you do
this)" at the bottom.

---

## SECTION 1 — Ship-blockers I FIXED

### Fix #1: push fan-out broken on Vercel ✅ FIXED + tested

**File:** `lib/notifications/server-fanout.ts` line 78
**Test:** `tests/integration/server-fanout-origin.test.ts` (8 new tests, all passing)

**The bug:** `originFromRequest()` was preferring `process.env.VERCEL_URL`
over the actual request URL. On Vercel, `VERCEL_URL` is the project's
`*.vercel.app` hostname (e.g. `league-platform-abc.vercel.app`). That
host is NOT in `LEAGUEENGINE_APEX_DOMAINS=leagueengine.com,localhost`,
so when `fanoutPush()` fetched `https://${VERCEL_URL}/api/send-notification`,
the middleware tenant-resolver would return 404 BEFORE the API route ran
— silently breaking every push (chat, scores, rainouts, schedule, all of
them). The mutation succeeded, the push didn't fire, no error to the user.

**The fix:** Prefer `req.url`'s origin (which is the user-hit host like
`https://sfbl.leagueengine.com` — a real subdomain that resolves). Fall
back to `VERCEL_URL` only if `req.url` is unparseable.

**To verify:** `npx vitest run tests/integration/server-fanout-origin.test.ts`
(8/8 passing). The "uses request URL even when VERCEL_URL is set" test
is the regression case.

---

### Fix #2: middleware was running on /api/* routes ✅ FIXED

**File:** `middleware.ts` matcher
**Test:** existing `tests/integration/parse-host.test.ts` covers tenant
resolution; the matcher itself is config so doesn't need a unit test.

**The bug:** The matcher was
`/((?!_next/static|_next/image|favicon.ico|...).*)` — it excluded static
assets but NOT `/api/*`. Every API call paid the cost of a Firestore
tenant lookup AND would 404 if the host didn't resolve. Compounds Fix #1
(when fanout fetched a *.vercel.app URL, middleware 404'd it).

**The fix:** Added `api/` to the matcher exclusion. API routes already
do their own bearer-token + claim auth via `getAdminAuth().verifyIdToken`,
so middleware running on them was both wasteful and dangerous.

**Risk of fix:** Low. API routes don't use any of the headers middleware
sets (`x-tenant-host`, `x-tenant-id`, `x-tenant-config-json`) — they
read leagueId from request body. I verified by grep:
`grep -rn "x-tenant" app/api/` returns zero hits.

---

## SECTION 2 — Ship-blockers (now FIXED 2026-05-05) ✅

Both Firestore rules bugs are now patched + tested. New helper
`isCaptainOfDocGame(leagueId, docId)` in `firestore.rules` extracts
the gameId from the doc id and runs `isCaptainOfGameTeam` to verify
the captain is actually in the game (not just that the doc id ends
with their teamId).

### Bug #3 + #4: ✅ PATCHED + verified by tests

- `firestore.rules` updated (new `isCaptainOfDocGame` helper +
  `/lineups` and `/box_score_submissions` rules use it)
- 2 new regression tests in `tests/rules/captain-wrong-team.test.ts`:
  - "captain of team_a CANNOT write lineup for game2 (team_a not in game2)"
  - "captain of team_a CANNOT write box_score_submission for game2"
- `tests/rules/PRELAUNCH-known-bugs.test.ts` deleted (its job is done)
- 98/98 rules tests pass; 781/781 full suite passes via `npm test`

Rules-language quirks discovered along the way: Firestore Rules has
neither `substring()` nor `range()` — final fix uses `split()` (which
the existing `captainTeamId` helper already uses). Edge case
documented in the rule comment: if a gameId itself contains
`_<captainTeamId>` as a substring (e.g. team_id="a", game_id="x_a_y"),
the gameId derived via split is wrong and `isCaptainOfGameTeam` denies
on the wrong path. For SFBL this is theoretical — provision-script
game ids are `g_YYYY_MM_DD_NNN` with no team-name embedding.

### --- ORIGINAL DESCRIPTION (kept for context) ---

### Bug #3 + #4: captain can write lineup/submission for a game their team isn't in

**Files:** `firestore.rules` lines 130-135 (lineups) and 145-152 (box_score_submissions)
**Severity:** Within-tenant data integrity (NOT cross-tenant — leagueId is still scoped via path)
**Documentation test:** `tests/rules/PRELAUNCH-known-bugs.test.ts` (skipped — see below)

**The bug:** Both `match` blocks use this pattern:
```
allow write: if isAdmin(leagueId)
            || (captainTeamId(leagueId) != null
                && lineupId.matches('^.+_' + captainTeamId(leagueId) + '$'));
```

The regex only checks the doc id ENDS with the captain's team id.
It never reads the game doc to verify the captain is actually IN
that game.

**Concrete exploit:**
- Captain of `team_a` in `sfbl`
- Game `g99` is between `team_c` and `team_d` (team_a not in it)
- Captain writes `lineups/g99_team_a` → rule says yes
- Public-read of `/lineups/g99_team_a` returns a fake team_a lineup for g99
- Same with `box_score_submissions/g99_team_a`

**Why this isn't a CATASTROPHIC leak:**
- Still scoped to leagueId via path — no cross-tenant breach
- `/box_scores/{gameId}` itself is protected by `isCaptainOfGameTeam`
  which DOES read the game doc — so the public box-score doc stays clean
- `/api/captain-submit/route.ts` re-verifies game membership server-side
  before promoting submissions to the public box-score doc

**Why it's still a launch issue:**
- Public lineups page reads `/lineups/*` directly — fake lineups will
  render
- Captains in adjacent leagues might confuse this for cross-team write
  ability and try other things
- It's a clear violation of the principle of least privilege spelled
  out in CLAUDE.md ("captain-of-wrong-team blocked")

### What to do tomorrow morning (10–20 minutes):

1. Open `tests/rules/PRELAUNCH-known-bugs.test.ts`
2. Change both `describe.skip(...)` to `describe(...)` (remove the `.skip`)
3. Run `npm run test:rules`
4. **The "proof the exploit works today" tests should PASS** — that's
   confirmation the bug is real on your machine
5. **The "what the rules SHOULD enforce" tests will FAIL** — that's
   your TDD signal
6. Patch `firestore.rules` per the recommended snippet at the top of
   that test file (introduces an `isLineupForCaptainsGame` helper that
   ALSO calls `isCaptainOfGameTeam`)
7. Re-run `npm run test:rules` until all 4 expected-to-fix tests pass
8. Once green, move those tests into `tests/rules/captain-wrong-team.test.ts`
   alongside the existing related tests, and delete the PRELAUNCH file
9. `npm run rules:deploy:staging` → smoke → `npm run rules:deploy:prod`

The recommended fix snippet (verbatim from the test file header):
```
match /lineups/{lineupId} {
  allow read: if true;
  allow write: if isAdmin(leagueId)
              || isLineupForCaptainsGame(leagueId, lineupId);
}

function isLineupForCaptainsGame(leagueId, lineupId) {
  let teamId = captainTeamId(leagueId);
  return teamId != null
    && lineupId.matches('^[a-z0-9-]+_' + teamId + '$')
    && isCaptainOfGameTeam(leagueId, lineupId.split('_' + teamId)[0]);
}
```
And the same shape for `box_score_submissions/{subId}`.

---

## SECTION 3 — High-confidence concerns (not ship-blockers)

These came back from the reviewer; I've sanity-checked each. Order is
"likely-to-bite-on-launch-day" descending.

1. **`/_platform` route doesn't exist.** PLAN §6 promises this for
   monitoring tenant health post-launch. You don't have it. Workaround:
   when SFBL launches, monitor via Vercel dashboard + Firebase console.
   Build /_platform as v1 work.

2. **`billing.status` lapsed-tenant gate is not implemented.** PLAN §5
   says middleware reads `billing.status` and gates writes when lapsed.
   No code reads `billing.status` anywhere. Not a launch blocker
   (SFBL is paid up front), but flag for renewal time.

3. **`team_messages` reads allow ANY authed user in the league.**
   `firestore.rules:204-206`. A captain on KCSL who's also rostered on
   SFBL could read all SFBL team chats. For SFBL launch with one tenant
   it's fine; flag for v1 when you have 2+ tenants and any user might
   be in both.

4. **Race condition in `captain-submit` when both captains hit submit
   close to each other.** The route does sequential read-modify-write on
   `/box_scores/{gameId}` — without a transaction, late-arriving writes
   can clobber the other side's data. Not catastrophic (re-submit fixes
   it), but expect a "where did my data go" support ticket. Use
   `runTransaction` or `FieldValue` updates for the merge sections.
   Defer to post-launch; document for support response.

5. **Admin "submit on behalf" path in captain-submit is dead code.**
   `app/api/captain-submit/route.ts` line 117: when called by an admin,
   `captainTeamId = null` and the entire promotion block is skipped.
   Only `recalcLeague` runs. The route comment claims admin can fix
   submissions; the code doesn't do that. Comment out the misleading
   docstring or remove the admin branch.

6. **No rate limit on `/api/page-content` save.** Admin could
   accidentally spam writes via the debounced editor. 200KB cap helps.
   Consider a debounce-lock at v1.

7. **`scripts/provision.ts` doesn't write `/domains/{hostname}` for
   custom domains.** Not a launch issue (SFBL uses a leagueengine.com
   subdomain). Custom domains are v2 anyway.

---

## SECTION 4 — PLAN.md vs reality inventory

**MVP commitments per PLAN's "Feature Cut" table:**

| MVP feature                                    | Status   | Notes                                    |
|------------------------------------------------|----------|------------------------------------------|
| Hash-routed shell                              | ✅       | Next.js App Router (functional equivalent) |
| Standings (with division filter)               | ✅       | `lib/stats/shared.ts`, 37 tests          |
| Schedule                                       | ✅       | `app/schedule/`                          |
| Scores display                                 | ✅       | `app/scores/`                            |
| Teams pages                                    | ✅       | `app/teams/`                             |
| Players pages                                  | ✅       | `app/players/`                           |
| Admin game entry                               | ✅       | `app/api/admin-team`, related            |
| Captain portal — lineup                        | ✅       | `components/captain/`                    |
| Captain portal — box score editor              | ✅       | `app/captain/box-score/`                 |
| 3-lane scoring                                 | ✅       | `box_score_submissions` per captain      |
| Leaderboards                                   | ✅       | Stats aggregation works                  |
| PWA shell + offline                            | ⚠️       | Manifest + SW exist; offline cache pattern not deeply tested |
| Per-tenant theming (CSS vars)                  | ✅       | `manifest-theming.test.ts`               |
| Rules page (markdown per tenant)               | ✅       | `app/rules/`, `lib/markdown.ts`, 35 XSS tests |
| **Platform admin dashboard at `/_platform`**   | ❌       | **NOT BUILT** — see concern #1           |
| Feature flags (boolean per tenant)             | ⚠️       | Schema present; reading sites unknown    |
| Onboarding intake form                         | ⚠️       | Provision script works; no public form   |

**v1 features (NOT promised for May 15):**
- FCM push — actually IS in MVP code (`lib/notifications/`), tests pass.
  This is ahead of plan.
- Recap cards — ✅ `lib/stats/recap.ts`, 31 tests
- ESPN-style live ticker — ✅ `loadTickerGames`, 17 tests
- Custom domain support — ❌ deferred, no impact on SFBL launch

**CLAUDE.md principles:**

| Principle                                      | Enforcement                              |
|------------------------------------------------|------------------------------------------|
| Multi-tenant from line 1                       | ✅ enforced (rules + path scoping + 24-test boundary suite) |
| Security rules + emulator tests non-negotiable | ✅ rules tests exist, run separately      |
| DOMPurify-sanitize all admin HTML              | ✅ enforced (`lib/markdown.ts`, 35 XSS tests) |
| Don't touch DVSL or Long Beach                 | ✅ no commits outside this repo           |
| TypeScript strict mode                         | ✅ `npm run typecheck` clean              |

---

## SECTION 5 — Test suite state

- **Total:** 776 passing / 6 skipped (the 4 PRELAUNCH-known-bugs tests
  + 2 pre-existing skips) / 3 failed (auth tests that need the
  emulator running on port 9099 which isn't bound right now)
- **Auth-emulator failures:** unrelated to anything I did. `npm run
  test:auth` boots its own emulator and they pass there.
- **Coverage by area:** 30+ test files spanning all critical-path
  endpoints, stats, multi-tenant boundary, push filter, markdown XSS,
  parseHost, provision idempotency, recap, ticker, /games/[id] data
  feed, season-weeks, categories.
- **Zero tests broken by my fixes** — captain-submit, captain-schedule,
  chat-message, parse-host, server-fanout-origin all pass.

---

## SECTION 6 — Visual smoke (you do this in 5 minutes)

I couldn't run this because port 8080 is taken (your dev emulator is
running). To do it yourself:

1. `kill <PID>` on the running Java process (look at `lsof -i :8080`)
2. Or just stop your dev server if you have one
3. In one terminal: `npm run dev:emulators`
4. In another terminal:
   ```
   npm run provision:emulator -- --config scripts/templates/provision.example.json --dry-run
   ```
5. If clean: drop the `--dry-run`
6. Open `http://sfbl.localhost:3000/` — should render with SFBL branding
7. Open `/scores`, `/schedule`, `/standings`, `/teams`, `/players`,
   `/rules` — none should crash

If anything looks visually broken, the most likely culprits are:
- Empty-state UI (we're confident on data layer; UI rendering is
  untested by tests)
- Tenant config missing a field — provision script uses
  `provision.example.json` which has all required fields, so this
  shouldn't happen on the example data
- Logo file missing at `/public/logos/sfbl/sfbl-logo.png` — example
  config references this path but the file may not exist; expect a
  broken image, not a crash

---

## SECTION 7 — What's left before May 15

Hard blockers (you must do these):
- [x] ~~Patch firestore.rules for bugs #3 + #4~~ ✅ done 2026-05-05
- [x] ~~Visual smoke of the dev site against example data~~ ✅ done 2026-05-05 (see SECTION 8 below)
- [ ] **Real-iPhone PWA install + push test** (only verifiable on a
      real iOS device)
- [ ] **Magic-link email deliverability** (only verifiable in prod
      Firebase)
- [ ] **SFBL commissioner data** — logo, brand colors, team list,
      captain emails, full rosters CSV, schedule CSV, rules doc
- [ ] **DNS + Vercel env vars** per `DEPLOY.md` sec 6
- [ ] **Production deploy + 10-curl smoke** per `DEPLOY.md` post-deploy
      smoke section

Soft blockers (recommended before launch):
- [ ] Build `/_platform` admin dashboard, OR confirm you'll monitor
      from Vercel/Firebase consoles
- [ ] Implement `billing.status` gate (or document it as v1)

Post-launch fixes (file as issues):
- captain-submit race condition → use runTransaction
- team_messages cross-team read tightening
- Admin "submit on behalf" path: clarify or remove
- Rate limit on page-content save

---

## What I changed this session (final)

**Files modified:**
- `lib/notifications/server-fanout.ts` — fixed `originFromRequest`
  precedence (Bug #1)
- `middleware.ts` — added `api/` to matcher exclusion (Bug #2)
- `tests/stats/recap.test.ts` — fixed a TS error in a test I wrote
  (POTGPitcherLine field; not a runtime bug)

**Files created:**
- `tests/integration/server-fanout-origin.test.ts` — 8 regression tests
  for Bug #1
- `tests/rules/PRELAUNCH-known-bugs.test.ts` — 6 documentation tests
  for Bugs #3 + #4 (4 fix-asserting + 2 still-passing-as-they-should,
  all skipped)
- `PRELAUNCH_AUDIT.md` — this doc

**Files NOT modified:**
- `firestore.rules` — left for you (Bugs #3 + #4 require careful rule
  editing + emulator test runs)
- Any production config

**No commits made.** Everything is in your working tree. Diff and
commit when you've reviewed.

---

## If something goes sideways

If the typecheck or build is suddenly broken when you wake up,
revert the two files I touched:
```
git diff middleware.ts lib/notifications/server-fanout.ts
git checkout middleware.ts lib/notifications/server-fanout.ts
```
The two fixes are 100% additive (one if-precedence flip + one matcher
exclusion). If reverting doesn't fix the issue, the problem was already
there.

---

Sleep well. The codebase is in good shape — you have two real bugs
to fix, both small, both well-documented. The rest is operational.

---

## SECTION 8 — Visual smoke results (2026-05-05)

Booted `npm run dev:emulators`, ran `npm run provision:emulator -- --config scripts/templates/provision.example.json` (live, not dry), curled every public + auth-gated page on `sfbl.localhost:3000`.

### Bug found + fixed during smoke

`scripts/templates/provision.example.json` referenced `./teams.csv`, `./players.csv`, `./schedule.csv` — but the actual files in that directory are `teams.example.csv`, `players.example.csv`, `schedule.example.csv`. Anyone following SHIPPING_CHECKLIST sec 3 with the example out-of-the-box would have seen `[provision] CSV not found` on dry-run.

**Fix:** updated paths in `provision.example.json` to reference the `.example.csv` files. Templates are now self-consistent — `npm run provision:emulator -- --config scripts/templates/provision.example.json --dry-run` works without any other prep.

### Smoke results

Provisioning: 1 league + 4 teams + 6 players + 4 games = 15 writes, all clean. Admin grant deferred (user must sign in once first — expected).

| Path | Status | Content verified |
|---|---|---|
| `/` (home) | 200 | SFBL brand, logo, ticker shows 4 upcoming games (MIR/MIY/SFA/SFD), date headers Sun 5/10 + Sun 5/17 |
| `/scores` | 200 | Empty state: "No game…first game" |
| `/schedule` | 200 | All 4 games listed (g_2026_05_10_001, g_2026_05_10_002, g_2026_05_17_001, g_2026_05_17_002) |
| `/standings` | 200 | Empty state: "Standings will appear after the first game is final." Heading "Spring 2026 · 4 teams · season starts soon" |
| `/teams` | 200 | All 4 teams (Miami Yankees, Miami Red Sox, SF Dodgers, SF Astros) |
| `/teams/miami_yankees` | 200 | Roster: Aaron Judge #99 RF, Gerrit Cole #45 P |
| `/players` | 200 | Empty state: "Stats will appear once games are played." (leaderboards page; rosters live under /teams/[id]) |
| `/rules` | 200 | Renders (no rules content set; commissioner pastes via admin) |
| `/login` | 200 | Renders |
| `/games/g_2026_05_10_001` | 200 | Box-score page renders for unplayed future game (loadBoxScoreData empty-state path works) |
| `/captain` | 200 | Layout shell renders; client-side auth gate handles content |
| `/admin` | 200 | Same |

### Tenant resolution + theming

- Middleware correctly resolves `sfbl.localhost:3000` → tenant `sfbl`
- Theme color (`#0c4a6e`) injected into `<meta name="theme-color">` and CSS vars
- Logo (`/logos/sfbl/sfbl-logo.png`) referenced in apple-touch-icon
- Apple PWA name "South Florida Baseball League"

### What I COULDN'T smoke (curl-only, no browser)

- Captain portal authenticated content (`/captain` after sign-in) — needs real Firebase Auth flow
- Admin dashboard authenticated content
- PWA install behavior + offline cache
- Push notification delivery
- Score submission end-to-end
- Magic-link email delivery
- Service worker behavior

### Bottom line

The whole **public visitor journey** works on freshly-provisioned data with no finals — homepage, schedule, scores, standings, teams, players, rules, login. Empty states are graceful. Tenant resolution + per-tenant theming work. The only bug I found was a self-inflicted one in the example config (now fixed). The auth-gated paths return 200 shell HTML; their authenticated content needs a real browser session to verify.

**Recommended follow-up:** spend 5-10 min in a real browser at `http://sfbl.localhost:3000/` after running `npm run dev:emulators` + `npm run provision:emulator -- --config scripts/templates/provision.example.json`. You'll see the actual UI rather than HTML grep results.
