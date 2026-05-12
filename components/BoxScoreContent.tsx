// Full DVSL-style box score modal body. Renders the same content
// whether the caller is the full-page route at /games/[id] or the
// intercepted modal route at @modal/(.)games/[id].
//
// Layout matches DVSL `.pop` (~/Desktop/softball-site/index.html
// lines 1755+). Three regions stacked vertically:
//
//   1. HERO   — two team blocks + big centered score + FINAL badge
//               + meta row (📅 date · 📍 field).
//   2. TABS   — BOX SCORE | RECAP. Routed via ?tab=recap so the
//               server stays the source of truth (matches the page
//               at @modal/(.)games/[gameId] which passes `view`).
//   3. BODY   — Box: linescore + batting + pitching.
//               Recap: recap paragraphs + POTG callout.

import Link from "next/link";
import { formatIP } from "@/lib/stats/ip";
import { buildRecap } from "@/lib/stats/recap";
import { sanitizeHtml } from "@/lib/markdown";
import { BoxScoreTabs } from "@/components/ui/BoxScoreTabs";

export interface BoxBatter {
  player_id: string;
  ab?: number;
  r?: number;
  h?: number;
  doubles?: number;
  triples?: number;
  hr?: number;
  rbi?: number;
  bb?: number;
  so?: number;
  sb?: number;
}

export interface BoxPitcher {
  player_id: string;
  ip_outs?: number;
  h?: number;
  r?: number;
  er?: number;
  bb?: number;
  so?: number;
  hr?: number;
  decision?: "W" | "L" | "S";
}

export interface BoxTeam {
  team_id: string;
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  score: number;
  /** Season record like "3-0" or "3-0-1". UI adds parens. */
  record?: string;
  linescore?: number[];
  hits?: number;
  errors?: number;
  lineup: BoxBatter[];
  pitchers: BoxPitcher[];
  /** Captain submitted Score Only for this team — render '–' across
   *  the linescore and a "no individual stats" placeholder instead
   *  of empty batting/pitching tables. */
  score_only?: boolean;
}

export interface BoxScoreContentProps {
  gameId: string;
  date: string | null;
  field: string | null;
  status: string;
  innings: number;
  away: BoxTeam;
  home: BoxTeam;
  playerNames: Record<string, string>;
  /** Comes from the URL `?tab=recap`. Default = "box". */
  view?: "box" | "recap";
  /** Server-side rendered HTML override from /recaps/{gameId}.markdown.
   *  When present, replaces the auto-generated recap body. Sanitized
   *  upstream by markdownToHtml(). */
  recapOverrideHtml?: string | null;
  /** Optional client-side editor affordance (admin/captain). Server-
   *  rendered slot so BoxScoreContent stays presentational. */
  recapEditor?: React.ReactNode;
}

