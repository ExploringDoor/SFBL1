// The bracket tree — PORTED from js/sts-bracket-render.js in the STSBT site,
// which is the same renderer running on D27 and Texas Select. Absolute-
// positioned cards on a canvas with SVG elbow connectors, the way a printed
// bracket reads: winners bracket on top, losers bracket directly below, and
// the championship to the RIGHT of both so the gold lines from the winners
// final and the losers final visibly CONVERGE into it.
//
// Layout constants, column math (`colsFromEnd`), the recursive row centring
// with collision push-down (`layoutSection`), the region offsets and the path
// string are all kept identical to the original so the brackets look the same
// across every one of Adam's sites. Server-rendered: no client JS needed to
// draw it.

import { BracketHover } from "./BracketHover";
import {
  classify,
  championOutcome,
  feeders,
  isPlayed,
  parseRef,
  sideDisplay,
  gameByNum,
  type BracketRefGame,
  type BracketTournament,
} from "@/lib/sts-bracket";

const CARD_W = 210;
const CARD_H = 148;
const COL_GAP = 76;
const ROW_GAP = 24;
const Y_PAD = 24;
const REGION_GAP = 64;

type Cls = "w" | "l" | "f";

/** Columns by distance-to-final within a subset, so play-ins get their own
 *  early column instead of being pushed into round one. */
function colsFromEnd(games: BracketRefGame[]): Record<number, number> {
  const inSet: Record<number, boolean> = {};
  games.forEach((g) => (inSet[g.g] = true));
  const consumer: Record<number, number> = {};
  games.forEach((c) => {
    for (const raw of [c.away, c.home]) {
      const r = parseRef(raw);
      if (r.kind === "WG" && inSet[r.g]) consumer[r.g] = c.g;
    }
  });
  const rank: Record<number, number> = {};
  const guard: Record<number, boolean> = {};
  function rk(n: number): number {
    if (rank[n] != null) return rank[n]!;
    if (guard[n]) return 0;
    guard[n] = true;
    const c = consumer[n];
    rank[n] = c != null && inSet[c] ? 1 + rk(c) : 0;
    return rank[n]!;
  }
  games.forEach((g) => rk(g.g));
  const maxRank = Math.max(0, ...games.map((g) => rank[g.g] || 0));
  const col: Record<number, number> = {};
  games.forEach((g) => (col[g.g] = maxRank - (rank[g.g] || 0) + 1));
  return col;
}

interface Pos {
  x: number;
  y: number;
  h: number;
  col: number;
}

function layoutSection(
  t: BracketTournament,
  games: BracketRefGame[],
): Record<number, Pos> {
  const inSet: Record<number, boolean> = {};
  games.forEach((g) => (inSet[g.g] = true));
  const depth = colsFromEnd(games);
  const SLOT = CARD_H + ROW_GAP;

  function kidsOf(n: number): number[] {
    const g = gameByNum(t, n);
    if (!g) return [];
    const ks: number[] = [];
    for (const raw of [g.away, g.home]) {
      const r = parseRef(raw);
      if ((r.kind === "WG" || r.kind === "LG") && inSet[r.g]) ks.push(r.g);
    }
    return ks;
  }

  const consumed: Record<number, boolean> = {};
  games.forEach((g) => kidsOf(g.g).forEach((k) => (consumed[k] = true)));
  const roots = games
    .map((g) => g.g)
    .filter((n) => !consumed[n])
    .sort((a, b) => a - b);

  const cen: Record<number, number> = {};
  const guard: Record<number, boolean> = {};
  let leaf = 0;
  function place(n: number): number {
    if (cen[n] != null) return cen[n]!;
    if (guard[n]) return (cen[n] = Y_PAD + leaf++ * SLOT + CARD_H / 2);
    guard[n] = true;
    const ks = kidsOf(n);
    const c = ks.length
      ? (() => {
          const cs = ks.map(place);
          return (Math.min(...cs) + Math.max(...cs)) / 2;
        })()
      : Y_PAD + leaf++ * SLOT + CARD_H / 2;
    return (cen[n] = c);
  }
  roots.forEach(place);
  games.forEach((g) => {
    if (cen[g.g] == null) place(g.g);
  });

  const pos: Record<number, Pos> = {};
  games.forEach((g) => {
    pos[g.g] = {
      x: ((depth[g.g] || 1) - 1) * (CARD_W + COL_GAP),
      y: cen[g.g]! - CARD_H / 2,
      h: CARD_H,
      col: depth[g.g] || 1,
    };
  });

  // Push overlapping cards apart within a column — the recursive centring can
  // put two parents at the same height when their subtrees are lopsided.
  const byCol: Record<number, number[]> = {};
  games.forEach((g) => {
    const r = depth[g.g] || 1;
    (byCol[r] ||= []).push(g.g);
  });
  for (const r of Object.keys(byCol)) {
    const list = byCol[Number(r)]!.sort((a, b) => pos[a]!.y - pos[b]!.y);
    for (let i = 1; i < list.length; i++) {
      const minY = pos[list[i - 1]!]!.y + pos[list[i - 1]!]!.h + ROW_GAP;
      if (pos[list[i]!]!.y < minY) pos[list[i]!]!.y = minY;
    }
  }
  return pos;
}

