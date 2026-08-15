// LCYBL Record Book — the league's all-time records, computed from the
// 2009-2025 archive (lib/lcybl-records). LCYBL-only: the archive JSON is
// tenant data, so other tenants 404.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getRecordBook } from "@/lib/lcybl-records";
import "./records.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record Book" };

function fmtPct(p: number): string {
  if (p === 1) return "1.000";
  return p.toFixed(3).replace(/^0/, "");
}

function yearList(titles: { season: string }[]): string {
  // Two titles in one summer (different age groups) collapse to "2009 ×2".
  const counts = new Map<string, number>();
  for (const t of titles) counts.set(t.season, (counts.get(t.season) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, n]) => (n > 1 ? `${year} ×${n}` : year))
    .join(", ");
}

export default function RecordsPage() {
  const tenantId = headers().get("x-tenant-id");
  if (tenantId !== "lcybl") notFound();

  const rb = getRecordBook();
  const podium = rb.titles.slice(0, 3);
  const restTitles = rb.titles.slice(3, 15);
  const dynasties = rb.backToBack.slice(0, 12);

  return (
    <main className="container py-10">
      <header className="rb-head">
        <p className="rb-eyebrow">Record Book</p>
        <h1 className="rb-title">All-Time LCYBL Records</h1>
        <p className="rb-sub">
          {rb.seasonsCovered.first}–{rb.seasonsCovered.last} ·{" "}
          {rb.seasonsCovered.count} seasons · {rb.totalTitles} championships
          awarded ·{" "}
          <Link href="/history" style={{ color: "var(--brand-primary)", fontWeight: 700 }}>
            season-by-season history →
          </Link>
        </p>
      </header>

      {/* ── Title Tracker ─────────────────────────────────────────── */}
      <section className="rb-sec">
        <h2 className="rb-h2">Title Tracker</h2>
        <p className="rb-note">
          Championships won since {rb.seasonsCovered.first}, all age groups.
        </p>
        <div className="rb-podium">
          {podium.map((t, i) => (
            <article key={t.team} className="rb-champ-card">
              <span className="rb-champ-rank">
                {i === 0 ? "MOST TITLES" : `#${i + 1}`}
              </span>
              <div className="rb-champ-count">
                {t.count}
                <small>{t.count === 1 ? "title" : "titles"}</small>
              </div>
              <div className="rb-champ-team">{t.team}</div>
              <div className="rb-champ-years">{yearList(t.titles)}</div>
            </article>
          ))}
        </div>
        <div className="rb-card rb-scroll">
          <table className="rb-tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th className="num">Titles</th>
                <th>Years</th>
              </tr>
            </thead>
            <tbody>
              {restTitles.map((t, i) => (
                <tr key={t.team}>
                  <td className="num">{i + 4}</td>
                  <td className="team">{t.team}</td>
                  <td className="num">{t.count}</td>
                  <td style={{ whiteSpace: "normal", color: "var(--muted)", fontSize: 13 }}>
                    {yearList(t.titles)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Perfect Seasons ───────────────────────────────────────── */}
      <section className="rb-sec">
        <h2 className="rb-h2">Perfect Seasons</h2>
        <p className="rb-note">
          Undefeated, untied regular seasons (minimum 12 games).
        </p>
        <div className="rb-card rb-scroll">
          <table className="rb-tbl">
            <thead>
              <tr>
                <th>Team</th>
                <th className="num">Record</th>
                <th>Season</th>
                <th>Division</th>
              </tr>
            </thead>
            <tbody>
              {rb.perfectSeasons.map((r, i) => (
                <tr key={`${r.team}-${r.season}`} className={i === 0 ? "first" : ""}>
                  <td className="team">
                    {r.team}
                    <span className="rb-perfect-badge">Perfect</span>
                  </td>
                  <td className="num">
                    {r.w}-{r.l}
                  </td>
                  <td>{r.season}</td>
                  <td style={{ color: "var(--muted)" }}>{r.division}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Best Single Seasons ───────────────────────────────────── */}
      <section className="rb-sec">
        <h2 className="rb-h2">Best Single Seasons</h2>
        <p className="rb-note">
          The closest calls: one-loss and one-tie seasons (minimum 12 games).
        </p>
        <div className="rb-card rb-scroll">
          <table className="rb-tbl">
            <thead>
              <tr>
                <th>Team</th>
                <th className="num">Record</th>
                <th className="num">PCT</th>
                <th>Season</th>
                <th>Division</th>
              </tr>
            </thead>
            <tbody>
              {rb.bestSeasons.map((r) => (
                <tr key={`${r.team}-${r.season}-${r.w}`}>
                  <td className="team">{r.team}</td>
                  <td className="num">
                    {r.w}-{r.l}
                    {r.t ? `-${r.t}` : ""}
                  </td>
                  <td className="num">{fmtPct(r.pct)}</td>
                  <td>{r.season}</td>
                  <td style={{ color: "var(--muted)" }}>{r.division}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Dynasties ─────────────────────────────────────────────── */}
      {dynasties.length > 0 && (
        <section className="rb-sec">
          <h2 className="rb-h2">Dynasties</h2>
          <p className="rb-note">
            Back-to-back (or longer) championship runs in the same age group.
          </p>
          <div className="rb-dyn">
            {dynasties.map((d) => (
              <div key={`${d.team}-${d.seasons[0]}`} className="rb-dyn-chip">
                <div className="rb-dyn-team">{d.team}</div>
                <div className="rb-dyn-run">
                  <b>{d.seasons.length} straight</b> · {d.division} ·{" "}
                  {d.seasons[0]}–{d.seasons[d.seasons.length - 1]}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── All-Time Wins ─────────────────────────────────────────── */}
      <section className="rb-sec">
        <h2 className="rb-h2">All-Time Wins</h2>
        <p className="rb-note">
          Career regular-season records, {rb.seasonsCovered.first}–
          {rb.seasonsCovered.last}. Teams are counted by the name they played
          under.
        </p>
        <div className="rb-card rb-scroll">
          <table className="rb-tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th className="num">W</th>
                <th className="num">L</th>
                <th className="num">T</th>
                <th className="num">PCT</th>
                <th className="num">Seasons</th>
              </tr>
            </thead>
            <tbody>
              {rb.allTimeWins.map((f, i) => (
                <tr key={f.team} className={i === 0 ? "first" : ""}>
                  <td className="num">{i + 1}</td>
                  <td className="team">{f.team}</td>
                  <td className="num">{f.w}</td>
                  <td className="num">{f.l}</td>
                  <td className="num">{f.t}</td>
                  <td className="num">{fmtPct(f.pct)}</td>
                  <td className="num">{f.seasons}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