export function BoxScoreContent(props: BoxScoreContentProps) {
  const { gameId, date, field, status, innings, away, home, playerNames } =
    props;
  const view = props.view ?? "box";
  const isFinal = status === "final" || status === "approved";

  // --- Preview mode (game not played yet) ----------------------------
  if (!isFinal) {
    return (
      <div className="bs-root">
        <PreviewHero away={away} home={home} date={date} field={field} />
        <PreviewBlurb away={away} home={home} date={date} field={field} />
      </div>
    );
  }

  const aWin = away.score > home.score;
  const hWin = home.score > away.score;

  const recap = buildRecap({
    awayTeamName: away.name,
    homeTeamName: home.name,
    awayScore: away.score,
    homeScore: home.score,
    awayLineup: away.lineup,
    homeLineup: home.lineup,
    awayPitchers: away.pitchers,
    homePitchers: home.pitchers,
    awayLine: away.linescore,
    homeLine: home.linescore,
    field,
    date,
    playerNames,
    awayScoreOnly: away.score_only,
    homeScoreOnly: home.score_only,
  });

  return (
    <div className="bs-root">
      {/* HERO: logos + AWAY/HOME labels + big score + FINAL + meta. */}
      <div className="bs-hero">
        <TeamBlock team={away} side="Away" winner={aWin} />
        <div className="bs-score-mid">
          <div className="bs-score-line">
            <span className={"bs-score" + (aWin ? "" : " loser")}>
              {away.score}
            </span>
            <span className="bs-dash">–</span>
            <span className={"bs-score" + (hWin ? "" : " loser")}>
              {home.score}
            </span>
          </div>
          <span className="bs-final">FINAL</span>
        </div>
        <TeamBlock team={home} side="Home" winner={hWin} />
      </div>

      <div className="bs-meta">
        {date && (
          <span>
            <span aria-hidden>🗓</span>{" "}
            {new Date(date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </span>
        )}
        {field && (
          <span>
            <span aria-hidden>📍</span> {field}
          </span>
        )}
      </div>

      {/* Tabs flip between two pre-rendered bodies via client state.
          Initial tab honours ?tab=recap on the URL so deep links still
          land on the recap. */}
      <BoxScoreTabs
        initial={view}
        boxBody={
          <>
            <SectionLabel>Line Score</SectionLabel>
            <Linescore innings={innings} away={away} home={home} />

            <SectionLabel>Batting</SectionLabel>
            <BattingPanel
              team={away}
              playerNames={playerNames}
              emptyLabel={away.abbrev ?? away.name}
            />
            <BattingPanel
              team={home}
              playerNames={playerNames}
              emptyLabel={home.abbrev ?? home.name}
            />

            {(away.pitchers.length > 0 || home.pitchers.length > 0) && (
              <>
                <SectionLabel>Pitching</SectionLabel>
                {away.pitchers.length > 0 && (
                  <PitchingPanel team={away} playerNames={playerNames} />
                )}
                {home.pitchers.length > 0 && (
                  <PitchingPanel team={home} playerNames={playerNames} />
                )}
              </>
            )}
          </>
        }
        recapBody={
          <div className="bs-recap-body">
            {props.recapEditor && (
              <div className="bs-recap-edit-slot">{props.recapEditor}</div>
            )}
            {props.recapOverrideHtml ? (
              // Admin/captain wrote a custom recap. Sanitized at
              // write time via /api/game-recap → markdownToHtml; we
              // sanitize AGAIN at render (closes audit M11) as
              // belt-and-suspenders defense against any future
              // out-of-band write to /recaps/{gameId} that
              // bypasses the API path (Admin SDK migration, manual
              // Firestore edit, etc.). Matches the HomepageBanner
              // pattern.
              <div
                className="bs-recap-override"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(props.recapOverrideHtml),
                }}
              />
            ) : recap ? (
              <>
                <p className="bs-recap-headline">{recap.headline}</p>
                {recap.body.map((p, i) => (
                  <p key={i} className="bs-recap-p">
                    {p}
                  </p>
                ))}
                {recap.potg && (
                  <PotgCallout
                    potg={recap.potg}
                    away={away}
                    home={home}
                  />
                )}
              </>
            ) : (
              <p className="bs-recap-p" style={{ color: "var(--muted)" }}>
                No recap yet.
              </p>
            )}
          </div>
        }
      />
    </div>
  );
}

// ---------- pieces ---------------------------------------------------

function TeamBlock({
  team,
  side,
  winner,
}: {
  team: BoxTeam;
  side: "Away" | "Home";
  winner: boolean;
}) {
  return (
    <Link
      href={`/teams/${team.team_id}`}
      className={"bs-team" + (winner ? " bs-team-winner" : "")}
    >
      <div className="bs-team-logo">
        {team.logoUrl ? (
          <img src={team.logoUrl} alt="" />
        ) : (
          <span
            className="bs-team-initials"
            style={{ background: team.color ?? "#94a3b8" }}
          >
            {(team.abbrev ?? team.name.slice(0, 3)).toUpperCase()}
          </span>
        )}
      </div>
      <div
        className="bs-team-abbr"
        style={{ color: winner ? team.color : undefined }}
      >
        {(team.abbrev ?? team.name.slice(0, 3)).toUpperCase()}
      </div>
      <div className="bs-team-side">
        {team.record ? `${side.toUpperCase()} · ${team.record}` : side.toUpperCase()}
      </div>
    </Link>
  );
}

function PreviewBlurb({
  away,
  home,
  date,
  field,
}: {
  away: BoxTeam;
  home: BoxTeam;
  date: string | null;
  field: string | null;
}) {
  const lines = buildPreviewLines(away, home, date, field);
  return (
    <div
      className="bs-recap-body"
      style={{ marginTop: 16, paddingTop: 0 }}
    >
      <p className="bs-recap-headline">{lines.headline}</p>
      {lines.body.map((p, i) => (
        <p key={i} className="bs-recap-p">
          {p}
        </p>
      ))}
    </div>
  );
}