const lineColor = (k: Cls) =>
  k === "f" ? "#C9A227" : k === "l" ? "rgba(191,10,48,.55)" : "rgba(0,45,114,.5)";

// Normalized team-name key for logo lookup: drop a leading seed ("#D2 "),
// lowercase, strip punctuation, collapse spaces. MUST match the keying in
// tools that build bracket-logos.json.
function logoKey(name: string): string {
  return name
    .replace(/^#\S+\s+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function badgeInitials(name: string): string {
  return logoKey(name)
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function BracketTree({
  games,
  tournamentName,
  championPhoto,
  trophyUrl,
  teamLogos,
}: {
  games: BracketRefGame[];
  tournamentName?: string;
  championPhoto?: { url: string; caption?: string | null } | null;
  /** Branded trophy image for the champion banner (LCYBL). Falls back to the
   *  inline SVG trophy when a tenant ships no trophy asset. */
  trophyUrl?: string;
  /** normalized-team-name -> logo src. Every concrete side gets a mark: the
   *  logo when the name resolves, a uniform initials badge otherwise (the D27
   *  pattern), so it never looks like only some teams have art. */
  teamLogos?: Record<string, string>;
}) {
  if (!games || games.length === 0) {
    return <div className="bk-empty">No bracket games recorded.</div>;
  }
  const t: BracketTournament = { games };
  const cls = classify(t);
  const outcome = championOutcome(t, cls);
  const visible = games.filter((g) => !outcome.hide.has(g.g));

  // ── combinedCanvas ────────────────────────────────────────────────
  const W = visible.filter((g) => cls[g.g] === "w");
  const L = visible.filter((g) => cls[g.g] === "l");
  const F = visible.filter((g) => cls[g.g] === "f").sort((a, b) => a.g - b.g);

  const pos: Record<number, Pos> = {};
  const posW = layoutSection(t, W);
  let winnersH = 0;
  let winnersMaxCol = 0;
  for (const k of Object.keys(posW)) {
    const n = Number(k);
    pos[n] = posW[n]!;
    winnersH = Math.max(winnersH, posW[n]!.y + posW[n]!.h);
    winnersMaxCol = Math.max(winnersMaxCol, posW[n]!.col);
  }

  const losersOffsetY = winnersH + REGION_GAP;
  let losersMaxCol = 0;
  if (L.length) {
    const posL = layoutSection(t, L);
    const wcol: Record<number, number> = {};
    W.forEach((g) => (wcol[g.g] = posW[g.g]!.col));
    const Lset: Record<number, boolean> = {};
    L.forEach((g) => (Lset[g.g] = true));
    let offCol = 0;
    L.forEach((g) => {
      let wMax = 0;
      let hasL = false;
      for (const raw of [g.away, g.home]) {
        const r = parseRef(raw);
        if (r.kind === "WG" || r.kind === "LG") {
          if (Lset[r.g]) hasL = true;
          else if (r.kind === "LG" && wcol[r.g] != null) wMax = Math.max(wMax, wcol[r.g]!);
        }
      }
      if (wMax && !hasL) offCol = Math.max(offCol, wMax - posL[g.g]!.col);
    });
    const dx = Math.max(0, offCol) * (CARD_W + COL_GAP);
    for (const k of Object.keys(posL)) {
      const n = Number(k);
      pos[n] = {
        x: posL[n]!.x + dx,
        y: posL[n]!.y + losersOffsetY,
        h: posL[n]!.h,
        col: posL[n]!.col + offCol,
      };
      losersMaxCol = Math.max(losersMaxCol, pos[n]!.col);
    }
  }

  let fcol = Math.max(winnersMaxCol, losersMaxCol) + 1;
  F.forEach((g) => {
    const fc = feeders(g)
      .map((n) => pos[n])
      .filter(Boolean)
      .map((p) => p!.y + p!.h / 2);
    const cy = fc.length
      ? (Math.min(...fc) + Math.max(...fc)) / 2
      : losersOffsetY / 2 + Y_PAD;
    pos[g.g] = { x: (fcol - 1) * (CARD_W + COL_GAP), y: cy - CARD_H / 2, h: CARD_H, col: fcol };
    fcol++;
  });

  let maxX = 0;
  let maxY = 0;
  for (const k of Object.keys(pos)) {
    const n = Number(k);
    maxX = Math.max(maxX, pos[n]!.x + CARD_W);
    maxY = Math.max(maxY, pos[n]!.y + pos[n]!.h);
  }
  const canvasH = maxY + Y_PAD;

  // Only winner-advance lines are drawn. Loser-drop lines cross both brackets
  // and read as spaghetti; the loser is shown by the team simply appearing.
  const paths: React.ReactNode[] = [];
  visible.forEach((g) => {
    const p = pos[g.g];
    if (!p) return;
    for (const raw of [g.away, g.home]) {
      const r = parseRef(raw);
      if (r.kind !== "WG") continue;
      const fp = pos[r.g];
      if (!fp) continue;
      const x1 = fp.x + CARD_W;
      const y1 = fp.y + fp.h / 2;
      const x2 = p.x;
      const y2 = p.y + p.h / 2;
      const mx = x1 + (x2 - x1) / 2;
      paths.push(
        <path
          key={`${r.g}-${g.g}`}
          d={`M${x1},${y1} H${mx} V${y2} H${x2}`}
          fill="none"
          stroke={lineColor(cls[g.g]!)}
          strokeWidth={cls[g.g] === "f" ? 2.5 : 2}
        />,
      );
    }
  });

  return (
    <>
      {outcome.champion && (
        <div className="bk-champion">
          <span className="trophy" aria-hidden="true">
            {trophyUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={trophyUrl} alt="" className="bk-trophy-img" />
            ) : (
              <TrophySvg />
            )}
          </span>
          <div className="ct">
            {tournamentName && <div className="tourn">{tournamentName}</div>}
            <div className="lbl">★ Champion ★</div>
            <div className="team">{outcome.champion.replace(/^#\S+\s+/, "")}</div>
          </div>
        </div>
      )}

      {championPhoto && (
        <figure className="bk-champ-photo">
          <img src={championPhoto.url} alt={championPhoto.caption ?? "Champions"} />
          {championPhoto.caption && <figcaption>{championPhoto.caption}</figcaption>}
        </figure>
      )}

      <BracketHover>
      <div className="bk-scroll">
        {/* The zoom control scales this wrapper, not the canvas itself, so the
            canvas keeps its true offsetWidth for the Fit calculation. */}
        <div className="bk-zoomable">
        <div className="bk-canvas" style={{ width: maxX, height: canvasH }}>
          <svg width={maxX} height={canvasH}>
            {paths}
          </svg>
          {L.length > 0 && (
            <>
              <div className="bk-region w" style={{ left: 0, top: 2 }}>
                Winners Bracket
              </div>
              <div className="bk-region l" style={{ left: 0, top: losersOffsetY - 20 }}>
                Losers Bracket
              </div>
              {F.length > 0 && pos[F[0]!.g] && (
                <div
                  className="bk-region f"
                  style={{ left: pos[F[0]!.g]!.x, top: pos[F[0]!.g]!.y - 22 }}
                >
                  Championship
                </div>
              )}
            </>
          )}
          {visible.map((g) => {
            const p = pos[g.g];
            if (!p) return null;
            return (
              <MatchCard
                key={g.g}
                t={t}
                g={g}
                cls={cls[g.g]!}
                x={p.x}
                y={p.y}
                teamLogos={teamLogos}
              />
            );
          })}
        </div>
        </div>
      </div>
      </BracketHover>
    </>
  );
}

function MatchCard({
  t,
  g,
  cls,
  x,
  y,
  teamLogos,
}: {
  t: BracketTournament;
  g: BracketRefGame;
  cls: Cls;
  x: number;
  y: number;
  teamLogos?: Record<string, string>;
}) {
  const A = sideDisplay(t, g.away);
  const H = sideDisplay(t, g.home);
  const played = isPlayed(g);
  const aWin = played && g.away_score! > g.home_score!;
  const hWin = played && g.home_score! > g.away_score!;
  const series = (g as BracketRefGame & { seriesGames?: unknown[] }).seriesGames as
    | { a: number | null; b: number | null }[]
    | undefined;
  const tag =
    cls === "f" ? (
      <span className="tag f">Final</span>
    ) : cls === "l" ? (
      <span className="tag l">Losers</span>
    ) : (
      <span className="tag w">Winners</span>
    );

  const side = (s: typeof A, sc: number | null | undefined, win: boolean) => (
    <div
      className={`bk-side${win ? " win" : ""}${s.tbd ? " tbd" : ""}${s.bye ? " bye" : ""}`}
      // Hover highlighting keys off this. Only concrete teams get it — a TBD or
      // BYE slot is not a team to trace through the bracket.
      {...(!s.tbd && !s.bye ? { "data-team": s.name } : {})}
    >
      <span className="nm">
        {!s.tbd && !s.bye && (() => {
          const src = teamLogos?.[logoKey(s.name)];
          return src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="bk-logo" src={src} alt="" aria-hidden="true" />
          ) : (
            <span className="bk-logo bk-logo-fallback" aria-hidden="true">
              {badgeInitials(s.name)}
            </span>
          );
        })()}
        <span className="bk-nm-txt">{s.name}</span>
        {s.via && <span className="via">via {s.via}</span>}
      </span>
      <span className="sc">{sc ?? ""}</span>
    </div>
  );

  const round = (g as BracketRefGame & { round?: string }).round ?? "";

  return (
    <div className={`bk-match acc-${cls}`} style={{ left: x, top: y }}>
      <div className="bk-mtop">
        <span className="g">Game {g.g}</span>
        {tag}
      </div>
      {side(A, g.away_score, aWin)}
      {side(H, g.home_score, hWin)}
      <div className="bk-mfoot">
        <div className="bk-wrow">
          <div className="bk-when">
            {series ? `Series ${g.away_score}–${g.home_score}` : played ? "Final" : "TBD"}
          </div>
        </div>
        <span className="bk-field">{round}</span>
      </div>
    </div>
  );
}

/** Inline SVG trophy — the JS renderer uses assets/trophy.png with an emoji
 *  fallback; league-platform has no per-tenant trophy asset, and an emoji
 *  renders differently on every platform. */
function TrophySvg() {
  return (
    <svg viewBox="0 0 24 24" width="54" height="54" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4.5a2.5 2.5 0 0 0 2.5 2.5" />
      <path d="M17 6h2.5A2.5 2.5 0 0 1 17 8.5" />
      <path d="M12 14v3" />
      <path d="M9 20h6" />
      <path d="M10 17h4l.5 3h-5l.5-3Z" />
    </svg>
  );
}
