// /print/schedule — full league schedule, print-friendly.
//
// Public page (same auth model as /schedule). Pulls every game,
// groups by date, renders as compact tables. Captains, players,
// and admins all use the same view — no PII here.

import { headers } from "next/headers";
import { getAdminDb } from "@/lib/firebase-admin";
import "../print.css";
import { PrintToolbar } from "../PrintToolbar";

export const dynamic = "force-dynamic";

interface GameDoc {
  id: string;
  date: string;
  time: string;
  field: string;
  away_team_id: string;
  home_team_id: string;
  division: string;
  status: string;
  away_score: number | null;
  home_score: number | null;
}

export default async function PrintSchedulePage({
  searchParams,
}: {
  searchParams?: { div?: string };
}) {
  const tenantId = headers().get("x-tenant-id");
  if (!tenantId) {
    return (
      <div className="print-page">
        <p>No tenant. Visit on a tenant subdomain.</p>
      </div>
    );
  }

  const db = getAdminDb();
  const [gameSnap, teamSnap, leagueSnap] = await Promise.all([
    db.collection(`leagues/${tenantId}/games`).get(),
    db.collection(`leagues/${tenantId}/teams`).get(),
    db.doc(`leagues/${tenantId}`).get(),
  ]);

  const teamName = new Map<string, string>();
  for (const d of teamSnap.docs) {
    teamName.set(d.id, String(d.data().name ?? d.id));
  }

  const games: GameDoc[] = gameSnap.docs
    .map((d) => {
      const data = d.data();
      // Two storage shapes (see ScheduleEditor for details):
      // combined ISO datetime in `date`, OR separate date + time
      // fields. Normalize to date+time before grouping.
      const { date, time } = splitDateTime(
        String(data.date ?? ""),
        String(data.time ?? ""),
      );
      return {
        id: d.id,
        date,
        time,
        field: String(data.field ?? ""),
        away_team_id: String(data.away_team_id ?? ""),
        home_team_id: String(data.home_team_id ?? ""),
        division: String(data.division ?? ""),
        status: String(data.status ?? "scheduled"),
        away_score: data.away_score == null ? null : Number(data.away_score),
        home_score: data.home_score == null ? null : Number(data.home_score),
      };
    })
    .filter((g) => !searchParams?.div || g.division === searchParams.div)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    });

  const leagueName = String(leagueSnap.data()?.name ?? tenantId);

  // Group by date.
  const byDate = new Map<string, GameDoc[]>();
  for (const g of games) {
    const k = g.date || "(no date)";
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(g);
  }

  return (
    <div className="print-page">
      <PrintToolbar />
      <header className="print-header">
        <div>
          <div className="print-title">{leagueName} Schedule</div>
          {searchParams?.div && (
            <div className="print-meta">{searchParams.div} division</div>
          )}
        </div>
        <div className="print-meta">
          {games.length} games · {byDate.size} dates · printed{" "}
          {new Date().toLocaleDateString()}
        </div>
      </header>

      {games.length === 0 ? (
        <p>No games match the current filter.</p>
      ) : (
        Array.from(byDate.entries()).map(([date, list]) => (
          <section key={date} className="print-section">
            <h2 className="print-section-heading">{formatDate(date)}</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Time</th>
                  <th style={{ width: 80 }}>Division</th>
                  <th>Matchup</th>
                  <th>Field</th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((g) => (
                  <tr key={g.id}>
                    <td className="print-num">{g.time || "—"}</td>
                    <td>{g.division || "—"}</td>
                    <td>
                      {teamName.get(g.away_team_id) ?? g.away_team_id}{" "}
                      <span style={{ color: "#888" }}>@</span>{" "}
                      {teamName.get(g.home_team_id) ?? g.home_team_id}
                      {(g.status === "final" || g.status === "approved") && (
                        <span className="print-num" style={{ marginLeft: 10 }}>
                          {g.away_score} – {g.home_score}
                        </span>
                      )}
                    </td>
                    <td>{g.field || "TBD"}</td>
                    <td>
                      <span
                        className={`print-status-pill print-status-${g.status}`}
                      >
                        {g.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}

function formatDate(yyyymmdd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return yyyymmdd;
  const d = new Date(`${yyyymmdd}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// See components/admin/ScheduleEditor for context. Split a stored
// game `date`/`time` pair into local-TZ date + time strings.
// Server-side equivalent — works the same since Node uses the
// host TZ unless we override.
function splitDateTime(
  dateRaw: string,
  timeRaw: string,
): { date: string; time: string } {
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) &&
    (timeRaw === "" || /^\d{1,2}:\d{2}$/.test(timeRaw))
  ) {
    return { date: dateRaw, time: timeRaw };
  }
  const d = new Date(dateRaw);
  if (Number.isNaN(d.getTime())) {
    return { date: dateRaw.slice(0, 10), time: timeRaw };
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` };
}
