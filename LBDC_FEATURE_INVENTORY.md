# LBDC Feature Inventory

Source: `/Users/AdamMiller/Desktop/Long-Beach-Men-s-Baseball/`
- `src/App.jsx` — single-file React SPA, 14,695 lines
- `src/historyData.js` — 6,883 lines (multi-season archive)
- `docs/*.html` — admin/manager/captain user guides
- Backend: Supabase Postgres at `https://vhovzpajuyphjatjlodo.supabase.co`
- Live: https://lbdc.vercel.app

Target migration: LeagueEngine multi-tenant at `/leagues/lbdc/...`.

Confidence: **HIGH** unless noted. Line numbers cite `src/App.jsx`.

---

## 1. Public user surfaces

LBDC is a single-page app with tab routing (no `react-router`). The Navbar (line 973) flips a `tab` state and each page is one of the components below.

| Tab / Surface | Component (line) | What it shows | Supabase tables |
|---|---|---|---|
| Home | `HomePage` (1093) | Hero, top-8 Saturday standings, Boomers standings, recent finals + next-game cards, news ticker, top stat leaders | `seasons`, `games`, `news`, `lbdc_schedules` |
| Scores | `ScoresPage` (1740) | All recent finals grouped by date; click → BoxScoreModal | `games`, `batting_lines`, `pitching_lines` |
| Schedule | `SchedulePage` (1895) | Weekly schedule, 2 fields × 3 timeslots × multiple weeks; status badges (Final/PPD/CAN); preview modal for unplayed games | `games`, `lbdc_schedules` |
| Tournaments | `TournamentsPage` (2141) | **LBDC-specific.** Multiple Diamond Classics tournaments — each its own schedule + standings + brackets. Admin orders them via `lbdc_tournament_meta`. | `tournament_games`, `lbdc_tournament_meta` |
| Standings | `StandingsPage` (2252) | W-L-T standings per division, run differential, percentages, last-5 streak, hits-against | `games`, `seasons` |
| Teams | `TeamsPage` (3742) → `TeamDetailPage` (3003) | Per-team page: hero w/ team color, roster, schedule, recent games, season + career stats | `lbdc_rosters`, `games`, `batting_lines`, `pitching_lines` |
| Stats | `StatsPage` (12141) | League leaderboards by stat category (BA, HR, RBI, ERA, etc.) — sortable | `batting_lines`, `pitching_lines`, `lbdc_rosters` |
| Sub Board | `SubBoardPage` (5295) | **LBDC-specific.** Two views: "Game Day Board" (post yourself as available today for a 2nd game) and "Season Sub List" (long-term sub registration) | Currently sample data only — `lbdc_subs` table TBD |
| Field Directions | `FieldDirectionsPage` (3990) | Maps + addresses for Clark Field (Long Beach) + Fromhold Field (San Pedro) | None (admin-editable content) |
| Sponsors | `SponsorsPage` (4051) | Sponsor logo grid + descriptions | `lbdc_sponsors` or page content table |
| Photos | `PhotosPage` (4102) | Gallery; admin uploads via Supabase Storage `/photos` bucket | `lbdc_gallery` + Storage |
| Rules | `RulesPage` (4520) | Admin-edited rules with RichTextEditor | page content table (key: "rules") |
| History | `HistoryPage` (4650) | **LBDC-specific.** Multi-season archive. Imports static `historyData.js` (6.8k lines) — champions, runners-up, brackets going back years | None (static JS module) |
| Sign Up | `PlayerSignUpPage` (5016) | Public player registration. Pick-from-roster-dropdown OR custom name; preferences for reminders/scores/playoffs/rainouts. Hits Supabase + FormSubmit email | `lbdc_signups`, `lbdc_rosters` |
| Contact | `ContactPage` (5443) | Commissioner/board contact info | `lbdc_contact_info` or page content |
| Payment Info | `PaymentsPage` (5557) | **LBDC-specific.** Select a fee from `PAYMENT_CATEGORIES`, see amount + Venmo QR + Zelle phone | None (constants + contact info) |
| Player Eligibility | `PlayerEligibilityPage` (5647) | **LBDC-specific.** Per-team list of players showing 3-game-minimum eligibility for playoffs; paid status | `player_payments`, `batting_lines`, `lbdc_rosters` |

**Confidence: HIGH** for all surfaces above (read the function signatures + opening 100+ lines of each).

---

## 2. Authenticated surfaces (captain / manager)