function buildPreviewLines(
  away: BoxTeam,
  home: BoxTeam,
  date: string | null,
  field: string | null,
): { headline: string; body: string[] } {
  const aRec = parseRecord(away.record);
  const hRec = parseRecord(home.record);
  const when = date
    ? new Date(date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      })
    : null;
  const time = date
    ? new Date(date).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const headline = `${away.name} at ${home.name}`;
  const body: string[] = [];

  // Sentence 1 — the matchup, when, where.
  const where = field ? ` at ${field}` : "";
  const whenStr = when && time ? `${when} at ${time}` : when ?? "TBD";
  body.push(
    `${away.name}${aRec ? ` (${away.record})` : ""} visit ${home.name}${hRec ? ` (${home.record})` : ""} on ${whenStr}${where}.`,
  );

  // Sentence 2 — relative form / season context.
  body.push(formContext(away, home, aRec, hRec));

  // Sentence 3 — a closing line about expectations.
  body.push(closingHype(away, home, aRec, hRec));

  return { headline, body };
}

function parseRecord(rec?: string): { w: number; l: number; t: number } | null {
  if (!rec) return null;
  const parts = rec.split("-").map((s) => Number(s));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return { w: parts[0] ?? 0, l: parts[1] ?? 0, t: parts[2] ?? 0 };
}

function formContext(
  away: BoxTeam,
  home: BoxTeam,
  a: ReturnType<typeof parseRecord>,
  h: ReturnType<typeof parseRecord>,
): string {
  if (!a || !h) {
    return `Both clubs are looking to put a clean game together and stack a result on the board.`;
  }
  const aGames = a.w + a.l + a.t;
  const hGames = h.w + h.l + h.t;
  if (aGames === 0 && hGames === 0) {
    return `Each team is opening their season here, so first impressions matter.`;
  }
  const aWin = a.w / Math.max(1, aGames);
  const hWin = h.w / Math.max(1, hGames);
  if (Math.abs(aWin - hWin) < 0.1) {
    return `Both squads enter on similar footing, which sets up a competitive matchup top to bottom.`;
  }
  if (aWin > hWin) {
    return `${away.name} arrives the hotter team — a road test that will show whether their start carries over against ${home.name}.`;
  }
  return `${home.name} has had the better of it so far this season and will look to defend home turf against ${away.name}.`;
}

function closingHype(
  away: BoxTeam,
  home: BoxTeam,
  a: ReturnType<typeof parseRecord>,
  h: ReturnType<typeof parseRecord>,
): string {
  const undefeated =
    (a && a.l === 0 && a.w + a.t > 0) || (h && h.l === 0 && h.w + h.t > 0);
  if (undefeated) {
    return `An unbeaten record is on the line, so expect both clubs to play with extra edge.`;
  }
  return `Pitching depth and timely hitting will likely decide it — first pitch is set; check back after the final out for the box score and recap.`;
}

function PreviewHero({
  away,
  home,
  date,
  field,
}: {
  away: BoxTeam;
  home: BoxTeam;
  date: string | null;
  field: string | null;
}) {
  return (
    <div className="bs-hero">
      <TeamBlock team={away} side="Away" winner={false} />
      <div className="bs-score-mid">
        <div className="bs-score-line">
          <span className="bs-vs">VS</span>
        </div>
        <span className="bs-final">
          {date
            ? new Date(date).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })
            : "TBD"}
        </span>
        {date && (
          <span className="bs-final" style={{ marginTop: 2 }}>
            {new Date(date).toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        )}
        {field && (
          <span className="bs-final" style={{ marginTop: 2 }}>
            {field}
          </span>
        )}
      </div>
      <TeamBlock team={home} side="Home" winner={false} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="bs-section-label">{children}</div>;
}

function Linescore({
  innings,
  away,
  home,
}: {
  innings: number;
  away: BoxTeam;
  home: BoxTeam;
}) {
  const inningsArray = Array.from({ length: innings }, (_, i) => i + 1);
  return (
    <div className="bs-linescore-wrap">
      <table className="linescore-tbl">
        <thead>
          <tr>
            <th>Team</th>
            {inningsArray.map((i) => (
              <th key={i}>{i}</th>
            ))}
            <th>R</th>
            <th>H</th>
            <th>E</th>
          </tr>
        </thead>
        <tbody>
          <LinescoreRow team={away} innings={innings} />
          <LinescoreRow team={home} innings={innings} />
        </tbody>
      </table>
    </div>
  );
}

