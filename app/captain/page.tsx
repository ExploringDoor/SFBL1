"use client";

// Captain portal landing — the team's "command center". Auth-gated;
// the user must have `captain:<team_id>` claim for the active league
// (see firestore.rules:30-34). Layout:
//
//   1. Hero strip: team logo + name + record + captain greeting
//   2. Roster card with edit links per player
//   3. Upcoming games list — each row links to the lineup editor
//   4. Recent games list — each row links to the box-score editor
//
// The data fetch runs client-side here so we can render with the
// captain's auth token in scope. (Most public pages fetch via Admin
// SDK on the server. Captain pages need user-scoped reads + writes,
// so they all run in the browser with the Web SDK.)

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { awaitingScoreGames } from "@/lib/captain-next-up";
import { RosterTab } from "@/components/captain/RosterTab";
import { ScheduleTab } from "@/components/captain/ScheduleTab";
import { PaymentsTab } from "@/components/captain/PaymentsTab";
import { AttendanceTab } from "@/components/captain/AttendanceTab";
import { TeamChatTab } from "@/components/captain/TeamChatTab";
import { CaptainsChatTab } from "@/components/captain/CaptainsChatTab";
import { HelpTab } from "@/components/captain/HelpTab";
import { QuickScoreTab } from "@/components/captain/QuickScoreTab";
import { FirstTimeWelcome } from "@/components/captain/FirstTimeWelcome";
import { NotificationsPanel } from "@/components/notifications/NotificationsPanel";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import {
  useCaptainTeam,
  useLeagueRole,
  useUser,
} from "@/lib/auth-client";

interface TeamSnap {
  id: string;
  name: string;
  abbrev?: string;
  color?: string;
  logoUrl?: string | null;
  division?: string;
}

interface PlayerSnap {
  id: string;
  name: string;
  jersey: number | null;
  position: string | null;
}

interface GameSnap {
  id: string;
  date: string | null;
  field: string | null;
  status: string;
  away_team_id: string;
  home_team_id: string;
  away_score: number;
  home_score: number;
}

