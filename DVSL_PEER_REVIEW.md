# Peer review request — for the DVSL Claude Code session

Hi. You're the Claude session that lives in `~/Desktop/softball-site/`
working on DVSL. Adam is asking you to look at a sibling project he's
been building in another window and give him independent feedback
before its first paying league launches **next Friday (May 15, 2026)**.

---

## What you're looking at

**Project:** LeagueEngine — a multi-tenant SaaS platform that turns
DVSL's pattern (and Long Beach's) into one platform that can host many
leagues. Different sport configs (baseball/softball), per-tenant
theming, custom claims-based auth scoped by `leagueId`, captain portal,
admin dashboard.

**Goal of this session:** SFBL (South Florida Baseball League) flips on
as tenant #1 on May 15. KCSL (softball, ~41 teams) is tenant #2 a few
weeks after.

**What you bring that the building Claude doesn't:** you've been deep
in DVSL's actual production code for months. You know what's hard about
running a real league, what captains actually do at 9pm Saturday, what
the chat trigger sites look like in DVSL's `captain.html`, where the
data integrity audit caught real bugs. The building Claude has read
DVSL's patterns but hasn't lived with the consequences. Your eyes will
catch things mine won't.

---

## Repo path

```
/Users/AdamMiller/Desktop/league-platform/.claude/worktrees/awesome-brahmagupta-6b27b6
```

That's a git worktree. Read whatever you want there. Everything is
local, no remote configured yet.

---

## Read these first (in order)

1. **`PLAN.md`** — full architecture spec, feature cut, timeline.
   Section 1-3 cover tenancy, data isolation, sport variants. Section
   10 is the DVSL pattern transfer checklist — useful to see what was
   lifted vs left behind.

2. **`PRELAUNCH_AUDIT.md`** — what an independent reviewer agent found
   tonight. Has 4 ship-blockers (2 fixed, 2 firestore-rules bugs left
   for Adam). Read this before deep-diving so you don't duplicate
   findings.

3. **`CLAUDE.md`** — the project's own instructions for Claude Code.
   The principles section is the contract.

---

## Highest-leverage files to review (your call which matter)

**Multi-tenant boundary (this is the whole point):**
- `middleware.ts` — front door, hostname → tenant
- `lib/tenants.ts` — tenant resolution, parseHost, Edge cache stub
- `firestore.rules` — security rules. Look at line 130-152 specifically
  (this is where the audit found the lineup/submissions rules bugs)

**The crown-jewel endpoint (3-lane scoring promotion):**
- `app/api/captain-submit/route.ts` — captain marks submission final,
  server promotes to public box_score, runs recalc, fires push. This
  has the highest blast radius.
- `app/api/captain-schedule/route.ts` — rainouts, reschedules, audit log

**Push fan-out (the soul of multi-tenant isolation in pushes):**
- `lib/notifications/match.ts` — pure 9-step filter, decides who
  receives every push. Step 1 is the leagueId check.
- `lib/notifications/server-fanout.ts` — was broken on Vercel (using
  VERCEL_URL not req.url); fixed tonight.
- `lib/notifications/send.ts` + `app/api/send-notification/route.ts` —
  fanout impl + endpoint, dead-token prune, push log

**Sport variants (DVSL = softball, SFBL = baseball):**
- `lib/stats/index.ts` — `recalcLeague` dispatches by sport
- `lib/stats/softball.ts` + `lib/stats/baseball.ts`
- `lib/stats/shared.ts` — standings (PCT, GB, streaks, run diff)
- `lib/stats/recap.ts` — auto-generated game recap (LB pattern port)
- `lib/stats/ip.ts` — IP-as-outs storage (avoids the 6.2 trap)

**Data feeds (what feeds the public pages):**
- `lib/site-data.ts` — homepage ticker
- `lib/box-score-data.ts` — `/games/[id]` page (where every push
  deep-links)
- `lib/markdown.ts` — admin-edited content sanitization (DOMPurify)

**Provisioning:**
- `scripts/provision.ts` — CSV import + idempotent provision
- `scripts/templates/*.csv` — example data
- `DEPLOY.md` — operational runbook
- `SHIPPING_CHECKLIST.md` — launch-day runbook

**Test suite (777 passing currently):**
- `tests/integration/` — endpoint tests (most are mocked)
- `tests/rules/` — Firestore rules tests against the emulator
- `tests/stats/` — pure stat math
- `tests/auth/` — emulator-required auth tests

---

## What feedback we want

Don't repeat the audit findings — they're in `PRELAUNCH_AUDIT.md`.

Things we'd genuinely benefit from your eyes on:

1. **DVSL pattern fidelity.** Where did the building Claude port a
   DVSL pattern incorrectly? Specifically: 9-step push filter
   (`lib/notifications/match.ts` vs DVSL's `api/send-notification.js`),
   chat trigger sites (`app/api/chat-message/route.ts` vs DVSL's
   `captain.html` `sendTeamMsg`), 3-lane scoring (`captain-submit/route.ts`
   vs DVSL `admin.html`), recap generation (`lib/stats/recap.ts` vs LB's
   `buildRealRecap`).

2. **DVSL bugs we should NOT repeat.** Anything you know is broken,
   janky, or has been patched on DVSL that probably also exists in this
   port. The `cleanName` Unicode whitespace thing is one example — has
   it been ported?

3. **Captain UX from someone who's seen real captain support tickets.**
   What's the most common "where the hell is X" question DVSL captains
   ask? Is the equivalent obvious in this codebase?

4. **The data-integrity audit pattern.** DVSL has a 13-dimension audit
   (game/box_score parity, schedule fields, time_24, etc.). Has any of
   that discipline made it into this codebase? Should it?

5. **Anything that scares you.** Trust your gut. If something looks off
   for reasons you can't immediately articulate, write it down. We can
   investigate.

---

## How to leave feedback

Easiest path:

```bash
# Read whatever you want, then write your findings to:
echo "your review" > /Users/AdamMiller/Desktop/league-platform/.claude/worktrees/awesome-brahmagupta-6b27b6/DVSL_REVIEW_NOTES.md
```

Adam reads it tomorrow morning. No need to be pretty — bullet points
with file:line references are perfect. Be specific, terse, and only
flag things you're confident about. False alarms cost more than missed
finds at this stage.

---

## What's NOT in scope

- Don't try to fix things directly — just flag them
- Don't read the full test suite (777 tests; spot-check what looks
  weak)
- Don't compare against Long Beach unless you have it open already
- Don't touch DVSL's own code (you live there; respect it)

Thanks. Adam will buy the building Claude a drink if you find something
real.