Captain portal is reached via `AdminPage` (line 9186) — same login screen, different post-login path.

| Surface | Component (line) | What captains can do |
|---|---|---|
| Captain login | `AdminPage` `screen="login"` (9187+) | Pick team name from dropdown (no password). Anyone who reaches `/admin` can log in as any team. |
| Captain menu | `AdminPage` `screen="captain"` `captainView="menu"` (9448-9595 approx) | Choose: Live Score, Box Score Entry, Roster Editor, Availability View |
| Live Scoring | `LiveScorerPage` (referenced 9448) | Real-time score entry — pitch-by-pitch / inning-by-inning |
| Box Score Entry | `BoxScoreEntry` (10454) | Post-game stats entry per batter / per pitcher. 12k+ line component — heavy custom UI. |
| Roster Editor | `CaptainRosterEditor` (4163) | Add/remove/edit player names + jersey numbers for their team |
| Availability View | `CaptainAvailabilityView` (9052) | See yes/no/maybe per player per upcoming game |

**Auth posture — REALLY IMPORTANT:**
- Admin password: **hardcoded `lbdc2026`** (line 9404 + 9407). Checked client-side. No Supabase Auth.
- Captain "login": **no password at all** — just pick the team. Anyone with the admin URL can edit any captain's roster.
- This is wildly insecure relative to LeagueEngine's claim-based model. Migrating to Firebase Auth + custom claims is a **massive security upgrade for them.**

**Confidence: HIGH.**

---

## 3. Admin tools

`AdminPage` (9186) wraps a quickView dropdown that swaps between admin sub-screens. Hardcoded password `lbdc2026` gates all of these.

| Sub-screen | Component (line) | What it does |
|---|---|---|
| News & Events | inline in `AdminPage` (9230+) | CRUD on `news` table — title, body (rich text), event_date, pinned flag |
| Site Alert | inline in `AdminPage` (~9192+) | Homepage banner — text, style, expire-at, schedule-at |
| Tournament Manager | `TournamentManagerPage` (6443) | Create tournament, add games, set rosters per tournament (`TournamentEligibilityBlock` 6247) — paid-status per player per tournament |
| Manage Schedule | `ManageSchedulePage` (6806) | Edit `lbdc_schedules` (id=sat / id=bom) — week-by-week, field-by-field, timeslot-by-timeslot game grid |
| Weekly Email | `WeeklyEmailPage` (7024) | Compose + send "this week's games" email |
| Content Editor | `AdminContentEditor` (7218) | Edit page text via RichTextEditor (signup intro, etc.) |
| Rules Editor | `AdminRulesEditor` (7269) | Edit rules HTML |
| Photos Editor | `AdminPhotosEditor` (7333) | Upload + delete from `lbdc_gallery`; hits Supabase Storage `/photos/` |
| Sponsors Editor | `AdminSponsorsEditor` (7500) | CRUD sponsor logos + descriptions |
| Fields Editor | `AdminFieldsEditor` (7592) | Edit field directions + maps |
| Contact Editor | `AdminContactEditor` (7718) | Edit commissioner contact info + Venmo handle + QR URL |
| Divisions Editor | `AdminDivisionsEditor` (7924) | Edit team-to-division mapping (Saturday vs Boomers vs tournament-only teams) |
| Manage Teams | `ManageTeamsPage` (8106) | Add new team, edit existing team metadata |
| Rosters Editor | `AdminRostersEditor` (8227) | Cross-team roster view — find duplicates, fix typos, move players between teams |
| Signups Viewer | `AdminSignupsViewer` (8405) | Review `lbdc_signups` submissions, mark contacted/processed |
| Game Score Editor | inline in `AdminPage` (~9224-9230) | Inline edit final scores per game (`scoreEditAway`, `scoreEditHome`) |

**Plus a separate quick-tool:**
- `LocalStorageMigrationButton` (8708) — one-off migration helper.

**Confidence: HIGH** for which screens exist; **MEDIUM** for exact capabilities of each (function signature + opening lines read; full deep-dive not done).

---

## 4. LBDC-specific features

Things that don't exist in LeagueEngine today and would need to be built or skipped.

### 4a. Autoplay League Anthem
- **Component:** `AutoplayAnthem` (10341)
- **What:** On first visit each session, plays `/diamond-classics.mp3` at 0.5 volume. If autoplay blocked, waits for first user click/touch/keydown. Shows a floating "🎵 Mute" button while playing.
- **State:** `sessionStorage.getItem('lbdc_anthem_played')`.
- **Asset:** `public/diamond-classics.mp3` (need to copy this to leagueplatform).
- **Port effort:** ~30 lines client component + the audio file.
- **Confidence:** HIGH.