export default function CaptainHomePage() {
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const { teamId, loading: teamLoading } = useCaptainTeam(tenantId);

  const [team, setTeam] = useState<TeamSnap | null>(null);
  const [teamNames, setTeamNames] = useState<Record<string, string>>(
    {},
  );
  const [roster, setRoster] = useState<PlayerSnap[]>([]);
  const [games, setGames] = useState<GameSnap[]>([]);
  // Per-player RSVP status for the captain's NEXT scheduled game.
  // Populated lazily from /availability after games load. Drives the
  // RSVP summary on the My Team spotlight card.
  const [nextGameRsvps, setNextGameRsvps] = useState<
    Record<string, "yes" | "maybe" | "no">
  >({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId || !teamId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const db = getDb();
      const [teamSnap, rosterSnap, gamesSnap, allTeamsSnap] =
        await Promise.all([
          getDoc(doc(db, `leagues/${tenantId}/teams/${teamId}`)),
          getDocs(
            query(
              collection(db, `leagues/${tenantId}/players`),
              where("team_id", "==", teamId),
            ),
          ),
          getDocs(collection(db, `leagues/${tenantId}/games`)),
          // Pull every team's name once so we can render opponent
          // names on the spotlight + game rows. Cheap (one collection
          // read, max ~20 teams per league).
          getDocs(collection(db, `leagues/${tenantId}/teams`)),
        ]);
      if (cancelled) return;
      const names: Record<string, string> = {};
      for (const t of allTeamsSnap.docs) {
        names[t.id] = String(t.data().name ?? t.id);
      }
      setTeamNames(names);
      if (teamSnap.exists()) {
        const d = teamSnap.data();
        setTeam({
          id: teamSnap.id,
          name: String(d.name ?? teamSnap.id),
          abbrev: d.abbrev ? String(d.abbrev) : undefined,
          color: d.color ? String(d.color) : undefined,
          logoUrl: d.logo_url ? String(d.logo_url) : null,
          division: d.division ? String(d.division) : undefined,
        });
      }
      setRoster(
        rosterSnap.docs
          .map((p) => {
            const data = p.data();
            return {
              id: p.id,
              name: String(data.name ?? p.id),
              jersey: data.jersey != null ? Number(data.jersey) : null,
              position: data.position ? String(data.position) : null,
            };
          })
          .sort(
            (a, b) =>
              (a.jersey ?? 999) - (b.jersey ?? 999) ||
              a.name.localeCompare(b.name),
          ),
      );
      setGames(
        gamesSnap.docs
          .map((g) => {
            const data = g.data();
            return {
              id: g.id,
              date: data.date ? String(data.date) : null,
              field: data.field ? String(data.field) : null,
              status: String(data.status ?? "draft"),
              away_team_id: String(data.away_team_id ?? ""),
              home_team_id: String(data.home_team_id ?? ""),
              away_score: Number(data.away_score ?? 0),
              home_score: Number(data.home_score ?? 0),
            };
          })
          .filter(
            (g) =>
              g.away_team_id === teamId || g.home_team_id === teamId,
          ),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, teamId]);

  // Once games are loaded, fetch RSVPs for the next scheduled game so
  // the My Team spotlight can show "5 yes / 2 maybe / 8 waiting" at
  // a glance. Separate effect to avoid blocking the initial paint —
  // games + roster + team meta render first; RSVPs trickle in.
  useEffect(() => {
    if (!tenantId || games.length === 0) return;
    const nextScheduled = games
      .filter((g) => g.status === "scheduled")
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))[0];
    if (!nextScheduled) {
      setNextGameRsvps({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const snap = await getDocs(
          query(
            collection(db, `leagues/${tenantId}/availability`),
            where("game_id", "==", nextScheduled.id),
          ),
        );
        if (cancelled) return;
        const map: Record<string, "yes" | "maybe" | "no"> = {};
        for (const d of snap.docs) {
          const data = d.data();
          if (data.team_id !== teamId) continue;
          const status = String(data.status ?? "");
          if (status === "yes" || status === "maybe" || status === "no") {
            map[String(data.player_id ?? "")] = status;
          }
        }
        setNextGameRsvps(map);
      } catch {
        /* best effort — spotlight gracefully shows 0/0/0 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, teamId, games]);

  // ── Auto-link captain ↔ player record on first dashboard load ──
  // Calls /api/captain-link, which mirrors DVSL's
  // _backfillCaptainPlayerLink (captain.html lines 1990–2024) but
  // server-side because /players is admin-write only at the rules
  // level. The endpoint matches the captain's auth email against
  // players on their team and links uid/email when exactly one
  // unambiguous match exists. Fire-and-forget — failures don't
  // block the dashboard from loading.
  useEffect(() => {
    if (!tenantId || !user || !user.email) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        if (cancelled) return;
        await fetch("/api/captain-link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ leagueId: tenantId }),
        });
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, user]);

  // ── Auth gates ─────────────────────────────────────────────────
  if (!tenantId) {
    return (
      <main className="container py-16">
        <p>Captain portal is tenant-scoped. Visit a league subdomain.</p>
      </main>
    );
  }
  if (user === undefined || role === "loading" || teamLoading) {
    return <CaptainShell>Checking your access…</CaptainShell>;
  }
  if (user === null) {
    return (
      <CaptainShell>
        <div style={{ maxWidth: 460, textAlign: "center", margin: "0 auto" }}>
          <div aria-hidden style={{ fontSize: 48, marginBottom: 10 }}>
            ⚾
          </div>
          <h2
            style={{
              fontFamily: "var(--font-barlow), sans-serif",
              fontSize: 24,
              fontWeight: 800,
              color: "var(--text-strong)",
              margin: "0 0 8px",
            }}
          >
            Captain sign-in
          </h2>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 14,
              lineHeight: 1.6,
              margin: "0 0 22px",
            }}
          >
            Manage your roster, submit final scores, upload box-score
            scoresheets, and chat with your team. Sign in by email —
            no password.
          </p>
          <Link
            href="/login"
            className="le-cap-btn-primary"
            style={{
              display: "inline-block",
              padding: "12px 28px",
              background: "var(--brand-primary)",
              color: "white",
              borderRadius: 10,
              fontWeight: 800,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Sign in
          </Link>
        </div>
      </CaptainShell>
    );
  }
  if (role !== "captain" || !teamId) {
    return (
      <CaptainShell>
        <p>
          You're signed in as <strong>{user.email}</strong>, but you don't
          have captain access for{" "}
          <span className="font-mono">{tenantId}</span>. Ask the
          commissioner to grant you the captain claim for your team.
        </p>
      </CaptainShell>
    );
  }

  if (loading || !team) return <CaptainShell>Loading your team…</CaptainShell>;

  // ── Sort games into upcoming + recent ─────────────────────────
  const upcoming = games
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const recent = games
    .filter((g) => g.status === "final" || g.status === "approved")
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 6);
  const submittable = games.filter((g) => g.status === "scheduled");

  return (
    <main className="le-cap-shell">
      <CaptainHero team={team} email={user.email ?? ""} />
      <CaptainTabNav />
      <CaptainBody
        leagueId={tenantId}
        teamId={teamId}
        team={team}
        teamNames={teamNames}
        games={games}
        upcoming={upcoming}
        recent={recent}
        roster={roster}
        nextGameRsvps={nextGameRsvps}
      />
    </main>
  );
}

// Tab navigation strip. URL hash drives the active tab so links can
// deep-link into a specific tab (e.g. /captain#roster), and reloads
// preserve the captain's place. DVSL pattern (captain.html lines
// 808–820): a horizontal scroll-overflow strip of pill buttons.
//
// Notifications is its own tab here, NOT a punt-out to /profile#notif.
// Earlier we matched DVSL captain.html:810 (which DID punt). DVSL hit
// a real bug from that: captains felt yanked out of their dashboard
// mid-session (DVSL v271). DVSL fix: embed the panel in every role
// surface using a shared component. We use the same shared component
// (`NotificationsPanel`) as the /profile page does.
type Tab = { key: string; label: string };
const TABS: Tab[] = [
  { key: "team", label: "My Team" },
  { key: "roster", label: "Roster" },
  { key: "schedule", label: "Schedule" },
  { key: "scores", label: "Submit Score" },
  { key: "quickscore", label: "⚡ Quick Score" },
  { key: "payments", label: "Payments" },
  { key: "notifications", label: "🔔 Notifications" },
  { key: "attendance", label: "Attendance" },
  { key: "teamchat", label: "Team Chat" },
  { key: "captchat", label: "Captains Chat" },
  { key: "announcements", label: "Announcements" },
  { key: "help", label: "Help" },
];

function useCaptainTab(): [string, (k: string) => void] {
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "team";
    const h = window.location.hash.replace(/^#/, "");
    return TABS.some((t) => t.key === h) ? h : "team";
  });
  useEffect(() => {
    function onHash() {
      const h = window.location.hash.replace(/^#/, "");
      setTab(TABS.some((t) => t.key === h) ? h : "team");
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  function go(k: string) {
    window.location.hash = k;
    setTab(k);
  }
  return [tab, go];
}

function CaptainTabNav() {
  const [tab, go] = useCaptainTab();
  return (
    <nav className="cap-tab-nav">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          ref={(el) => {
            // Auto-scroll the active tab into view on phone where the
            // nav is one swipeable row. Without this, deep-linking to
            // (say) ?tab=captchat lands the user with the active tab
            // off-screen.
            if (el && tab === t.key) {
              el.scrollIntoView({
                behavior: "smooth",
                inline: "center",
                block: "nearest",
              });
            }
          }}
          className={"cap-tab-item" + (tab === t.key ? " active" : "")}
          onClick={() => go(t.key)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function CaptainBody({
  leagueId,
  teamId,
  team,
  teamNames,
  games,
  upcoming,
  recent,
  roster,
  nextGameRsvps,
}: {
  leagueId: string;
  teamId: string;
  team: TeamSnap;
  teamNames: Record<string, string>;
  games: GameSnap[];
  upcoming: GameSnap[];
  recent: GameSnap[];
  roster: PlayerSnap[];
  nextGameRsvps: Record<string, "yes" | "maybe" | "no">;
}) {
  const [tab] = useCaptainTab();

  if (tab === "roster")
    return <RosterTab leagueId={leagueId} teamId={teamId} />;
  if (tab === "schedule")
    return <ScheduleTab leagueId={leagueId} teamId={teamId} />;
  if (tab === "payments")
    return <PaymentsTab leagueId={leagueId} teamId={teamId} />;
  if (tab === "attendance")
    return <AttendanceTab leagueId={leagueId} teamId={teamId} />;
  if (tab === "teamchat")
    return <TeamChatTab leagueId={leagueId} teamId={teamId} />;
  if (tab === "captchat")
    return <CaptainsChatTab leagueId={leagueId} teamId={teamId} />;
  if (tab === "notifications")
    return <NotificationsPanel leagueId={leagueId} />;
  if (tab === "help") return <HelpTab />;
  if (tab === "quickscore") {
    return (
      <QuickScoreTab
        leagueId={leagueId}
        teamId={teamId}
        teamNamesById={teamNames}
      />
    );
  }
  if (tab === "scores") {
    return (
      <div className="cap-tab">
        <div className="cap-section-head">
          <h2 className="cap-section-title">Submit Score</h2>
          <p className="cap-section-sub">
            Click any game below to enter the full box score (lineup +
            stats). For just the final score, use{" "}
            <a
              href="#quickscore"
              style={{ color: "var(--brand-primary)", fontWeight: 600 }}
            >
              ⚡ Quick Score
            </a>{" "}
            instead. Both captains can submit; admin reconciles.
          </p>
        </div>
        <ul className="le-cap-game-list">
          {upcoming.concat(recent).map((g) => (
            <CaptainGameRow
              key={g.id}
              game={g}
              myTeamId={teamId}
              primary={{
                label: "Box Score",
                href: `/captain/box-score?game=${g.id}`,
              }}
              secondary={{
                label: "📡 Score Live",
                href: `/score/${g.id}`,
              }}
            />
          ))}
        </ul>
      </div>
    );
  }
  if (tab === "announcements") {
    return (
      <div className="cap-tab">
        <div className="cap-section-head">
          <h2 className="cap-section-title">
            {TABS.find((t) => t.key === tab)?.label}
          </h2>
          <p className="cap-section-sub">Coming soon.</p>
        </div>
      </div>
    );
  }

  // Default landing tab — "My Team" dashboard. Layout:
  //   1. Stat strip (record, division, # players, # games left)
  //   2. Next-game spotlight card (if scheduled): opponent, when,
  //      where, RSVP summary, action buttons
  //   3. Two-column body: recent games (left) + roster (right)
  //
  // Computes record + division-position-style stats from existing
  // state — no new fetches beyond what page mount + nextGameRsvps
  // already populated.
  const stats = computeTeamStats(recent, teamId);
  const nextGame = upcoming[0] ?? null;

  // Past games where my team played but the score isn't final yet.
  // DVSL §9 — surface the #1 captain support question ("where do I
  // submit my final score?") with a prominent CTA section above
  // everything else on the dashboard.
  const awaitingScore = awaitingScoreGames(games, teamId);

  return (
    <>
      <FirstTimeWelcome teamName={team.name} />
      <CaptainStatStrip
        record={stats.record}
        upcomingCount={upcoming.length}
        recentCount={recent.length}
        playerCount={roster.length}
        division={team.division}
      />

      {awaitingScore.length > 0 && (
        <AwaitingScoreCard
          entries={awaitingScore}
          teamNames={teamNames}
          myTeamId={teamId}
        />
      )}

      {nextGame && isGameToday(nextGame) && (
        <GameDayHero
          game={nextGame}
          myTeamId={teamId}
          teamNames={teamNames}
          rsvps={nextGameRsvps}
          rosterCount={roster.length}
        />
      )}

      {nextGame && !isGameToday(nextGame) && (
        <NextGameSpotlight
          game={nextGame}
          myTeamId={teamId}
          teamNames={teamNames}
          rosterCount={roster.length}
          rsvps={nextGameRsvps}
        />
      )}

      <section className="le-cap-grid">
        <div>
          {recent.length > 0 && (
            <>
              <h2 className="le-cap-section-title">Recent Games</h2>
              <ul className="le-cap-game-list">
                {recent.map((g) => (
                  <CaptainGameRow
                    key={g.id}
                    game={g}
                    myTeamId={teamId}
                    teamNames={teamNames}
                    primary={{
                      label: "Box Score",
                      href: `/captain/box-score?game=${g.id}`,
                    }}
                  />
                ))}
              </ul>
            </>
          )}
          {recent.length === 0 && upcoming.length > 1 && (
            <>
              <h2 className="le-cap-section-title">Upcoming Games</h2>
              <ul className="le-cap-game-list">
                {upcoming.slice(1, 5).map((g) => (
                  <CaptainGameRow
                    key={g.id}
                    game={g}
                    myTeamId={teamId}
                    teamNames={teamNames}
                    primary={{
                      label: "Box Score",
                      href: `/captain/box-score?game=${g.id}`,
                    }}
                  />
                ))}
              </ul>
            </>
          )}
          {recent.length === 0 && upcoming.length <= 1 && !nextGame && (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              No games on the schedule yet. The commissioner imports
              the season schedule from the admin panel.
            </p>
          )}
          {recent.length > 0 && upcoming.length > 1 && (
            <>
              <h2
                className="le-cap-section-title"
                style={{ marginTop: 28 }}
              >
                Upcoming Games
              </h2>
              <ul className="le-cap-game-list">
                {upcoming.slice(1, 5).map((g) => (
                  <CaptainGameRow
                    key={g.id}
                    game={g}
                    myTeamId={teamId}
                    teamNames={teamNames}
                    primary={{
                      label: "Box Score",
                      href: `/captain/box-score?game=${g.id}`,
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        <aside>
          <h2 className="le-cap-section-title">Roster</h2>
          {roster.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              No players on roster yet —{" "}
              <Link href="/captain#roster" style={{ textDecoration: "underline" }}>
                add some
              </Link>
              .
            </p>
          ) : (
            <ul className="le-cap-roster">
              {roster.slice(0, 12).map((p) => (
                <li key={p.id} className="le-cap-roster-row">
                  <span className="le-cap-roster-num">
                    #{p.jersey ?? "—"}
                  </span>
                  <Link
                    href={`/players/${p.id}`}
                    className="le-cap-roster-name"
                  >
                    {p.name}
                  </Link>
                  <span className="le-cap-roster-pos">
                    {p.position ?? ""}
                  </span>
                </li>
              ))}
              {roster.length > 12 && (
                <li
                  className="le-cap-roster-row"
                  style={{ justifyContent: "center" }}
                >
                  <Link
                    href="/captain#roster"
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      textDecoration: "underline",
                    }}
                  >
                    +{roster.length - 12} more · view full roster
                  </Link>
                </li>
              )}
            </ul>
          )}
        </aside>
      </section>
    </>
  );
}

interface TeamRecord {
  w: number;
  l: number;
  t: number;
}

function computeTeamStats(
  recent: GameSnap[],
  myTeamId: string,
): { record: TeamRecord } {
  let w = 0,
    l = 0,
    t = 0;
  for (const g of recent) {
    const isHome = g.home_team_id === myTeamId;
    const my = isHome ? g.home_score : g.away_score;
    const opp = isHome ? g.away_score : g.home_score;
    if (my > opp) w++;
    else if (my < opp) l++;
    else t++;
  }
  return { record: { w, l, t } };
}

function CaptainStatStrip({
  record,
  upcomingCount,
  recentCount,
  playerCount,
  division,
}: {
  record: TeamRecord;
  upcomingCount: number;
  recentCount: number;
  playerCount: number;
  division: string | undefined;
}) {
  const recordStr =
    record.t > 0
      ? `${record.w}-${record.l}-${record.t}`
      : `${record.w}-${record.l}`;
  return (
    <section className="cap-stat-strip">
      <div className="cap-stat-cell">
        <span className="cap-stat-num">{recordStr}</span>
        <span className="cap-stat-label">Record</span>
      </div>
      {division && (
        <div className="cap-stat-cell">
          <span className="cap-stat-num cap-stat-num-sm">{division}</span>
          <span className="cap-stat-label">Division</span>
        </div>
      )}
      <div className="cap-stat-cell">
        <span className="cap-stat-num">{upcomingCount}</span>
        <span className="cap-stat-label">
          Upcoming game{upcomingCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="cap-stat-cell">
        <span className="cap-stat-num">{recentCount}</span>
        <span className="cap-stat-label">
          Result{recentCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="cap-stat-cell">
        <span className="cap-stat-num">{playerCount}</span>
        <span className="cap-stat-label">
          Player{playerCount === 1 ? "" : "s"}
        </span>
      </div>
    </section>
  );
}

// "Awaiting your score" CTA card. Renders ONLY when the captain has
// past games that haven't been finaled yet. DVSL §9 — top tap target,
// answers the "where do I submit my score?" question on first glance.
function AwaitingScoreCard({
  entries,
  teamNames,
  myTeamId,
}: {
  entries: Array<{
    game: {
      id: string;
      date: string | null;
      away_team_id: string;
      home_team_id: string;
    };
    side: "home" | "away";
  }>;
  teamNames: Record<string, string>;
  myTeamId: string;
}) {
  return (
    <section
      className="le-cap-awaiting"
      style={{
        background: "rgba(245, 158, 11, 0.08)", // accent-warm wash
        border: "2px solid var(--brand-accent, #f59e0b)",
        borderRadius: 12,
        padding: "16px 18px",
        margin: "16px 0 20px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--brand-primary)",
        }}
      >
        <span aria-hidden="true">⚾</span>
        Submit your score
        {entries.length > 1 ? (
          <span
            style={{
              background: "var(--brand-accent, #f59e0b)",
              color: "white",
              padding: "1px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {entries.length}
          </span>
        ) : null}
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {entries.map(({ game, side }) => {
          const opponentId =
            side === "away" ? game.home_team_id : game.away_team_id;
          const opponentName = teamNames[opponentId] ?? opponentId;
          const dateLabel = game.date
            ? formatGameDate(game.date)
            : "(no date)";
          return (
            <li
              key={game.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderTop: "1px solid rgba(0,0,0,0.06)",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    color: "var(--text-strong)",
                    fontSize: 16,
                  }}
                >
                  {side === "away" ? "@ " : "vs "}
                  {opponentName}
                </div>
                <div
                  style={{
                    color: "var(--muted)",
                    fontSize: 13,
                    marginTop: 2,
                  }}
                >
                  {dateLabel}
                </div>
              </div>
              <Link
                href={`/captain/box-score?game=${game.id}`}
                style={{
                  background: "var(--brand-primary)",
                  color: "white",
                  padding: "10px 18px",
                  borderRadius: 8,
                  textDecoration: "none",
                  fontWeight: 700,
                  fontSize: 14,
                  whiteSpace: "nowrap",
                }}
              >
                Submit Score →
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatGameDate(s: string): string {
  try {
    const d = s.includes("T") ? new Date(s) : new Date(`${s}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return s;
  }
}

function NextGameSpotlight({
  game,
  myTeamId,
  teamNames,
  rosterCount,
  rsvps,
}: {
  game: GameSnap;
  myTeamId: string;
  teamNames: Record<string, string>;
  rosterCount: number;
  rsvps: Record<string, "yes" | "maybe" | "no">;
}) {
  const isHome = game.home_team_id === myTeamId;
  const oppId = isHome ? game.away_team_id : game.home_team_id;
  const oppName = teamNames[oppId] ?? oppId;

  // Date/time + days-until calculation. Guard against bad date.
  let when = "TBD";
  let timeLabel = "";
  let daysUntil: number | null = null;
  if (game.date) {
    const d = new Date(game.date);
    if (Number.isFinite(d.getTime())) {
      when = d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      timeLabel = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      const ms = d.getTime() - Date.now();
      daysUntil = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    }
  }

  // RSVP totals.
  const yes = Object.values(rsvps).filter((s) => s === "yes").length;
  const maybe = Object.values(rsvps).filter((s) => s === "maybe").length;
  const no = Object.values(rsvps).filter((s) => s === "no").length;
  const responded = yes + maybe + no;
  const waiting = Math.max(0, rosterCount - responded);

  return (
    <section className="cap-next-game">
      <div className="cap-next-game-head">
        <span className="cap-next-game-eyebrow">
          Next game
          {daysUntil != null
            ? daysUntil === 0
              ? " · today"
              : daysUntil === 1
                ? " · tomorrow"
                : ` · in ${daysUntil} days`
            : ""}
        </span>
        <h2 className="cap-next-game-title">
          {isHome ? "vs" : "@"} {oppName}
        </h2>
        <p className="cap-next-game-sub">
          {when}
          {timeLabel ? ` · ${timeLabel}` : ""}
          {game.field ? ` · ${game.field}` : ""}
        </p>
      </div>

      {rosterCount > 0 && (
        <div className="cap-next-game-rsvp">
          <RsvpStat label="Yes" count={yes} cls="yes" />
          <RsvpStat label="Maybe" count={maybe} cls="maybe" />
          <RsvpStat label="No" count={no} cls="no" />
          <RsvpStat label="Waiting" count={waiting} cls="waiting" />
        </div>
      )}

      <div className="cap-next-game-actions">
        <Link
          href="/captain#attendance"
          className="le-cap-btn-secondary"
        >
          📋 Attendance
        </Link>
        <Link
          href={`/captain/box-score?game=${game.id}`}
          className="le-cap-btn-primary"
        >
          ⚾ Submit Score
        </Link>
      </div>
    </section>
  );
}

function RsvpStat({
  label,
  count,
  cls,
}: {
  label: string;
  count: number;
  cls: "yes" | "maybe" | "no" | "waiting";
}) {
  return (
    <div className={"cap-rsvp-stat cap-rsvp-stat-" + cls}>
      <span className="cap-rsvp-stat-num">{count}</span>
      <span className="cap-rsvp-stat-label">{label}</span>
    </div>
  );
}

function CaptainShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="container py-16">
      <h1
        className="font-barlow"
        style={{
          fontSize: 36,
          fontWeight: 900,
          textTransform: "uppercase",
          marginBottom: 18,
        }}
      >
        Captain Portal
      </h1>
      {children}
    </main>
  );
}

function CaptainHero({ team, email }: { team: TeamSnap; email: string }) {
  return (
    <section
      className="le-cap-hero"
      style={{
        background: `linear-gradient(135deg, ${team.color ?? "var(--brand-primary)"} 0%, #0a0e1c 80%)`,
      }}
    >
      <div className="le-cap-hero-inner">
        <p className="le-cap-eyebrow">Captain Portal</p>
        <div className="le-cap-hero-row">
          <div className="le-cap-hero-logo">
            {team.logoUrl ? (
              <img src={team.logoUrl} alt="" />
            ) : (
              <span className="le-cap-hero-initials">
                {(team.abbrev ?? team.name.slice(0, 3)).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            {team.division && (
              <p className="le-cap-eyebrow le-cap-division">{team.division}</p>
            )}
            <h1 className="le-cap-team-name">{team.name}</h1>
            <p className="le-cap-greeting">Signed in as {email}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CaptainGameRow({
  game,
  myTeamId,
  teamNames,
  primary,
  secondary,
}: {
  game: GameSnap;
  myTeamId: string;
  teamNames?: Record<string, string>;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  const isHome = game.home_team_id === myTeamId;
  const opponentId = isHome ? game.away_team_id : game.home_team_id;
  const opponentName = teamNames?.[opponentId] ?? opponentId.toUpperCase();
  const myScore = isHome ? game.home_score : game.away_score;
  const oppScore = isHome ? game.away_score : game.home_score;
  const isFinal = game.status === "final" || game.status === "approved";
  const won = isFinal && myScore > oppScore;
  const lost = isFinal && myScore < oppScore;
  const dateLabel = game.date
    ? new Date(game.date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "TBD";
  const timeLabel = game.date
    ? new Date(game.date).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <li className="le-cap-game-row">
      <div className="le-cap-game-meta">
        <span className="le-cap-game-when">
          {dateLabel}
          {timeLabel ? ` · ${timeLabel}` : ""}
          {game.field ? ` · ${game.field}` : ""}
        </span>
        <span className="le-cap-game-vs">
          {isHome ? "vs" : "@"} {opponentName}
        </span>
      </div>
      {isFinal && (
        <span
          className={
            "le-cap-game-result " +
            (won ? "won" : lost ? "lost" : "tied")
          }
        >
          {won ? "W" : lost ? "L" : "T"} {myScore}–{oppScore}
        </span>
      )}
      <div className="le-cap-game-actions">
        <Link href={primary.href} className="le-cap-btn-primary">
          {primary.label}
        </Link>
        {secondary && (
          <Link href={secondary.href} className="le-cap-btn-secondary">
            {secondary.label}
          </Link>
        )}
      </div>
    </li>
  );
}

// ── Game Day Hero ──────────────────────────────────────────────────
// Replaces NextGameSpotlight when the next game is today. Big banner
// with the matchup, three large action buttons (Score Live · Submit
// Lineup · Submit Box Score), and an RSVP summary.
//
// Why a separate component vs styling NextGameSpotlight differently:
// the day-of UX is opinionated — captain wants one-tap-to-action,
// not a marketing spotlight. Different component, different
// affordances.

function isGameToday(game: GameSnap): boolean {
  if (!game.date) return false;
  const d = new Date(game.date);
  if (!Number.isFinite(d.getTime())) return false;
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function GameDayHero({
  game,
  myTeamId,
  teamNames,
  rsvps,
  rosterCount,
}: {
  game: GameSnap;
  myTeamId: string;
  teamNames: Record<string, string>;
  rsvps: Record<string, "yes" | "maybe" | "no">;
  rosterCount: number;
}) {
  const isHome = game.home_team_id === myTeamId;
  const oppId = isHome ? game.away_team_id : game.home_team_id;
  const oppName = teamNames[oppId] ?? oppId;

  let timeLabel = "TBD";
  if (game.date) {
    const d = new Date(game.date);
    if (Number.isFinite(d.getTime())) {
      timeLabel = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }
  }

  const yes = Object.values(rsvps).filter((s) => s === "yes").length;
  const maybe = Object.values(rsvps).filter((s) => s === "maybe").length;
  const no = Object.values(rsvps).filter((s) => s === "no").length;
  const waiting = Math.max(0, rosterCount - yes - maybe - no);

  return (
    <section className="cap-gameday">
      <header className="cap-gameday-head">
        <span className="cap-gameday-pulse" aria-hidden />
        <span className="cap-gameday-eyebrow">Today · Game Day</span>
        <h2 className="cap-gameday-matchup">
          {isHome ? "vs" : "@"} {oppName}
        </h2>
        <p className="cap-gameday-meta">
          <strong>{timeLabel}</strong>
          {game.field ? <> · {game.field}</> : null}
        </p>
      </header>

      <div className="cap-gameday-rsvp">
        <span>
          <strong>{yes}</strong> in
        </span>
        <span>
          <strong>{maybe}</strong> maybe
        </span>
        <span>
          <strong>{no}</strong> out
        </span>
        {waiting > 0 && (
          <span className="cap-gameday-waiting">
            <strong>{waiting}</strong> haven't responded
          </span>
        )}
      </div>

      <div className="cap-gameday-actions">
        <Link
          href={`/score/${game.id}`}
          className="cap-gameday-btn cap-gameday-btn-primary"
        >
          📡 Score Live
        </Link>
        <Link
          href={`/captain/lineup?game=${game.id}`}
          className="cap-gameday-btn cap-gameday-btn-secondary"
        >
          📋 Submit Lineup
        </Link>
        <Link
          href={`/captain/box-score?game=${game.id}`}
          className="cap-gameday-btn cap-gameday-btn-secondary"
        >
          ✏ Box Score
        </Link>
      </div>
      <style jsx>{`
        .cap-gameday {
          margin: 16px 0 24px;
          padding: 24px;
          border-radius: 16px;
          background: linear-gradient(
            135deg,
            var(--brand-primary, #002d72) 0%,
            #0c1322 100%
          );
          color: white;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
          position: relative;
          overflow: hidden;
        }
        .cap-gameday::before {
          content: "";
          position: absolute;
          right: -40px;
          top: -40px;
          width: 200px;
          height: 200px;
          background: radial-gradient(
            circle,
            rgba(239, 68, 68, 0.18) 0%,
            transparent 70%
          );
          pointer-events: none;
        }
        .cap-gameday-head {
          position: relative;
        }
        .cap-gameday-pulse {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ef4444;
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.25);
          margin-right: 8px;
          vertical-align: middle;
          animation: capPulse 1.6s ease-in-out infinite;
        }
        @keyframes capPulse {
          0%,
          100% {
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.25);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.05);
          }
        }
        .cap-gameday-eyebrow {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.2em;
          color: #fca5a5;
          text-transform: uppercase;
          vertical-align: middle;
        }
        .cap-gameday-matchup {
          font-family: var(--font-barlow, "Barlow Condensed"), sans-serif;
          font-size: clamp(36px, 6vw, 56px);
          font-weight: 900;
          line-height: 1;
          margin: 12px 0 6px;
          letter-spacing: -0.01em;
        }
        .cap-gameday-meta {
          color: rgba(255, 255, 255, 0.85);
          font-size: 16px;
          margin: 0 0 18px;
        }
        .cap-gameday-meta strong {
          color: white;
          font-weight: 700;
        }
        .cap-gameday-rsvp {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.85);
          margin-bottom: 18px;
        }
        .cap-gameday-rsvp strong {
          color: white;
          font-weight: 700;
          font-size: 15px;
        }
        .cap-gameday-waiting {
          color: #fde68a;
          margin-left: auto;
        }
        .cap-gameday-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .cap-gameday-btn {
          flex: 1;
          min-width: 160px;
          padding: 14px 20px;
          border-radius: 10px;
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 0.04em;
          text-decoration: none;
          text-align: center;
          transition: filter 0.15s, transform 0.05s;
        }
        .cap-gameday-btn:active {
          transform: scale(0.98);
        }
        .cap-gameday-btn-primary {
          background: #ef4444;
          color: white;
        }
        .cap-gameday-btn-primary:hover {
          filter: brightness(1.1);
        }
        .cap-gameday-btn-secondary {
          background: rgba(255, 255, 255, 0.12);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .cap-gameday-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
    </section>
  );
}