function LinescoreRow({ team, innings }: { team: BoxTeam; innings: number }) {
  const linescore = team.linescore ?? [];
  // Score-Only teams render '–' across every inning column AND in
  // H/E (no individual stats were recorded). R still shows the
  // captain's submitted final score.
  const dash = team.score_only;
  return (
    <tr>
      <td style={{ color: team.color }}>
        {(team.abbrev ?? team.name.slice(0, 3)).toUpperCase()}
      </td>
      {Array.from({ length: innings }, (_, i) => (
        <td key={i}>{dash ? "–" : (linescore[i] ?? "-")}</td>
      ))}
      <td>
        <b>{team.score}</b>
      </td>
      <td>
        <b>{dash ? "–" : (team.hits ?? "-")}</b>
      </td>
      <td>
        <b>{dash ? "–" : (team.errors ?? "-")}</b>
      </td>
    </tr>
  );
}

function BattingPanel({
  team,
  playerNames,
  emptyLabel,
}: {
  team: BoxTeam;
  playerNames: Record<string, string>;
  emptyLabel: string;
}) {
  return (
    <>
      <div className="modal-batting-hdr">
        <div
          className="modal-batting-title"
          style={{ color: team.color ?? "var(--brand-primary)" }}
        >
          {team.name}
        </div>
      </div>
      {team.score_only ? (
        <div className="bs-empty-batting">
          Score-only entry — no individual stats recorded for{" "}
          {emptyLabel}.
        </div>
      ) : team.lineup.length === 0 ? (
        <div className="bs-empty-batting">
          No batting data for {emptyLabel}.
        </div>
      ) : (
        <BattingTable rows={team.lineup} playerNames={playerNames} />
      )}
    </>
  );
}