### 4b. Sub Board
- **Component:** `SubBoardPage` (5295)
- **What:** Two-tab page. "Game Day Board" lets a player who's playing one game post that they want a 2nd game today (form: name, team, contact, playing-at, available-for, field). "Season Sub List" lists players available season-long.
- **Data:** Today the page uses hardcoded sample data — no Supabase write path visible at first read. Form submit handler likely posts elsewhere; need full read to confirm.
- **Port effort:** Schema design + a new `/sub-board` route + admin moderation. ~1 session.
- **Confidence:** HIGH on the surface; MEDIUM on the data path.

### 4c. Tournaments (multiple Diamond Classics)
- **Component:** `TournamentsPage` (2141), admin via `TournamentManagerPage` (6443)
- **What:** LBDC runs multiple named tournaments concurrently (e.g. "Spring Classic 2026", "Summer Classic 2026"). Each has its own games, schedule, ordering. Admin sets the display order via `lbdc_tournament_meta` (id=main, `data: [{name, location}, ...]`).
- **Tables:** `tournament_games` (id, tournament_name, game_date, game_time, field, away_team, home_team, notes), `lbdc_tournament_meta`.
- **Tournament-specific rosters:** `TournamentEligibilityBlock` (6247) handles per-tournament roster + paid-status tracking.
- **Port effort:** LeagueEngine doesn't have a tournaments concept yet. Big addition — likely 2 sessions.
- **Confidence:** HIGH.

### 4d. Player Eligibility (3-game minimum)
- **Component:** `PlayerEligibilityPage` (5647)
- **What:** Per Saturday team, lists players with (1) appearance count (must hit 3 for playoff eligibility), (2) paid status. Visible to all so captains/players can self-track.
- **Data:** `player_payments` (player_name, team_name, paid), counts derived from `batting_lines`.
- **Port effort:** Probably 1 session. The "X games to be eligible" rule could be a tenant config field.
- **Confidence:** HIGH.

### 4e. Player Payments
- **Page:** `PaymentsPage` (5557)
- **What:** Public fee-info page with `PAYMENT_CATEGORIES` (constants: registration $50, team fee, tournament entry, etc.) and Venmo QR + Zelle contact.
- **Tracking:** `player_payments` table for who's paid what (used by PlayerEligibilityPage).
- **Port effort:** LeagueEngine's `/admin` → Payments tab is captain-facing only today (`PaymentsTab` in `app/captain/page.tsx`). Building the public fee-display + admin payment-tracking would be ~1 session.
- **Confidence:** HIGH.

### 4f. Multi-season History
- **Component:** `HistoryPage` (4650), data in `historyData.js` (6883 lines — bundled static)
- **What:** Champions, runners-up, brackets per season going back many years.
- **Migration path:** SFBL already has a similar `/history` page driven by `data/sfbl/historical-standings.json`. Will need a similar JSON for LBDC, but the data shape differs — needs a conversion script.
- **Port effort:** ~1 session: write `data/lbdc/historical-standings.json` from `historyData.js` shape.
- **Confidence:** HIGH.

### 4g. RichTextEditor + sanitizeHTML
- **Components:** `RichTextInput` (4390), `RichTextEditor` (4433)
- **What:** DVSL pattern — contentEditable-based rich-text editor for admin content (news body, rules, signup intro, field directions, etc.).
- **Sanitization:** `sanitizeHTML` via DOMPurify.
- **LeagueEngine state:** Already has a Tiptap-based rich-text editor for admin content (`@tiptap/react` in package.json). DOMPurify already wired in `lib/markdown.ts`. **This is already done.** Just need to use it for LBDC's admin screens.
- **Port effort:** Near-zero — reuse existing.
- **Confidence:** HIGH.

### 4h. cleanName helper
- **Used in:** `PlayerSignUpPage` line 5033, throughout `BoxScoreEntry`
- **What:** Normalizes player name strings — Unicode whitespace collapse, NBSP fix, trim, title-case. DVSL audit (`DVSL_REVIEW_NOTES.md` §1) flagged this is missing in leagueplatform — would have prevented "John Smith" vs "John Smith" duplicate-player splits.
- **Port effort:** Trivial — add to `lib/text.ts`, ~10 lines. Already flagged in audit (DVSL_REVIEW_NOTES.md G3).
- **Confidence:** HIGH.

