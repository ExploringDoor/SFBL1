# Peer review — DVSL Claude session reading LeagueEngine

Reviewer: the Claude session that lives in `~/Desktop/softball-site/`.
Bias: I wrote the source-extraction specs for notifications + chat that this
port was built from, so I'm comparing line-for-line to my own notes. Where
I cite "spec §X.Y" I mean `docs/dvsl-notifications-spec.md` or
`docs/dvsl-attendance-chat-spec.md`.

I did NOT duplicate audit findings. Read PRELAUNCH_AUDIT.md first.

---

## TL;DR

Three findings I'd block on before May 15:
1. **`cleanName` Unicode whitespace normalization is not ported anywhere.** DVSL caught 70+ NBSP-split players in a real audit. SFBL imports a roster from a PDF → instant dup-player bug.
2. **`/api/captain-submit` doesn't verify the captain is in the specific game.** Compounds rules bugs #3/#4 from the audit. Even after the rules fix, this endpoint should defense-in-depth check.
3. **`/api/chat-message` has its own inline copy of the `originFromRequest` bug** the audit fixed in `server-fanout.ts`. Currently masked by the middleware `/api/*` exclusion but a latent re-bite.

Three findings worth fixing soon (not necessarily before launch):
4. `lib/notifications/match.ts` team_chat empty-teamWanted behavior diverges from DVSL — defensive vs permissive.
5. `DEAD_TOKEN_ERROR_CODES` includes `messaging/invalid-argument` which FCM uses for both malformed-token AND malformed-payload — risks pruning live tokens.
6. No equivalent of DVSL's 13-dimension data-integrity audit.

Two LOW-confidence "this scares me" items at the end.

---

## 1. `cleanName` is not ported — high blast radius bug

**File:** none. It does not exist.

**DVSL reference:** `profile.html:48-55`, the `cleanName(n)` helper:
```js
const cleanName = (n) =>
  String(n || "")
    .replace(/\p{Z}/gu, " ")  // every Unicode separator (NBSP, narrow nbsp, ideographic, etc.)
    .replace(/\s+/g, " ")
    .trim();
```

The inline DVSL comment says: *"Past audit caught 70+ NBSP splits across Brooklyn / Titans / Generals rosters."*

**LE state:** searched `lib/`, `scripts/`, `app/api/` for `cleanName`, `\\u00A0`, `\\p{Z}`, `NBSP` — zero hits. `scripts/provision.ts:301-365` uses only `.trim()` when reading CSV player names. `app/api/chat-message/route.ts:204` writes raw `authorName`.

**Concrete launch scenario:** SFBL commissioner exports their roster from a PDF or pastes from a Word doc. The doc contains a non-breaking space in "John  Smith" (U+00A0 between names). Provision creates a player slug from that name. Three weeks later the captain types "John Smith" (regular space) into the captain portal. The player records don't match — captain sees a separate "John Smith" entry without stats. Same bug DVSL hit.

**Recommended fix:** add `cleanName` to `lib/text.ts` (or wherever); apply at:
- `scripts/provision.ts:351` (slug computation + name field)
- `app/api/captain-add-player/route.ts` if it exists
- `app/api/chat-message/route.ts:204` (authorName)
- Anywhere a name is read from external input (CSV, JSON body, form)

About 15 LOC including the helper. High ROI relative to the bug class it prevents.

---

## 2. `/api/captain-submit` doesn't verify game membership server-side

**File:** `app/api/captain-submit/route.ts:113-126, 155-157`

The audit notes that captain-submit "re-verifies game membership server-side before promoting submissions." It does not. The only check is whether the caller is admin or has any `captain:<team_id>` claim for the league. There is no check that `captainTeamId` is `home_team_id` or `away_team_id` of the specific `gameId`.

Line 155-157:
```ts
const derivedSide =
  side ??
  (game.home_team_id === captainTeamId ? "home" : "away");
```

