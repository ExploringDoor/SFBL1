import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminDb } from "@/lib/firebase-admin";
import { formatIP } from "@/lib/stats/ip";
import { buildRecap } from "@/lib/stats/recap";
import type { PublicLeagueConfig } from "@/lib/tenants";

export const dynamic = "force-dynamic";

interface BattingLine {
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

interface PitchingLine {
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

export default async function GameDetailPage({
  params,
}: {
  params: { gameId: string };
}) {
  const h = headers();
  const tenantId = h.get("x-tenant-id");
  const config = (() => {
    const raw = h.get("x-tenant-config-json");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PublicLeagueConfig;
    } catch {
      return null;
    }
  })();

  if (!tenantId) {
    return (
      <Shell heading="Game">
        <p className="text-slate-700">Visit a tenant subdomain.</p>
      </Shell>
    );
  }

  const db = getAdminDb();
  const [gameSnap, boxSnap, teamsSnap, playersSnap] = await Promise.all([
    db.doc(`leagues/${tenantId}/games/${params.gameId}`).get(),
    db.doc(`leagues/${tenantId}/box_scores/${params.gameId}`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.collection(`leagues/${tenantId}/players`).get(),
  ]);
  if (!gameSnap.exists) notFound();

  const game = gameSnap.data() ?? {};
  const homeTeamId = String(game.home_team_id ?? "");
  const awayTeamId = String(game.away_team_id ?? "");
  const homeScore = Number(game.home_score ?? 0);
  const awayScore = Number(game.away_score ?? 0);
  const status = String(game.status ?? "");
  const dateStr = game.date ? String(game.date) : null;
  const field = game.field ? String(game.field) : null;

  const teamNames: Record<string, string> = {};
  for (const d of teamsSnap.docs) {
    teamNames[d.id] = String(d.data().name ?? d.id);
  }
  const playerNames: Record<string, string> = {};
  for (const d of playersSnap.docs) {
    playerNames[d.id] = String(d.data().name ?? d.id);
  }

  const homeName = teamNames[homeTeamId] ?? homeTeamId;
  const awayName = teamNames[awayTeamId] ?? awayTeamId;

  const isFinal = status === "final" || status === "approved";
  const box = boxSnap.exists ? (boxSnap.data() as Record<string, unknown>) : null;
  const awayLineup = (box?.away_lineup as BattingLine[] | undefined) ?? [];
  const homeLineup = (box?.home_lineup as BattingLine[] | undefined) ?? [];
  const awayPitchers = (box?.away_pitchers as PitchingLine[] | undefined) ?? [];
  const homePitchers = (box?.home_pitchers as PitchingLine[] | undefined) ?? [];

  const recap =
    isFinal && box
      ? buildRecap({
          awayTeamName: awayName,
          homeTeamName: homeName,
          awayScore,
          homeScore,
          awayLineup,
          homeLineup,
          awayPitchers,
          homePitchers,
          playerNames,
        })
      : null;

  return (
    <Shell heading="">
      <Header
        homeName={homeName}
        awayName={awayName}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        homeScore={homeScore}
        awayScore={awayScore}
        status={status}
        dateStr={dateStr}
        field={field}
      />

      {recap && (
        <section className="my-8 rounded-md border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-900">{recap.headline}</p>
          {recap.body.map((p, i) => (
            <p key={i} className="mt-2 text-sm text-slate-700">
              {p}
            </p>
          ))}
          {recap.potg && (
            <p className="mt-3 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
              POTG ·{" "}
              <Link href={`/players/${recap.potg.player_id}`} className="underline">
                {recap.potg.player_name}
              </Link>
            </p>
          )}
        </section>
      )}

      {box ? (
        <>
          <BattingTable
            heading={`${awayName} batting`}
            rows={awayLineup}
            playerNames={playerNames}
          />
          <BattingTable
            heading={`${homeName} batting`}
            rows={homeLineup}
            playerNames={playerNames}
          />
          {(awayPitchers.length > 0 || homePitchers.length > 0) && (
            <>
              <PitchingTable
                heading={`${awayName} pitching`}
                rows={awayPitchers}
                playerNames={playerNames}
              />
              <PitchingTable
                heading={`${homeName} pitching`}
                rows={homePitchers}
                playerNames={playerNames}
              />
            </>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          {isFinal
            ? "No box score recorded for this game yet."
            : "Game has not been played yet."}
        </p>
      )}
    </Shell>
  );
}

function Header({
  homeName,
  awayName,
  homeTeamId,
  awayTeamId,
  homeScore,
  awayScore,
  status,
  dateStr,
  field,
}: {
  homeName: string;
  awayName: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  dateStr: string | null;
  field: string | null;
}) {
  const isFinal = status === "final" || status === "approved";
  const formattedDate = dateStr
    ? new Date(dateStr).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <header className="border-b border-slate-200 pb-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        {formattedDate}
        {field && <> · {field}</>}
        {!isFinal && <> · {status}</>}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 text-2xl">
        <Link
          href={`/teams/${awayTeamId}`}
          className={
            "hover:underline " +
            (isFinal && awayScore > homeScore
              ? "font-bold text-slate-900"
              : "text-slate-700")
          }
        >
          {awayName}
        </Link>
        <span
          className={
            "tabular-nums " +
            (isFinal && awayScore > homeScore
              ? "font-bold text-slate-900"
              : "text-slate-700")
          }
        >
          {isFinal ? awayScore : "—"}
        </span>
        <Link
          href={`/teams/${homeTeamId}`}
          className={
            "hover:underline " +
            (isFinal && homeScore > awayScore
              ? "font-bold text-slate-900"
              : "text-slate-700")
          }
        >
          {homeName}
        </Link>
        <span
          className={
            "tabular-nums " +
            (isFinal && homeScore > awayScore
              ? "font-bold text-slate-900"
              : "text-slate-700")
          }
        >
          {isFinal ? homeScore : "—"}
        </span>
      </div>
    </header>
  );
}

function BattingTable({
  heading,
  rows,
  playerNames,
}: {
  heading: string;
  rows: BattingLine[];
  playerNames: Record<string, string>;
}) {
  if (rows.length === 0) return null;
  // Totals row.
  const totals = rows.reduce(
    (acc, r) => ({
      ab: acc.ab + (r.ab ?? 0),
      r: acc.r + (r.r ?? 0),
      h: acc.h + (r.h ?? 0),
      rbi: acc.rbi + (r.rbi ?? 0),
      bb: acc.bb + (r.bb ?? 0),
      so: acc.so + (r.so ?? 0),
    }),
    { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 },
  );
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {heading}
      </h2>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <Th className="text-left">Player</Th>
              <Th>AB</Th>
              <Th>R</Th>
              <Th>H</Th>
              <Th>RBI</Th>
              <Th>BB</Th>
              <Th>SO</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((b) => (
              <tr key={b.player_id}>
                <Td className="text-left">
                  <Link
                    href={`/players/${b.player_id}`}
                    className="font-medium hover:underline"
                  >
                    {playerNames[b.player_id] ?? b.player_id}
                  </Link>
                </Td>
                <Td>{b.ab ?? 0}</Td>
                <Td>{b.r ?? 0}</Td>
                <Td>{b.h ?? 0}</Td>
                <Td>{b.rbi ?? 0}</Td>
                <Td>{b.bb ?? 0}</Td>
                <Td>{b.so ?? 0}</Td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <Td className="text-left">Totals</Td>
              <Td>{totals.ab}</Td>
              <Td>{totals.r}</Td>
              <Td>{totals.h}</Td>
              <Td>{totals.rbi}</Td>
              <Td>{totals.bb}</Td>
              <Td>{totals.so}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PitchingTable({
  heading,
  rows,
  playerNames,
}: {
  heading: string;
  rows: PitchingLine[];
  playerNames: Record<string, string>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {heading}
      </h2>
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <Th className="text-left">Pitcher</Th>
              <Th>IP</Th>
              <Th>H</Th>
              <Th>R</Th>
              <Th>ER</Th>
              <Th>BB</Th>
              <Th>SO</Th>
              <Th>Dec</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((p) => (
              <tr key={p.player_id}>
                <Td className="text-left">
                  <Link
                    href={`/players/${p.player_id}`}
                    className="font-medium hover:underline"
                  >
                    {playerNames[p.player_id] ?? p.player_id}
                  </Link>
                </Td>
                <Td>{formatIP(p.ip_outs ?? 0)}</Td>
                <Td>{p.h ?? 0}</Td>
                <Td>{p.r ?? 0}</Td>
                <Td>{p.er ?? 0}</Td>
                <Td>{p.bb ?? 0}</Td>
                <Td>{p.so ?? 0}</Td>
                <Td className="font-semibold">{p.decision ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/scores" className="text-xs text-slate-500 hover:underline">
        ← All scores
      </Link>
      {heading && <h1 className="mb-4 text-3xl font-bold tracking-tight">{heading}</h1>}
      {children}
    </main>
  );
}
function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-right font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-right tabular-nums ${className}`}>{children}</td>;
}