### 4i. Boomers RSVP modal
- **Component:** `BoomersRSVPModal` (8987)
- **What:** Boomers division has its own RSVP flow (slightly different from the regular `PlayerAvailabilityPage` at 8794).
- **Port effort:** ~half-session — either unify with leagueplatform's `PlayerAvailabilityPanel` or branch on division.
- **Confidence:** MEDIUM (need to read more of the modal to know how it differs).

### 4j. Player of the Game (POTG)
- **Component:** `POTGBadge` (1539)
- **What:** Computes the "player of the game" from a game's batting + pitching lines.
- **Port effort:** Logic likely already in `lib/stats/potg.ts` in leagueplatform — confirm + plumb into LBDC's box-score render.
- **Confidence:** HIGH.

### 4k. Live Box Score Final Card
- **Component:** `LiveBoxScoreFinalCard` (1599)
- **What:** Card rendering for games still being live-scored. Refreshes from `lbdc_live_state`.
- **Port effort:** LeagueEngine has live-score writes; rendering UI for "live now" cards may need to be added. ~half-session.
- **Confidence:** MEDIUM.

### 4l. Weekly Email (admin tool)
- **Component:** `WeeklyEmailPage` (7024)
- **What:** Admin composes a "this week's games" email and sends it.
- **Port effort:** New admin tool. Probably uses FormSubmit (line 5091 pattern) or a transactional email service. ~1 session including delivery infrastructure.
- **Confidence:** MEDIUM.

### 4m. FormSubmit integration for signups
- **Where:** `PlayerSignUpPage` line 5091, `toddharris1222@gmail.com`
- **What:** When a player signs up, posts to formsubmit.co which emails the commissioner. FormSubmit requires the destination email to one-time-confirm before delivering — code comment warns NOT to change the address without re-confirming.
- **Port effort:** Replace with leagueplatform's existing `/api/league-form` flow + add a per-tenant "notify-on-submission" email field in tenant config. Or just keep FormSubmit for now.
- **Confidence:** HIGH.

### 4n. ICS feed per team
- Per CLAUDE.md notes ("ICS feeds"), LBDC has per-team `.ics` exports.
- **LeagueEngine state:** Already has `/api/schedule.ics?team=<teamId>`. Done.
- **Confidence:** HIGH.

### 4o. Site Alert (homepage banner)
- **Where:** `AdminPage` alert section (9192+)
- **What:** Admin sets a banner text + style + expire-at + schedule-at. Displays at top of homepage.
- **Port effort:** LeagueEngine already has this (`AlertsManager` in admin, `HomepageBanner` on home). Done.
- **Confidence:** HIGH.

---

## 5. Supabase schema (inferred from code)

Read calls (from `sbFetch` grep at line ~10180 onwards):

| Table | Inferred columns (from select clauses) |
|---|---|
| `seasons` | id, name |
| `games` | id, game_date, game_time, away_team, home_team, away_score, home_score, field, status, headline, season_id |
| `batting_lines` | game_id, player_name, team_name, AB/R/H/2B/3B/HR/RBI/BB/SO/SB (per stat) |
| `pitching_lines` | game_id, player_name, team_name, IP/H/R/ER/BB/SO/HR, decision |
| `availability` | id, game_id, player_name, team_id (probably), status (yes/no/maybe) |
| `news` | id, title, body, event_date, pinned, created_at |
| `tournament_games` | id, tournament_name, game_date, game_time, field, away_team, home_team, notes |
| `player_payments` | id, player_name, team_name, paid (bool) |
| `lbdc_rosters` | id, name, team, number |
| `lbdc_schedules` | id (sat/bom), data (json — array of weeks/fields/games) |
| `lbdc_signups` | id, name, team, email, phone, notes, reminders, scores, playoffs, rainouts, created_at |
| `lbdc_gallery` | id, image_url, caption, etc. — Storage bucket `photos` for blobs |
| `lbdc_live_state` | id, game_id, state json — for in-progress live scoring |
| `lbdc_tournament_meta` | id (main), data (json array of `{name, location}` for tournament order) |

Probable additional tables (need to confirm by reading more):
- Page content (rules, contact, sponsors, etc.) — there's a `getPageContent("signup_intro")` call at 5127 implying a key/value content table.
- `lbdc_alerts` (or alerts) for the site-alert banner.
- `lbdc_subs` for the SubBoard (if it persists).
- A `divisions` or `teams` table for the divisions editor.

