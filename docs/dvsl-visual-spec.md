# DVSL Visual Spec

Source of truth: `~/Desktop/softball-site/index.html` + `~/Desktop/softball-site/captain.html`.

This doc is the contract for the LeagueEngine UI. Every component in
`components/ui/` must look pixel-equivalent to the corresponding DVSL
element when given the same data. We are not "extracting patterns" —
we are porting the actual CSS verbatim, then making it tenant-aware.

---

## 1. Color tokens

DVSL's `:root` (light theme — light mode is the default; we ship light
first):

| Token            | Hex / value                  | Usage                                        |
|------------------|------------------------------|----------------------------------------------|
| `--bg`           | `#ffffff`                    | Page background                              |
| `--bg2`          | `#f5f5f5`                    | Secondary surface (footer)                   |
| `--card`         | `#ffffff`                    | Card surface                                 |
| `--card2`        | `#f8f8f8`                    | Subtle card variant (modal stats, inputs)    |
| `--card3`        | `#f0f0f0`                    | Tooltip background                           |
| `--border`       | `rgba(0,0,0,0.10)`           | Default border                               |
| `--border2`      | `rgba(0,0,0,0.15)`           | Stronger border                              |
| `--gold`         | `#002D72`                    | Primary accent (DVSL named it "gold"; it's actually NAVY). All accent state — hover, active tab underline, eyebrow text, leader rows. |
| `--gold-glow`    | `rgba(0,45,114,0.10)`        | Hover background tint                        |
| `--gold-dim`     | `rgba(0,45,114,0.08)`        | Even softer hover/selected tint              |
| `--white`        | `#1a1a1a`                    | Primary text (DVSL named it "white" but it's near-black) |
| `--muted`        | `rgba(0,0,0,0.50)`           | Secondary text                               |
| `--muted2`       | `rgba(0,0,0,0.35)`           | Tertiary text / labels                       |
| `--blue`         | `#002D72`                    | Same as gold — DVSL collapsed both           |
| `--green`        | `#22c55e`                    | Success / W badge                            |
| `--red`          | `#c8102e`                    | Loss / L badge                               |

Score-ticker has its own palette (it sits on the navy bar):

| Token            | Value                        | Usage                             |
|------------------|------------------------------|-----------------------------------|
| Ticker bg        | `#002D72`                    | Solid navy band, full width       |
| Ticker label bg  | `rgba(0,0,0,.15)`            | Left "DVSL 2026" + right "Full Schedule" cells |
| Ticker text      | `#ffffff`                    | Team abbrev + score (winner)      |
| Ticker text dim  | `rgba(255,255,255,.45)`      | Loser score / "FINAL" label       |
| Ticker text mid  | `rgba(255,255,255,.55–.8)`   | Records, datetime row             |
| Ticker divider   | `rgba(255,255,255,.15)`      | Border between st-game cells      |

Tenant-awareness: every place DVSL hard-codes `#002D72` we map to
`var(--brand-primary, #002D72)`. SFBL keeps `#002D72`. Future tenants
override via `<html style="--brand-primary: #...">` set by the
middleware or root layout.

---

## 2. Typography

Three Google fonts, each with a specific job. **Don't mix them up.**

| Family             | Where it's used                                                     |
|--------------------|---------------------------------------------------------------------|
| **Inter**          | Body copy, table cells, metadata, form inputs. The default `body { font-family }`. |
| **Barlow Condensed** | Section titles, hero title, eyebrows, buttons, table headers, scores, ticker datetime, logos, CTAs. The "scoreboard" font. |
| **Oswald**         | Team names in tables, tab buttons, modal player name, ticker team abbrev, week-nav dates, RHE values, score numbers in popups. Used wherever a "team identity" feel is needed. |

Loaded from:
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=Barlow+Condensed:wght@600..900&family=Oswald:wght@500..700&display=swap" rel="stylesheet">
```

### Type scale (verbatim from DVSL)

**Section headings**
- `.sec-eyebrow`: 11px, weight 700, letter-spacing .16em, uppercase, `var(--gold)`
- `.sec-title`: Barlow Condensed, weight 900, `clamp(34px, 5vw, 54px)`, line-height .95, letter-spacing -.01em, uppercase
- `.team-name-big` (team page hero): Barlow Condensed, weight 900, `clamp(54px, 9vw, 100px)`, line-height .88
- `.hero-title` (homepage): Barlow Condensed, weight 900, `clamp(80px, 14vw, 172px)`, line-height .82, letter-spacing -.03em

**Tables (standings)**
- `th`: Barlow Condensed, 13px, weight 700, letter-spacing .04em, uppercase, color `#6b7280`, background `rgba(0,0,0,.02)`
- `td`: Inter, 16px, default weight, color inherits
- `.tname` (team name cell): Oswald, weight 700, 20px, letter-spacing .01em
- `.tname` on `.leader` row OR on hover: `var(--gold)`

**Stats tables (`.stats-table`)**
- `thead th`: Barlow Condensed, **weight 900**, **22px**, letter-spacing .06em, uppercase, color `#1a1a1a`, background `#f8f8f8` (note: DVSL bumped headers very large 4/30/26)
- `td`: 15px, color `#1a1a1a`, normal weight
- Sorted/pinned column: th gets `color:var(--gold)` + `background:rgba(230,172,0,.10)`; td gets weight 800 + background `rgba(230,172,0,.05)`

**Score ticker**
- `.st-label`: Oswald, weight 600, 11px, letter-spacing .15em, uppercase
- `.st-datetime` (status row above team rows): Inter, 9px, weight 600, letter-spacing .08em, uppercase
- `.st-abbr`: Oswald, weight 600, 13px, min-width 36px
- `.st-rec`: Inter, 9px, weight 500, color `rgba(255,255,255,.55)`, min-width 28px
- `.st-score`: Oswald, weight 700, 14px, min-width 18px, text-align right
- `.st-full`: Inter, 10px, weight 600, letter-spacing .05em

**Game card (`.gc-card`) — final games**
- `.gc-card-status`: Barlow Condensed, weight 700, 11px, letter-spacing .10em, uppercase
- `.gc-card-date`: 11px, color muted
- `.gc-card-headline`: Barlow Condensed, weight 800, 12px, letter-spacing .06em, color `#002D72`, uppercase
- `.gc-team-name`: Inter, weight 700, 15px, color `#1a1a1a`
- `.gc-team-name.gc-loser`: color `rgba(0,0,0,.38)`, weight 500
- `.gc-record`: 11px, color `rgba(0,0,0,.4)`
- `.gc-score`: Barlow Condensed, weight 900, 32px, line-height 1, min-width 44px
- `.gc-score-win`: `#1a1a1a`; `.gc-score-lose`: `rgba(0,0,0,.28)`
- `.gc-btn`: Inter, 12px, weight 600, padding 6px 14px, border 1px solid var(--border)
- `.gc-btn-primary`: bg `#002D72`, color white, border `#002D72`

**Preview card (upcoming, `.preview-card`)**
- `.preview-time`: Barlow Condensed, weight 700, 13px, letter-spacing .05em, uppercase, color `rgba(0,0,0,.45)`, bottom-bordered
- `.preview-name`: Inter, weight 700, 15px, color `#1a1a1a`
- `.preview-rec`: 11px, color `rgba(0,0,0,.4)`
- `.preview-link`: 12px, weight 600, color `#002D72`

**Player modal**
- `.modal-pname`: Oswald, weight 700, **52px**, line-height .92, letter-spacing -.01em, uppercase
- `.modal-av`: 170×170 circle, 3px solid border (team color), Oswald 46px (initials fallback)
- `.msp-val` (stat-pill numbers): Barlow Condensed, weight 800, 22px, color `var(--gold)`
- `.msp-lbl`: 9px, weight 700, letter-spacing .10em, uppercase
- `.bat-tbl thead th`: Barlow Condensed, weight 800, 10px, letter-spacing .12em, uppercase, color `var(--muted)`, padding 10px 12px, text-align right (first child left)
- `.bat-tbl tbody td`: 13px, padding 10px 12px, text-align right (first left)
- `.bat-tbl tr.career-row`: bg `rgba(0,45,114,.04)`, font-style italic, top-bordered

**Tab buttons (Scores | Schedule)**
- `.tab-btn`: Oswald, weight 700, **28px**, uppercase, color `var(--muted)`, padding 16px 0, margin-right 28px, border-bottom 3px solid transparent
- `.tab-btn.active`: color `var(--white)` (= `#1a1a1a`), border-bottom-color `var(--white)`

**Week-nav slot (`.dn-slot`)**
- container: padding 10px 18px, border-bottom 3px transparent, min-width 72px, gap 1px
- `.dn-slot.active`: border-bottom-color `var(--gold)`
- `.wk-label`: 10px, weight 700, letter-spacing .12em, uppercase, color `var(--muted2)` (active: gold)
- `.wk-date`: Oswald, weight 600, 20px (active: gold)
- `.dn-arrow`: 24px, color muted (hover: white)

**Buttons**
- `.btn-gold` (primary): Barlow Condensed, weight 700, 12px, letter-spacing .10em, uppercase, bg `linear-gradient(135deg, #3b82f6, #1d4ed8)`, color white, padding 13px 30px, radius 6px, shadow `0 4px 20px rgba(59,130,246,.35)`. (DVSL ended up with a blue-gradient even though the class name says "gold".)
- `.btn-outline`: same metrics, transparent bg, color `var(--white)`, border `1px solid var(--border2)`

---

## 3. Spacing scale

DVSL doesn't use a token system — it hard-codes paddings. Common values:

| Context                      | Padding / gap                           |
|------------------------------|-----------------------------------------|
| `.sec`                       | `80px 48px`                             |
| `.sec-sm`                    | `56px 48px`                             |
| `.container`                 | `max-width: 1180px; margin: 0 auto`     |
| `.divider`                   | `margin: 0 48px`                        |
| Page wrap (under nav)        | `padding-top: 62px` (nav) + `48px` (ticker) on iPhone PWA |
| Card body (`.gc-card-body`)  | `12px 14px 10px`                        |
| Card header (`.gc-card-hdr`) | `8px 14px`                              |
| Card footer                  | `10px 14px 12px`                        |
| Modal hero (`.modal-hero`)   | `gap: 22px; margin-bottom: 20px`        |
| Modal inner                  | `padding: 28px 32px 36px`               |
| Tab bar                      | `padding: 0 48px`                       |
| Date nav slot                | `padding: 10px 18px`                    |

Border radius:
- Buttons / pills: 6–8px (`.btn-*`: 6px; `.gb-btn`: 20px [pill]; `.lp-card`: 10px)
- Cards: 12–14px (`.gc-card`: 12px; `.div-card`: 14px; `.ldr-card`: 14px; `.pcard`: 14px)
- Modals: 16–18px (`.modal-box`: 18px; `.pop-box`: 16px; `.bsm-inner`: 16px)
- Logo containers: 0px (`.score-logo`, `.preview-logo`, `.teams-list-logo` — bare PNG, no chip)
- Avatar (player): 50%

Shadows:
- Card hover: `0 4px 20px rgba(0,0,0,.10)` (gc-card), `0 16px 48px rgba(0,0,0,.10)` (ldr-card)
- Modal: `0 32px 80px rgba(0,0,0,.20)`
- Popup: `0 20px 60px rgba(0,0,0,.15)`
- Button (primary): `0 4px 20px rgba(59,130,246,.35)`

---

## 4. Component inventory

This is the build order. Each component is one file in `components/ui/`,
ported verbatim from DVSL's HTML/CSS, then made tenant-aware (any
hard-coded `#002D72` becomes `var(--brand-primary)`; any "DVSL" string
becomes the tenant short name).

### 4.1 Ticker (`Ticker.tsx`) — START HERE

DVSL HTML structure (lines 2902–2908):
```html
<div id="score-ticker">
  <div class="st-label" onclick="goPage('home')" style="cursor:pointer">
    ⬡ DVSL <span style="color:rgba(255,255,255,.5);font-weight:400">2026</span>
  </div>
  <div class="st-scroll" id="st-scroll">
    <div class="st-track" id="st-track"></div>
  </div>
  <div class="st-full" onclick="...">Full Schedule »</div>
</div>
```

Each game cell (lines 7295–7309):
```html
<div class="st-game" onclick="...">
  <div class="st-game-inner">
    <div class="st-datetime">FINAL</div>     <!-- or "Sat 5/3 · 1:00 PM" -->
    <div class="st-row">
      <span class="st-abbr winner|loser">SHA</span>
      <span class="st-rec">(8-2)</span>
      <span class="st-score winner|loser">12</span>   <!-- only if done -->
    </div>
    <div class="st-row">
      <span class="st-abbr ...">VAL</span>
      <span class="st-rec">(5-5)</span>
      <span class="st-score ...">7</span>
    </div>
  </div>
</div>
```

Layout: fixed at top, full width, height 48px desktop / 64px mobile.
Background `#002D72`. The track inside `.st-scroll` is **NOT
animated** — Adam confirmed it should be static; the user scrolls
horizontally if there are more games than fit. Each `.st-game` is
flex-shrink:0 with `border-right: 1px solid rgba(255,255,255,.15)`
and `padding: 0 16px`. Hover background `rgba(255,255,255,.10)`.

The label cell shows the tenant short name (e.g. "DVSL 2026" or
"SFBL 2026") and is clickable home. The right cell ("Full Schedule »")
links to `/scores`.

DVSL also hides the ticker on scroll (translateY -100% after 10px) but
that's a polish that can come after the static visual matches.

### 4.2 SiteHeader (`Nav.tsx`)

DVSL: fixed top, height 62px, sits **below** ticker (so its `top` is
`calc(48px + safe-area-inset-top)`).

Structure:
```html
<nav>
  <a class="nav-logo">[Tenant]</a>
  <ul class="nav-links">
    <li><a class="active">HOME</a></li>
    <li><a>SCORES</a></li>
    <li><a>SCHEDULE</a></li>
    <li><a>STANDINGS</a></li>
    <li><a>STATS</a></li>
    <li><a>TEAMS</a></li>
    <li><a>HISTORY</a></li>
  </ul>
  <button class="hamburger">…</button>  <!-- mobile only -->
</nav>
```

Styles: bg `rgba(255,255,255,.97)` + `backdrop-filter: blur(24px) saturate(180%)`.
Border-bottom `1px solid var(--border)`. Padding `0 40px`.
- `.nav-logo`: Barlow Condensed 900, 19px, letter-spacing .10em, uppercase, color `var(--gold)`.
- `.nav-links a`: 11.5px, weight 700, letter-spacing .07em, uppercase, color muted, padding `7px 13px`, radius 6px. Hover: white, bg `rgba(0,0,0,.04)`. Active: color `var(--gold)`.

### 4.3 Standings table (`StandingsTable.tsx`)

DVSL `s-tbl` — already documented in Type Scale §2. Columns:
`Team | W | L | T | PCT | GB | RS | RA | RUN DIFF | STREAK`.

Wrapped in `.div-card` (one per division), each div-card has a
header strip `.div-card-head` with the division label in
`.div-card-label` (Barlow Condensed 11px letter-spacing .12em
uppercase color muted). Border-radius 14px, overflow hidden so the
table body's `tr:last-child` butts cleanly against the rounded corner.

`.s-tbl tr.leader` — top row in each division — gets `.tname` colored
in `var(--gold)`. Hover: any tr's `.tname` turns gold + background
`rgba(0,0,0,.03)`.

Click row → navigate to team page.

### 4.4 Game card / final score card (`GameCard.tsx`)

Already documented §2. Lives in a grid:
```css
.gc-cards-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(300px,1fr));
  gap:16px;
  max-width:1060px;
}
```

3-row vertical: header (FINAL · date · headline) → body (two team rows
with logo/name/record/score) → footer (Recap | Box Score buttons).

Click anywhere on card → opens box score modal. Recap button → opens
modal on Recap tab. Box Score button (primary, navy fill) → opens on
Box tab.

### 4.5 Preview card (`PreviewCard.tsx`) — upcoming games

Compact card, no actions:
```html
<div class="preview-card next?">
  <div class="preview-time">SAT 5/3 · 1:00 PM · MAIN FIELD</div>
  <div class="preview-teams">
    <div class="preview-team-row">
      <div class="preview-logo"><img></div>
      <div>
        <span class="preview-name">Sharks</span>
        <span class="preview-rec">(5-2)</span>
      </div>
    </div>
    <!-- home team row -->
  </div>
  <a class="preview-link">Preview</a>
</div>
```

`.next` modifier (next upcoming game) gets `border-left: 3px solid var(--gold)`.

### 4.6 Box score modal / popup (`BoxScoreModal.tsx`)

DVSL has TWO box-score modals (one in dark theme `.bsm-overlay`, one in
light `.pop`). The newer one is `.pop` — light, white card, 760px max-width.

Structure:
- `.pop-hd` (header): centered matchup, big team abbrevs
  (Barlow Condensed 900, 60px), score in middle (Barlow Condensed
  900, 72px). Below: meta row (date · field · time).
- `.pop-body`:
  - Recap section (`.pop-recap` 14px line-height 1.85) + stars
    (`.pop-stars` 9px label, then `.pop-star` rows 13px).
  - Linescore (1–9 + R H E across).
  - Two columns (`.pop-grid2`): away batting, home batting.
  - Pitching tables underneath.
  - Notes block at bottom (`.bs-notes-block`).

Both teams' batting tables use `.ptbl` (border-collapse, 13px). Header
weight 800, uppercase, letter-spacing .08em.

Tab toggle at top: "Box Score" / "Recap" — when on Recap, just renders
recap + stars without tables.

Box score modal hides ticker (`body.ticker-force-hide`) and bottom tab
bar (`body.dvsl-modal-open`).

### 4.7 Player modal (`PlayerModal.tsx`)

`.modal-bg` overlay, `.modal-box` 900px max-width, white card,
border-radius 18px.

Hero block: 170×170 circular avatar + name (Oswald 700 52px) +
position/team/number meta + stat pill row (AVG · HR · RBI · OPS in
small Barlow Condensed boxes).

Below: full season batting table → full pitching table (if pitcher) →
career table (per-season rows + total row at bottom with bold weight
+ background `rgba(0,45,114,.05)`).

### 4.8 Hero (`Hero.tsx`)

Fullbleed banner, height `calc(100vw / 4)` clamped 280–380px. Centered
content. Pill above title, big title with one word in italic accent
color, optional sub line, CTA buttons row, hero ticker pinned to
bottom (separate inline ticker, not the same as the top score ticker).

For LeagueEngine MVP we'll skip the hero ticker animation; just static
content.

### 4.9 Leaderboard cards (`LeaderCard.tsx`)

`.leaders-grid` — auto-fill minmax(240px,1fr), gap 14px.
Each card has:
- `.ldr-cat` label (e.g. "BATTING AVG"), 26px weight 800 letter-spacing .14em
- Big ghost number behind (Barlow Condensed 900 108px, color rgba(0,45,114,.05))
- `.ldr-val` (the leading value): Barlow Condensed 900, 84px, color gold
- `.ldr-name`: Barlow Condensed 900, 78px, uppercase
- `.ldr-team`: 42px Barlow Condensed weight 800, color #5a6473
- `.ldr-runners`: top-bordered, gap-14px column of runner-up rows

### 4.10 Captain portal (from `captain.html`)

Different palette — uses `--navy:#002D72` as primary (same), but its
own neutrals: `--bg:#f5f6f8`, `--card:#fff`, body bg light grey.

Login screen, then top-bar + tab nav + main-content panel layout.
Tabs: My Team · Roster · Schedule · Submit Score · Payments · Attendance · Team Chat · Captains Chat · Announcements.

This is Phase 6 — out of scope for the public-side visual port. Note
it here so we don't accidentally style admin pages with the public
palette.

---

## 5. Mobile breakpoints

DVSL targets:
- `max-width: 900px` — nav links collapse to hamburger; section padding
  drops `48px → 18px`; standings becomes single column; modal hero
  stacks vertically.
- `max-width: 700px` — nav goes transparent (just hamburger floating);
  ticker grows to 64px tall; preview cards 2-column; date-nav slot
  arrows bumped to 44×44 hit target.
- `max-width: 600px` — game block compacts further; pop-grid2 collapses
  to single column; pop-abbr scales to 44px.
- `max-width: 420px` — final-score numbers shrink (gb-score 18px), logo
  20×20.

PWA-aware: every fixed-top element factors `env(safe-area-inset-top)`.
The HTML root has `background: #002D72` so the iOS status-bar area
above the ticker reads as one solid navy band.

---

## 6. Tenant-awareness mapping

When porting:
- `#002D72` (primary navy) → `var(--brand-primary, #002D72)`
- `rgba(0,45,114, …)` (gold-tinted variants) → keep numeric for now;
  later expand to tinted CSS vars driven from tenant config.
- `#F5C842` (the actual gold accent in the dark `.bsm-overlay`) →
  `var(--brand-accent, #F5C842)`.
- "DVSL" string in the ticker label → tenant short name.
- "DVSL 2026" → `${tenant.short} ${tenant.season_year}`.

We do NOT swap the typography per tenant (Inter / Barlow Condensed /
Oswald is the LeagueEngine house style). If a tenant wants different
fonts that's a v2 conversation.

---

## 7. What NOT to port

- `body.dark` rules — light mode is the only mode for v1.
- `#dvsl-tabbar` (5-icon mobile bottom tab bar) — Next.js routes give
  us this for free via the bottom nav component we'll build later.
- Welcome popup, site banner, alert glow keyframes — admin-driven, v2.
- PDF.js / box-score print HTML at line 4286 — that's a captain
  portal feature, Phase 6.
- The animated ticker keyframe (`@keyframes ticker { translateX -50% }`)
  on `.ticker-track` (the homepage hero ticker, NOT the top score
  ticker). Both rendered statically for v1.

---

## 8. Captain box-score behaviours

### 8.a Per-team Score Only mode

Captains can opt out of full stats per-team via a "Full Box Score" /
"Score Only" toggle at the top of each team's tab in the stats step:

- **Full Box Score** (default) — captain enters batting + pitching
  tables for that team. Standard validation (`H ≤ AB`,
  `2B + 3B + HR ≤ H`).
- **Score Only** — tables hidden; a single "Final Score: [__]"
  input. Submission stores `{ score_only: true, final_score: N,
  lineup: [], pitchers: [] }`. Skip H/AB validation.

Display behaviour for a score-only team:

- **Linescore** renders `–` across every inning column AND in the
  H / E columns. The R column shows the captain's submitted final
  score.
- **Box score modal** shows "Score-only entry — no individual
  stats recorded" instead of an empty batting/pitching table.
- **Stats recalc** skips the team's players (no zero rows, no
  double-counting).