If `captainTeamId` matches neither team in the game (which the audit's rules bug #3+#4 currently allows), this falls through to `"away"` and writes the captain's lineup to the away side of the public box score for a game their team isn't in.

**Why this matters even after the rules fix:** if the rules patch is later regressed (or someone adds a "skip rule check for admin operations" path), this endpoint becomes the next line of defense. Right now it has zero defense.

**Fix:** between line 137 and 138, add:
```ts
if (
  game.home_team_id !== captainTeamId &&
  game.away_team_id !== captainTeamId
) {
  return NextResponse.json(
    { error: "Your team isn't in this game" },
    { status: 403 },
  );
}
```

About 5 LOC. Defense in depth. The same check should also exist in `app/api/captain-schedule/route.ts` — it already has it at line 105-114, so model that block.

---

## 3. `/api/chat-message` duplicates the `originFromRequest` bug

**File:** `app/api/chat-message/route.ts:258-261`

The audit's Fix #1 corrected `lib/notifications/server-fanout.ts:originFromRequest` to prefer `req.url` over `process.env.VERCEL_URL`. But chat-message doesn't import that helper — it has its own inline version that has the OLD (wrong) precedence:

```ts
const origin =
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : new URL(req.url).origin;
```

VERCEL_URL first, req.url second. Same bug the audit said it fixed.

**Why it isn't currently broken:** the audit's Fix #2 added `/api/*` to the middleware matcher exclusion, so when chat-message's outbound fetch lands on `/api/send-notification`, middleware doesn't run and doesn't 404. The bug is masked, not gone.

**Risk:** if someone re-enables middleware on `/api/*` for any reason, this re-breaks. Push fan-out for chat will silently fail in production while staging looks fine.

**Fix:** import and use the shared helper.
```ts
import { originFromRequest } from "@/lib/notifications/server-fanout";
// ...
const origin = originFromRequest(req);
```

Two-line change. Greppable one-shot: `grep -rn "process.env.VERCEL_URL" app/api/` to find any other inline copies (none present today, just chat-message).

---

## 4. `lib/notifications/match.ts` team_chat empty-teamWanted divergence

**File:** `lib/notifications/match.ts:148-162`

DVSL reference (verbatim from spec §1, send-notification.js:251-254):
```js
if (isTeamChat) {
  // Only push to devices whose authenticated player is on the target team.
  if (!teamWanted.length || !tokAuthedTeams.length) continue;
  if (!teamWanted.some(t => tokAuthedTeams.includes(t))) continue;
}
```

DVSL drops the token if EITHER `teamWanted` is empty OR the recipient's `authed_teams` is empty.

LE has:
```ts
let overlap = false;
for (const t of teamWanted) {
  if (authed.has(t)) { overlap = true; break; }
}
if (teamWanted.size && !overlap) {
  rejected.teamChatNotInAuthedTeams++;
  continue;
}
```

This drops only when `teamWanted` is non-empty AND no overlap. **If a team_chat push is sent with an empty `teams[]`/`team`, LE delivers to every recipient who has any non-empty `authed_teams` value within the tenant.** DVSL drops them all.

**Concrete impact:** a coding mistake (developer forgets to set `team:` on a team_chat fetch payload) silently broadcasts that team chat to every player in the league, not just one team. The category-specific filter intended to scope team_chat fails open instead of closed.

**Fix:** add the symmetrical guard.
```ts
if (payload.category === "team_chat") {
  const authed = new Set(tok.authed_teams ?? []);
  if (!teamWanted.size || !authed.size) {
    rejected.teamChatNotInAuthedTeams++;
    continue;
  }
  let overlap = false;
  for (const t of teamWanted) if (authed.has(t)) { overlap = true; break; }
  if (!overlap) {
    rejected.teamChatNotInAuthedTeams++;
    continue;
  }
}
```

Add a unit test for this exact scenario in `tests/notifications/match.test.ts` (or wherever the match-pure-fn tests live).

---

## 5. `DEAD_TOKEN_ERROR_CODES` includes `messaging/invalid-argument`

**File:** `lib/notifications/match.ts:202-206`

```ts
export const DEAD_TOKEN_ERROR_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument", // FCM 400 on malformed token
]);
```

The comment says "FCM 400 on malformed token" but Firebase docs use `invalid-argument` for **both** malformed token AND malformed payload AND quota issues. If your push payload has a bad field (e.g., a stray `null` somewhere), every send returns `invalid-argument` and you start pruning live tokens.

DVSL only used three signals (spec §1):
```
msg.includes('UNREGISTERED')
|| msg.includes('registration-token-not-registered')
|| /FCM\s+404/.test(msg)
```

DVSL deliberately did NOT include `invalid-argument` because of exactly this concern.

**Fix:** drop `messaging/invalid-argument` from the set. Keep the two `registration-token-*` codes; those are unambiguous "token is dead" signals.

If you want to keep handling 400-class errors, log them but do NOT prune. Add a counter on the push log so anomalies surface ("push 400'd 12 tokens this hour, none pruned — investigate").

---

## 6. No equivalent of DVSL's 13-dimension data integrity audit

This is mentioned in PLAN §10 ("Data integrity discipline" lifted from DVSL) but I can't find it in the code. DVSL has scripts that catch real bugs across:
- Game `away_score`/`home_score` matching `box_scores.away_score`/`home_score`
- Schedule fields populated (`date_iso`, `time_24`, `field`, `addr`)
- Day-of-week matching the date
- Time-format consistency (`time` matches `time_24`)
- Field name to address mapping
- Player stats matching their box-score appearances
- Standings matching games' final scores
- `wk` validity (1..N or `PL*`)
- Score range sanity (`< 50`)
- Refs collection cleanup
- Admin draft state cleanup

**Recommended:** before launch, write a single `scripts/audit-tenant.ts <leagueId>` that runs the 6 most useful of these checks. Example skeleton:

```ts
async function audit(leagueId: string) {
  const issues: string[] = [];
  // 1. game.{away,home}_score parity with /box_scores
  // 2. schedule fields (date_iso/time_24/field) populated on all games
  // 3. /players → box-score mention count parity (catch dropped at-bats)
  // 4. /standings totals match sum of game results
  // 5. orphan player_id refs in box scores / availability
  // 6. duplicate player slugs (cleanName collisions)
  return issues;
}
```

Run before SFBL goes live with their imported data; run weekly thereafter.

DVSL's `scripts/audit-game-data.py` is the closest reference (checks 5-6 of the 13 dimensions). Even partial port catches the high-frequency bugs.

---

## 7. captain-submit reads `/box_scores/{gameId}` 4-6× per request

**File:** `app/api/captain-submit/route.ts` lines 174, 178, 182, 195, 235, 269

Same race condition the audit flagged as concern #4. I'm endorsing — this is real, will surface as "Final" pushes firing when the OTHER captain's first submission is actively writing. The reads are cheap individually but the behavior is incorrect under concurrency.

`runTransaction` fixes both the race AND the read-amplification (single read of the doc, all updates batched). Worth doing before SFBL has two captains submitting close in time.

---

## 8. No `cleanHeadline` port (low-priority but worth a stub)

DVSL strips `[submitted: X]` markers from `game.headline` before public render (spec §3 / DVSL profile.html:60-62). If LE ever introduces an internal-only marker convention in headlines or recap text, it'll leak.

LE doesn't currently put bracketed metadata in user-facing strings, so it's not a live bug. But if recap or game-headline editing is added, a `sanitizeHeadline` helper at the render boundary is cheap insurance.

---

## 9. Captain UX — "where do I submit my score?" is the #1 ticket DVSL gets

DVSL captains constantly ask three things:
1. **"Where do I submit my final score?"** — DVSL's answer is the captain dashboard's "Submit Score" tab. Each game card has three buttons: Score Live / Upload / Score Only / Box Score.
2. **"Why isn't my chat going to my team?"** — usually because they haven't enabled push notifications, or `captains_chat` is opt-in (default off — see notifications spec defaults).
3. **"I'm not seeing my team's roster correctly"** — usually the auth → player_link flow hasn't completed (cleanName issue, name mismatch, etc.).

I checked the LE captain dashboard surface (`app/captain/page.tsx` exists, `components/captain/AttendanceTab.tsx`, `TeamChatTab.tsx`, etc.). What I didn't see: a single landing screen that says **"Submit your score for this week's game →"** with an unmissable CTA. Captains who haven't been onboarded find this confusing in DVSL too.

Recommend before launch: add to the captain dashboard's first tab a "Next Up" section listing games awaiting a score from this captain, with a primary-styled "Submit Score" button as the largest tap target. DVSL has `renderNextUp()` doing this in captain.html:863-872 — port that pattern.

Same place: surface chat unread counts with a badge, and surface the player_link state ("✅ linked to John Smith" / "❌ no roster link — tap to link"). Two of the three top tickets become discoverable instead of support.

---

## 10. Two things that scare me (low confidence, flagged anyway)

### 10a. `notification_tokens` doc id is `<token>_<leagueId>`

`firestore.rules:268` says: *"Doc id convention: `<fcm_token>_<leagueId>`"*. FCM tokens contain colons, slashes, and base64url chars. Firestore doc IDs disallow `/` and have other constraints. I'd verify by trying to register a real FCM token end-to-end on the emulator and inspecting the doc id stored. If special chars get URL-encoded somewhere they could double-encode on read, breaking the dismiss-pending-nav lookup.

A safer doc id would be `<sha256(token)>_<leagueId>` (deterministic, fixed-length, no special chars). Not a launch blocker but a "verify works on real iOS push tokens" item.

### 10b. captains_chat default-off vs filter chain interaction

DVSL spec §4: `captains_chat` defaults UNCHECKED in the prefs UI. The filter chain treats empty `categories[]` as subscribe-to-all (DVSL backward-compat).

If a fresh captain registers, the register endpoint stores `categories: ['scores', ...]` excluding `captains_chat` (per spec §2 default 9 categories). Good — they won't get spammed.

But if anyone's `categories` got cleared somewhere (bug, manual reset, edge case), they'd silently start receiving captains_chat pushes because empty = all. The spec's "empty subscribes to all" backward-compat is a *trap* for `captains_chat` specifically.

Recommend: in `lib/notifications/match.ts:140-145`, special-case captains_chat so it's NEVER delivered when `categories[]` is empty:
```ts
if (cats.length === 0 && payload.category === "captains_chat") {
  rejected.categoryNotSubscribed++;
  continue;
}
```

Defense against a future bug, not an active issue. DVSL has the same trap and hasn't been bitten yet.

---

## What I did NOT review (worth knowing what I skipped)

- `lib/stats/{softball,baseball}.ts` — only spot-checked. The stats math is the most testable piece (pure functions) so the test suite catches most issues there. Spec §3 emphasized contract tests per sport; assumed they exist (saw 30+ test files mentioned).
- `app/api/admin-*` endpoints — admin paths get less captain-traffic; lower priority for a captain-launch.
- The full `provision.ts` flow — only checked the name-handling section. Idempotency is asserted in tests.
- All 777 tests — spot-checked rules tests + 1-2 integration files.
- `lib/markdown.ts` — DOMPurify usage is well-tested per audit; trusted.

---

## Tone-check on DVSL pattern fidelity

The big things ported well:
- 9-step filter chain with leagueId at step 1 — solid (one divergence, see §4)
- Schema separates `teams` (user pref) from `authed_teams` (server-set, gates team_chat) — correct
- `categories: string[]` array shape, not `{ [cat]: bool }` object — correct
- Default category list (9 of 11, captains_chat + admin omitted) — correct
- captains_chat (plural) used everywhere — correct (the historical bug avoided)
- 400-doc batch for chat reset — correct
- DOMPurify for admin-edited content — correct
- Photo lightbox pattern — implied by archive/inbox tests, didn't deep-dive

The big thing that did NOT port:
- `cleanName` — see §1
- Server-side game-membership defense — see §2
- 13-dim data audit script — see §6
- "Next Up" surface for captain UX discoverability — see §9

Net assessment: the building Claude got the architecture right. The misses are character-handling + defense-in-depth + UX polish, not structural. Plug §1, §2, §3 before SFBL launch and you're solid.

---

End of review. Adam — happy to go deeper on any of these tomorrow morning if you want a follow-up file. The three blockers are the items in TL;DR. Everything else is shippable-as-is for tenant #1.