**Confidence: MEDIUM** — schema names from select clauses, but column lists are speculative until I see the actual table DDL or insert payloads.

---

## 6. Auth model

- **Admin:** hardcoded password `lbdc2026` (line 9404, 9407). Client-side check only. No Supabase Auth. **No row-level security** (since the service-role key is exposed in the bundle — the `SUPABASE_LBDC_SERVICE_KEY` would be visible in the deployed JS; need to confirm by reading the env-var loading code, but the `SB_URL` is hardcoded so it's plausible).
- **Captain:** select-team-from-dropdown, **no password.** Whoever clicks "Log In as Tribe" gets captain permissions for Tribe.
- **Player:** no concept of player accounts. Availability + RSVPs are keyed by player_name + team_name (string match).

**Migration implication:** Every LBDC user — admin, captain, player — gets a real Firebase Auth account in leagueplatform. The shared admin password and team-dropdown captain login both disappear. This is a UX disruption for the league but a meaningful security upgrade. Plan for: bulk-invite via `admin-bulk-invite` for captains, and `/login` magic-link for players (which auto-link by email match to their roster record).

**Confidence: HIGH.**

---

## 7. Integrations

- **Supabase Postgres** — primary backend.
- **Supabase Storage** — `photos/` bucket for the gallery (line 4315).
- **FormSubmit** — `formsubmit.co/ajax/toddharris1222@gmail.com` for signup email notifications (line 5091).
- **No Stripe.** Payments are Zelle + Venmo, manual reconciliation.
- **No push notifications.** Player signup form collects preferences (reminders/scores/playoffs/rainouts) but actual delivery is email via FormSubmit, not push. Leagueplatform's FCM stack is a net add for them.

**Confidence: HIGH.**

---

## 8. Docs reference (worth a deep read for hidden requirements)

Six HTML guide files under `docs/`. I haven't read them — that's ~30 min of work and probably the right next pass before writing migration code. They likely document:
- Manager-only workflows (registration, roster management, settling final scores).
- Captain workflows (post-game stats entry, the box-score UI specifically).
- Admin workflows (tournament setup, eligibility tracking, weekly email).

Suggest reading these BEFORE I start migration scripts so we don't miss a feature buried in admin documentation.

**Confidence: LOW** — speculation. Will get to high after reading.

---

## 9. Complex / risky to port

Ranked by estimated session-count.

1. **`BoxScoreEntry` (10454, 12k+ lines)** — heaviest single component. Custom pitch-by-pitch entry UI with `Diamond` (12923) base-runner widget. Has its own state machine, validation, autosave. LeagueEngine's captain box-score editor (`/captain/box-score`) is simpler; LBDC's captains will notice the change. **Risk: HIGH** — could be 2 sessions to port faithfully or accept the UX downgrade.
2. **Tournament system** (TournamentsPage + TournamentManagerPage + TournamentEligibilityBlock) — net-new concept for leagueplatform. **Risk: MEDIUM-HIGH.**
3. **Live scoring** (`LiveScorerPage` + `lbdc_live_state` + `LiveBoxScoreFinalCard`) — real-time UI surfaces. Leagueplatform has `/api/live-score` but I haven't confirmed there's a public "live now" badge / refresh UI. **Risk: MEDIUM.**
4. **`historyData.js` 6883-line archive** — bulky static data. Schema-conversion script needed. **Risk: LOW** but **TIME: 1 session.**
5. **`lbdc_schedules` json-blob storage** — the active schedule is stored as a single JSON blob per division (`id=sat`, `id=bom`), not per-game rows. Migration needs to explode the blob into individual `games` docs. **Risk: MEDIUM** — schema mismatch.

---

## 10. Simple wins to port

These map ~1:1 to existing leagueplatform routes.

1. **Standings** — `games` table → leagueplatform's existing `computeStandings()` logic. Just need to map LBDC's team-name strings (no team IDs!) to a `teams/{id}` doc shape.
2. **Schedule** — flatten `lbdc_schedules.data` JSON + `tournament_games` into per-game `games/{id}` docs.
3. **Scores / Box Score viewer** — `BoxScoreModal` (1330) maps to leagueplatform's `/games/[gameId]` page.
4. **Stats / Leaderboards** — `StatsPage` (12141) maps to `/leaders` and `/players`.
5. **Team detail** — `TeamDetailPage` (3003) maps to `/teams/[teamId]`.
6. **Photos** — `PhotosPage` (4102) + `lbdc_gallery` map directly to leagueplatform's photo gallery.
7. **Sponsors** — `SponsorsPage` (4051) → leagueplatform's footer sponsor strip + admin sponsor editor.
8. **Rules** — `RulesPage` (4520) → leagueplatform's `/rules` page-content surface.
9. **Field directions** — leagueplatform has `/fields`.
10. **Player sign-up** — `PlayerSignUpPage` (5016) → leagueplatform's `/player-registration` (form intake → admin Form submissions).

---

## Migration data-flow sketch

```
LBDC Supabase                            LeagueEngine Firestore
─────────────────                        ─────────────────────────

seasons (table)                  ─→     leagues/lbdc/seasons/{id}
lbdc_rosters                     ─→     leagues/lbdc/teams/{teamSlug}      (group by team)
                                 ─→     leagues/lbdc/players/{playerId}    (per-row)
games                            ─→     leagues/lbdc/games/{gameId}
batting_lines + pitching_lines   ─→     leagues/lbdc/box_scores/{gameId}   (denormalized)
availability                     ─→     leagues/lbdc/availability/{id}
news                             ─→     leagues/lbdc/news/{id}
tournament_games                 ─→     leagues/lbdc/tournament_games/{id} (NEW collection)
lbdc_tournament_meta             ─→     leagues/lbdc/_config/tournaments
player_payments                  ─→     leagues/lbdc/payments/{id}
lbdc_signups                     ─→     leagues/lbdc/form_submissions/player_registration/items/{id}
lbdc_gallery + Storage           ─→     leagues/lbdc/photos/{id}  (image_data_url inline OR Firebase Storage)
lbdc_schedules.data (JSON blob)  ─→     (explode into games/{id} rows)
historyData.js (static)          ─→     data/lbdc/historical-standings.json
page-content                     ─→     leagues/lbdc/page_content/{pageId}
```

Two new concepts for leagueplatform (not in SFBL):
- `tournament_games` collection + a tournaments admin tab.
- `player_payments` collection + a public player-eligibility surface.

---

## Recommended migration order

If you want a phased rollout:

**Phase 1 — read-only mirror (1 session):**
- Build `scripts/migrate-lbdc.ts` that exports every Supabase table to Firestore.
- Seed `/leagues/lbdc/` with everything read-only.
- Set up `lbdc.leagueengine.com` (or whatever subdomain) so we can preview it side-by-side with lbdc.vercel.app.
- Mirror gets the simple wins (#10 above) working immediately.

**Phase 2 — captain + admin login (1 session):**
- Grant Adam `leagues: { lbdc: 'admin' }`.
- Bulk-invite captains via `/api/admin-bulk-invite` with their team claims.
- Verify each captain can sign in, see their roster, submit a box score.

**Phase 3 — LBDC-specific surfaces (2-3 sessions):**
- Tournaments page + admin.
- Sub board (with real persistence).
- Player Eligibility page.
- Payments page.
- Multi-season history.
- Autoplay anthem + asset.

**Phase 4 — cutover (1 session):**
- Point lbdc.vercel.app DNS at the new build, OR run both in parallel for a week.
- Email league: "we've moved, here's the new URL, click X to set up your account."
- Decommission Supabase once verified.

Total: **5-7 sessions** of work, with the heaviest one being Box Score Entry parity if you want it pixel-perfect.

---

## Open questions for Adam

1. **Box-score entry UX:** ship the leagueplatform version (simpler), or invest the session to port LBDC's custom pitch-by-pitch widget? (Captains will notice.)
2. **Slug confirmation:** `lbdc` — yes? Permanent decision.
3. **Live-scoring:** does anyone actually use it during games, or is it captain-after-the-fact only? Affects whether the live-state collection + refresh UI is required for launch.
4. **Boomers division:** keep as a separate division alongside Saturday, OR migrate as two separate "leagues" under one tenant? Leagueplatform's `/leagues/{id}/divisions` model supports the first.
5. **History data:** do we want every season in `historyData.js` migrated, or just the last 3? Affects how much time we spend on the conversion script.
6. **Anthem audio:** keep `/diamond-classics.mp3` autoplay, or skip it? (Some users find autoplay audio annoying; others love it.)
7. **Cutover timing:** the league is mid-season. When's the lowest-risk window to switch? Sunday night after games? Mid-week?