- **Recap** mentions the final score and a one-line note that
  "individual stats weren't recorded for {team}". No player
  highlights for that side; if both sides are score-only the
  recap is just the opener + "score-only result".

### 8.b 3-lane reconciliation interactions with Score Only

Each captain's submission is a private "lane" at
`/leagues/{leagueId}/box_score_submissions/{gameId}_{teamId}`. The
default rules (`firestore.rules:139–146`) gate reads + writes to
admin or the same captain. Score Only mode doesn't change the
lanes — it just changes the payload.

- **A submits full + B submits score-only** — admin reconciles A's
  detail; B's side stays score-only on the public box score.
- **Both submit score-only** — admin sees two final scores; if
  they disagree, admin resolves which is authoritative.
- **A submits score-only + B submits full for A's team** — full
  data wins by default during reconciliation; admin can override.

The captain box-score editor only ever writes the captain's own
team's lane. Promotion to `/box_scores/{gameId}` happens via
`/api/captain-submit`, which writes only `${side}_score_only`,
`${side}_score`, and (when not score-only) the side's lineup +
pitchers. Cross-side fields are left untouched on the public doc.

---

## 9. Build order (one component at a time, Adam reviews each)

1. **Ticker** — top score ticker (this doc §4.1).
2. **Nav** — fixed header below ticker.
3. **StandingsTable** — division card + s-tbl rules.
4. **GameCard** — final-game card, the centerpiece of the scores page.
5. **PreviewCard** — upcoming-game card.
6. **BoxScoreModal** — light `.pop` variant.
7. **PlayerModal** — hero + batting table + career.
8. **LeaderCard** — leaderboards.
9. **Hero** — homepage banner.

After each: render in a sandbox test page, screenshot side-by-side
with DVSL live, ship to Adam, wait for "match" before moving on.