function BattingTable({
  rows,
  playerNames,
}: {
  rows: BoxBatter[];
  playerNames: Record<string, string>;
}) {
  const totals = rows.reduce(
    (acc, r) => ({
      ab: acc.ab + (r.ab ?? 0),
      r: acc.r + (r.r ?? 0),
      h: acc.h + (r.h ?? 0),
      doubles: acc.doubles + (r.doubles ?? 0),
      triples: acc.triples + (r.triples ?? 0),
      hr: acc.hr + (r.hr ?? 0),
      rbi: acc.rbi + (r.rbi ?? 0),
      bb: acc.bb + (r.bb ?? 0),
      so: acc.so + (r.so ?? 0),
    }),
    { ab: 0, r: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0 },
  );
  return (
    <div className="bat-tbl-wrap">
      <table className="bat-tbl">
        <thead>
          <tr>
            <th className="text-left">Player</th>
            <th>AB</th>
            <th>R</th>
            <th>H</th>
            <th>2B</th>
            <th>3B</th>
            <th>HR</th>
            <th>RBI</th>
            <th>BB</th>
            <th>K</th>
            <th>AVG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ab = r.ab ?? 0;
            const h = r.h ?? 0;
            const avg = ab > 0 ? (h / ab).toFixed(3).replace(/^0/, "") : ".000";
            return (
              <tr key={r.player_id}>
                <td className="text-left">
                  <Link
                    href={`/players/${r.player_id}`}
                    style={{ fontWeight: 600 }}
                  >
                    {playerNames[r.player_id] ?? r.player_id}
                  </Link>
                </td>
                <td>{ab}</td>
                <td>{r.r ?? 0}</td>
                <td>{h}</td>
                <td>{r.doubles ?? 0}</td>
                <td>{r.triples ?? 0}</td>
                <td>{r.hr ?? 0}</td>
                <td>{r.rbi ?? 0}</td>
                <td>{r.bb ?? 0}</td>
                <td>{r.so ?? 0}</td>
                <td>{avg}</td>
              </tr>
            );
          })}
          <tr className="totals-row">
            <td className="text-left">Totals</td>
            <td>{totals.ab}</td>
            <td>{totals.r}</td>
            <td>{totals.h}</td>
            <td>{totals.doubles}</td>
            <td>{totals.triples}</td>
            <td>{totals.hr}</td>
            <td>{totals.rbi}</td>
            <td>{totals.bb}</td>
            <td>{totals.so}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PitchingPanel({
  team,
  playerNames,
}: {
  team: BoxTeam;
  playerNames: Record<string, string>;
}) {
  return (
    <>
      <div className="modal-batting-hdr">
        <div
          className="modal-batting-title"
          style={{ color: team.color ?? "var(--brand-primary)" }}
        >
          {team.name}
        </div>
      </div>
      <div className="bat-tbl-wrap">
        <table className="bat-tbl">
          <thead>
            <tr>
              <th className="text-left">Pitcher</th>
              <th>IP</th>
              <th>H</th>
              <th>R</th>
              <th>ER</th>
              <th>BB</th>
              <th>K</th>
              <th>HR</th>
              <th>ERA</th>
              <th>Dec</th>
            </tr>
          </thead>
          <tbody>
            {team.pitchers.map((p) => {
              const outs = p.ip_outs ?? 0;
              const er = p.er ?? 0;
              const era =
                outs > 0 ? ((er * 27) / outs).toFixed(2) : "—";
              return (
                <tr key={p.player_id}>
                  <td className="text-left">
                    <Link
                      href={`/players/${p.player_id}`}
                      style={{ fontWeight: 600 }}
                    >
                      {playerNames[p.player_id] ?? p.player_id}
                    </Link>
                  </td>
                  <td>{formatIP(outs)}</td>
                  <td>{p.h ?? 0}</td>
                  <td>{p.r ?? 0}</td>
                  <td>{er}</td>
                  <td>{p.bb ?? 0}</td>
                  <td>{p.so ?? 0}</td>
                  <td>{p.hr ?? 0}</td>
                  <td>{era}</td>
                  <td>{p.decision ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}


// Player-of-the-Game callout — gold/yellow panel under the recap
// with the player's stat line. Looks up the box-score line for the
// POTG so we can render their key numbers without re-passing them
// from the parent.
function PotgCallout({
  potg,
  away,
  home,
}: {
  potg: { player_id: string; player_name: string; source: "batting" | "pitching" };
  away: BoxTeam;
  home: BoxTeam;
}) {
  if (potg.source === "pitching") {
    const line =
      [...away.pitchers, ...home.pitchers].find(
        (p) => p.player_id === potg.player_id,
      ) ?? null;
    return (
      <div className="bs-potg">
        <span className="bs-potg-lbl">Player of the Game</span>
        <Link
          className="bs-potg-name"
          href={`/players/${potg.player_id}`}
        >
          {potg.player_name}
        </Link>
        {line && (
          <div className="bs-potg-stats">
            <Stat label="IP" value={formatIP(line.ip_outs ?? 0)} />
            <Stat label="H" value={String(line.h ?? 0)} />
            <Stat label="R" value={String(line.r ?? 0)} />
            <Stat label="ER" value={String(line.er ?? 0)} />
            <Stat label="K" value={String(line.so ?? 0)} />
            <Stat label="BB" value={String(line.bb ?? 0)} />
          </div>
        )}
      </div>
    );
  }
  const line =
    [...away.lineup, ...home.lineup].find(
      (b) => b.player_id === potg.player_id,
    ) ?? null;
  const ab = line?.ab ?? 0;
  const h = line?.h ?? 0;
  const avg = ab > 0 ? (h / ab).toFixed(3).replace(/^0/, "") : ".000";
  return (
    <div className="bs-potg">
      <span className="bs-potg-lbl">Player of the Game</span>
      <Link
        className="bs-potg-name"
        href={`/players/${potg.player_id}`}
      >
        {potg.player_name}
      </Link>
      {line && (
        <div className="bs-potg-stats">
          <Stat label="AB" value={String(ab)} />
          <Stat label="H" value={String(h)} />
          <Stat label="R" value={String(line.r ?? 0)} />
          <Stat label="HR" value={String(line.hr ?? 0)} />
          <Stat label="RBI" value={String(line.rbi ?? 0)} />
          <Stat label="BB" value={String(line.bb ?? 0)} />
          <Stat label="AVG" value={avg} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bs-potg-stat">
      <span className="bs-potg-stat-val">{value}</span>
      <span className="bs-potg-stat-lbl">{label}</span>
    </div>
  );
}

