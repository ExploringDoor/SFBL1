"use client";

// Player signups review queue.
//
// Lists every player flagged as `walk_on: true` — i.e., added by a
// captain and awaiting admin verification. Each row gets Approve /
// Reject buttons. Approve sets walk_on:false (player counts as
// rostered). Reject sets active:false (soft-delete; preserves
// historical box scores if any).
//
// Why approval gate exists: captains can typo a name, double-add a
// player who's already on another team, or sneak in someone outside
// the league's age cutoff. Admin review keeps the roster trustworthy
// without blocking captains from updating mid-season.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface PendingPlayer {
  id: string;
  name: string;
  team_id: string;
  jersey: string;
  position: string;
  email: string;
  phone: string;
  created_at: string;
  created_by_uid: string;
}

interface TeamOpt {
  id: string;
  name: string;
}

interface Props {
  leagueId: string;
  user: User;
}

export function SignupsReview({ leagueId, user }: Props) {
  const [pending, setPending] = useState<PendingPlayer[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const db = getDb();
      // Teams from public Firestore; players + contacts via admin
      // API (PII lives on /_private/contact subdocs).
      const idToken = await user.getIdToken();
      const [teamSnap, contactsRes, walkOnSnap] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        fetch(
          `/api/admin-contacts?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        ),
        // We still need walk_on flag + created_at from public docs
        // (those aren't PII), so a parallel public read.
        getDocs(collection(db, `leagues/${leagueId}/players`)),
      ]);
      setTeams(
        teamSnap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      const contactsBody = (await contactsRes.json().catch(() => ({}))) as {
        players?: { id: string; email: string; phone: string }[];
      };
      const contactById = new Map(
        (contactsBody.players ?? []).map((p) => [p.id, p]),
      );
      setPending(
        walkOnSnap.docs
          .filter(
            (d) =>
              d.data().walk_on === true && d.data().active !== false,
          )
          .map((d) => {
            const data = d.data();
            const c = contactById.get(d.id);
            return {
              id: d.id,
              name: String(data.name ?? ""),
              team_id: String(data.team_id ?? ""),
              jersey: String(data.jersey ?? ""),
              position: String(data.position ?? ""),
              email: c?.email ?? "",
              phone: c?.phone ?? "",
              created_at: String(data.created_at ?? ""),
              created_by_uid: String(data.created_by_uid ?? ""),
            };
          })
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  async function review(playerId: string, action: "approve" | "reject") {
    setBusy(playerId + ":" + action);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-walkon-review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, playerId, action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const verb = action === "approve" ? "Approved" : "Rejected";
      setSuccess(`${verb} ${playerId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const teamName = (id: string) =>
    teams.find((t) => t.id === id)?.name ?? id;

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-semibold text-slate-900">Signups review</p>
          <p className="text-xs text-slate-600 mt-1">
            Players added by captains awaiting your verification. Approve to
            include them on the roster, reject to soft-delete.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded bg-red-50 px-2 py-1 border border-red-200">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-700 rounded bg-emerald-50 px-2 py-1 border border-emerald-200">
          {success}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          No pending signups. Captains haven't added any walk-ons yet, or
          you've already reviewed them all.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-md overflow-hidden">
          {pending.map((p) => (
            <li
              key={p.id}
              className="px-3 py-2 flex items-center gap-3 flex-wrap"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-semibold text-slate-900">
                  {p.jersey ? <span className="font-mono mr-2 text-slate-500">#{p.jersey}</span> : null}
                  {p.name}
                </div>
                <div className="text-xs text-slate-500">
                  {teamName(p.team_id)}
                  {p.position ? ` · ${p.position}` : ""}
                  {p.email ? ` · ${p.email}` : ""}
                  {" · "}added {fmtAgo(p.created_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => review(p.id, "approve")}
                disabled={busy != null}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy === p.id + ":approve" ? "…" : "✓ Approve"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Reject "${p.name}" from ${teamName(p.team_id)}? Player will be soft-deleted.`,
                    )
                  )
                    return;
                  review(p.id, "reject");
                }}
                disabled={busy != null}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {busy === p.id + ":reject" ? "…" : "✕ Reject"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function fmtAgo(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}
