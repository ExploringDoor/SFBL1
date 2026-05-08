"use client";

// /print/contacts — admin-only contact sheet (name, email, phone,
// team) for printing or saving as PDF. The data flows through an
// authed API endpoint so an unauthenticated visitor sees the
// gate, not a half-rendered list of phone numbers.

import { useEffect, useState } from "react";
import { useTenant } from "@/lib/tenant-context";
import { useLeagueRole, useUser } from "@/lib/auth-client";
import "../print.css";
import { PrintToolbar } from "../PrintToolbar";

interface Team {
  id: string;
  name: string;
  division: string;
}

interface Player {
  id: string;
  team_id: string;
  name: string;
  jersey: string;
  position: string;
  email: string;
  phone: string;
}

export default function PrintContactsPage() {
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role !== "admin" || !tenantId || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const idToken = await user.getIdToken();
        const res = await fetch(
          `/api/admin-contacts?leagueId=${encodeURIComponent(tenantId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        );
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          teams?: Team[];
          players?: Player[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          setError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setTeams(data.teams ?? []);
        setPlayers(data.players ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, role, user]);

  if (!tenantId) {
    return (
      <div className="print-page">
        <p>No tenant. Visit on a tenant subdomain.</p>
      </div>
    );
  }

  if (user === undefined || role === "loading") {
    return (
      <div className="print-page">
        <p>Loading…</p>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="print-page">
        <p>
          You're not signed in. <a href="/login">Sign in</a> as an admin to
          view contacts.
        </p>
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="print-page">
        <p>Admin only. Your role on this league is {role}.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="print-page">
        <PrintToolbar />
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!teams || !players) {
    return (
      <div className="print-page">
        <p>Loading contacts…</p>
      </div>
    );
  }

  // Group players by team. Sort divisions, then teams within
  // division, then players by jersey.
  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const byTeam = new Map<string, Player[]>();
  for (const p of players) {
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, []);
    byTeam.get(p.team_id)!.push(p);
  }
  for (const list of byTeam.values()) {
    list.sort((a, b) => {
      const aj = parseInt(a.jersey || "999", 10);
      const bj = parseInt(b.jersey || "999", 10);
      if (!Number.isNaN(aj) && !Number.isNaN(bj) && aj !== bj) return aj - bj;
      return a.name.localeCompare(b.name);
    });
  }
  const sortedTeams = teams.slice().sort((a, b) => {
    if (a.division !== b.division) {
      const an = parseInt(a.division, 10);
      const bn = parseInt(b.division, 10);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) {
        return an - bn;
      }
      return a.division.localeCompare(b.division);
    }
    return a.name.localeCompare(b.name);
  });

  const totalWithEmail = players.filter((p) => p.email).length;
  const leagueName = config?.name ?? tenantId;

  return (
    <div className="print-page">
      <PrintToolbar />
      <header className="print-header">
        <div>
          <div className="print-title">{leagueName} Contacts</div>
          <div className="print-meta">
            {players.length} active players · {totalWithEmail} with email
          </div>
        </div>
        <div className="print-meta">
          Confidential · Printed {new Date().toLocaleDateString()}
        </div>
      </header>

      {sortedTeams.map((team) => {
        const list = byTeam.get(team.id) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={team.id} className="print-section">
            <h2 className="print-section-heading">
              {team.name}
              {team.division ? ` · ${team.division}` : ""}
            </h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Name</th>
                  <th style={{ width: 80 }}>Pos</th>
                  <th>Email</th>
                  <th style={{ width: 130 }}>Phone</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td className="print-num">{p.jersey || "—"}</td>
                    <td><strong>{p.name}</strong></td>
                    <td>{p.position || "—"}</td>
                    <td>{p.email || "—"}</td>
                    <td className="print-num">{p.phone || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
