# DVSL Scorer — Box-Score / Play-By-Play Divergence Bug

**Discovered:** 2026-05-04 during live game (OA vs BA, mid-game)
**Severity:** Medium — data is technically correct but timeline is incomplete; confuses spectators
**Where:** `scorer.html` allows two parallel data-entry paths that don't sync to each other

---

## Symptom

A spectator watching the live box-score modal on `index.html` sees a play-by-play timeline that contradicts the batting box score:

- **Box score** says batter X has 2 AB, 2 H
- **Play-by-play** shows only 1 at-bat for X (the second one)
- The first at-bat is missing entirely from the PBP timeline
- The next batter's PBP entry "skips" X's slot, making them look out-of-order in the lineup

Spectator interpretation: "Why is Edward O'Brien batting third when he's fourth in the lineup?"

Reality: O'Brien IS fourth. Tomasco (third) batted, but his at-bat was never logged to the PBP — only his box-score totals were updated.

---

## Root cause

`scorer.html` exposes two parallel entry paths for stats:

1. **Per-at-bat live entry** — scorer taps through pitches/outcomes; scorer.html auto-generates a PBP event row as the at-bat completes
2. **Box-score grid editing** — scorer types AB/H/RBI/etc directly into the cell; scorer.html updates the box-score totals but does NOT generate a PBP event

When a scorer uses path 2 (deliberately or accidentally), box-score totals jump but no row appears in the PBP. The two views silently desync.

Additional contributing factor: the "quick log" mode for opposing-team runs (visible as `+1 run (quick log)` entries) sets the precedent that PBP events can be coarse-grained, normalizing the divergence.

---

## Verbatim from the field

User (Adam Miller, commissioner) reading the live PBP:

> "I'm confused with the live scoring going on right now... it shows this... but why is ed obrien up 3rd?"

Box score for OA at the moment: Goldberg(1), Rosen(1), Tomasco(2), O'Brien(2), Shaw(2), Roomberg(2), Lipner(2), Benn(1), Taylor(1), Rothberg(1) — total 17 AB.

PBP for the same period: 5 events in 1st inning, 4 in 2nd, 6 in 3rd, 3 in 4th = 18 OA events but several show the same player batting twice in one inning (which would require the team to bat around with 9+ batters). Mathematically impossible without missing entries.

**Conclusion:** several at-bats were entered via path 2 (box-score grid) and never made it into the PBP timeline.

---

## Fix recommendations for LeagueEngine scorer port

When porting the scorer to LE, add these two safeguards. Estimated 4-6 hours combined.

### 1. Box-score grid edits auto-create stub PBP events

Whenever a scorer manually edits a box-score cell (AB, H, BB, etc.), scorer.html should auto-create a PBP row representing the change. The PBP entry can be coarse-grained — it doesn't need to know what actually happened — but the timeline gap closes.

```ts
// Pseudocode for a stub PBP entry on grid edit
function onBoxScoreGridChange(playerId, field, oldValue, newValue) {
  const delta = newValue - oldValue;
  if (delta === 0) return;
  const stubEvent = {
    inning: G.currentInning,
    half: G.currentHalf,
    side: G.scoringTeam,
    batter_id: playerId,
    batter_name: lookupPlayer(playerId).name,
    type: deriveStubType(field, delta),  // 'H' if H went up, 'AB' if just AB went up, etc.
    description: `Manual ${field} entry (no live detail)`,
    is_manual_stub: true,
    timestamp: serverTimestamp(),
  };
  addPbpEvent(stubEvent);
}
```

The `is_manual_stub: true` flag lets the public PBP renderer style these differently (slightly faded, or "(stats updated)" suffix) to distinguish from per-at-bat live events.

### 2. Pre-submit reconciliation check

Before "Mark Final" actually commits the game, scorer.html runs a sanity pass:

For each batter, count their PBP events vs their box-score AB. If the counts don't match:

```ts
function reconcileBoxAndPbp(side: 'away' | 'home') {
  const lineup = G.lineups[side];
  const pbpEvents = G.pbp.filter(e => e.side === side);
  const issues = [];
  lineup.forEach(player => {
    const boxAb = player.ab || 0;
    const pbpAb = pbpEvents.filter(e => e.batter_id === player.id && isAtBatEvent(e)).length;
    if (boxAb !== pbpAb) {
      issues.push({ player, boxAb, pbpAb, delta: boxAb - pbpAb });
    }
  });
  return issues;
}
```

If `issues.length > 0`, show a modal:

> **Box / Play-by-Play mismatch — confirm before submitting**
>
> The following batters have stats in the box score but not enough events in the play-by-play timeline:
>
> - Matthew Tomasco — 2 AB in box, 1 PBP event (1 missing)
> - Adam Taylor — 1 AB in box, 0 PBP events (1 missing)
>
> [ Add missing events ] [ Submit anyway (mark as stubs) ] [ Cancel ]

"Add missing events" reopens the live entry flow at the missing batter's slot.
"Submit anyway" auto-creates `is_manual_stub: true` placeholder events to close the gap.
"Cancel" returns to live scoring.

### 3. Optional: real-time gap indicator

In the scorer's own UI (not the public view), show an "out of sync" badge when the box and PBP diverge during live scoring. Helps the scorer notice they're missing logs without needing to wait until submit.

---

## What NOT to fix

- **Don't remove the box-score grid editing path.** Some scorers prefer it for speed during fast innings. The fix is to keep both paths but force them to stay in sync via auto-stub generation.
- **Don't force per-pitch entry.** Live softball is fast; some scorers can only keep up with at-bat-level granularity.
- **Don't enforce "no submit if any mismatch."** Some games genuinely have undocumented at-bats (the official stat-keeper recorded them on paper, scorer.html is a partial transcription). Allow stub-and-submit.

---

## Test cases for the fix

When implementing, verify:

1. Scorer enters a complete live at-bat → 1 PBP event created → box totals update → reconciliation shows 0 issues
2. Scorer types `H=1` directly into the grid for a batter → stub PBP event auto-created → reconciliation shows 0 issues
3. Scorer types `H=2, AB=2` into grid for a batter who had 1 H, 1 AB → only the delta gets a stub event (1 new H, 1 new AB → 1 stub event, not 2)
4. Scorer hits "Mark Final" with 1 batter at 2 AB box / 1 PBP event → modal shows the mismatch → "Submit anyway" auto-fills the gap with a stub
5. Public box-score modal renders stub events with `(stats updated)` suffix or visual distinction
6. The reconciliation check is per-side (away vs home) — a scorer scoring only one team shouldn't get warned about gaps on the other team's PBP

---

## Cross-reference

- Related: `dvsl-attendance-chat-spec.md` — the broader scorer port spec hasn't been written yet (deferred per Adam's Phase G+ schedule). When that spec is written, embed this bug + fix recommendations into it.
- This file should be deleted (or moved into the main scorer spec) when the scorer feature is built. Until then, it's the single source of truth for this specific issue.
