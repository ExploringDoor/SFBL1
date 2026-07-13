"use client";

// Admin UI for granting/revoking role claims. Eliminates the
// `npm run grant-claim` ssh-and-script ritual during onboarding.
//
// Three flows on one page:
//   1. Grant captain — pick a team from the dropdown, enter the
//      captain's email, hit Grant. Most common operation during
//      onboarding (8-15 captains per league).
//   2. Grant admin — enter email, hit Grant. For commissioners /
//      co-admins.
//   3. Remove claim — enter email, hit Remove. For mid-season
//      handoffs (captain steps down, etc.).
//
// Caveat surfaced in the result toast: claims propagate on the next
// ID-token refresh (~1 hour cache). Tell users to sign out + back in
// if they need it immediately.

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";

interface TeamOpt {
  id: string;
  name: string;
}

interface PlayerOpt {
  id: string;
  team_id: string;
  name: string;
  jersey: string;
  email: string;
}

interface Result {
  ok: boolean;
  message: string;
}

interface Props {
  leagueId: string;
  user: User;
}

export function CaptainClaimsManager({ leagueId, user }: Props) {
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [players, setPlayers] = useState<PlayerOpt[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state — one shared input pair, three submit handlers.
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [pickedPlayerId, setPickedPlayerId] = useState("");
  const [busy, setBusy] = useState<null | "captain" | "admin" | "remove">(
    null,
  );
  const [result, setResult] = useState<Result | null>(null);
  const { config } = useTenant();
  const captain = captainNoun(config);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      // Teams from public Firestore; player contacts via admin API
      // (post-PII migration, email/phone live in /_private/contact
      // and aren't client-readable directly).
      const idToken = await user.getIdToken();
      const [teamSnap, contactsRes] = await Promise.all([
        getDocs(collection(db, `leagues/${leagueId}/teams`)),
        fetch(
          `/api/admin-contacts?leagueId=${encodeURIComponent(leagueId)}`,
          { headers: { authorization: `Bearer ${idToken}` } },
        ),
      ]);
      if (cancelled) return;
      setTeams(
        teamSnap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      const contactsBody = (await contactsRes.json().catch(() => ({}))) as {
        players?: PlayerOpt[];
      };
      setPlayers(contactsBody.players ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, user]);

  // Roster for the currently-selected team — what populates the
  // "Pick a player" dropdown. Sort by jersey, then name.
  const teamRoster = useMemo(() => {
    if (!teamId) return [];
    return players
      .filter((p) => p.team_id === teamId)
      .sort((a, b) => {
        const aj = parseInt(a.jersey || "999", 10);
        const bj = parseInt(b.jersey || "999", 10);
        if (!Number.isNaN(aj) && !Number.isNaN(bj) && aj !== bj) return aj - bj;
        return a.name.localeCompare(b.name);
      });
  }, [players, teamId]);

  function pickPlayer(playerId: string) {
    setPickedPlayerId(playerId);
    if (!playerId) return;
    const p = players.find((x) => x.id === playerId);
    if (p?.email) {
      // Auto-fill email when the player has one on file. If they
      // don't, leave the field as-is so admin can type it.
      setEmail(p.email);
    }
  }

  // Reset player pick when team changes — a player from team A
  // shouldn't be lingering when admin switches to team B.
  function changeTeam(nextTeamId: string) {
    setTeamId(nextTeamId);
    setPickedPlayerId("");
  }

  async function call(
    role: "admin" | "captain" | "remove",
  ): Promise<void> {
    if (!email.trim()) {
      setResult({ ok: false, message: "Email is required" });
      return;
    }
    if (role === "captain" && !teamId) {
      setResult({ ok: false, message: `Pick a team for ${captain} grants` });
      return;
    }
    setBusy(role);
    setResult(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-grant-claim", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          leagueId,
          email: email.trim().toLowerCase(),
          role,
          ...(role === "captain" ? { teamId } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        note?: string;
      };
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const teamLabel =
        role === "captain"
          ? ` (${teams.find((t) => t.id === teamId)?.name ?? teamId})`
          : "";
      setResult({
        ok: true,
        message:
          role === "remove"
            ? `Removed all roles for ${email}.`
            : `Granted ${role === "captain" ? captain : role}${teamLabel} to ${email}. ${data.note ?? ""}`,
      });
      // Reset on successful grant so a flurry of captain grants is
      // fast — clear email + picked player, keep teamId so admin can
      // quickly add another captain to the same team or pick a new
      // team.
      if (res.ok) {
        setEmail("");
        setPickedPlayerId("");
      }
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <p className="font-semibold text-slate-900">{captain} &amp; admin claims</p>
      <p className="text-xs text-slate-600 leading-relaxed">
        Grant {captain} access to one of your teams, grant another admin,
        or remove someone's role. The user must have signed in via magic
        link at least once before you can grant them a role.
      </p>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700 mb-1">
          Team (for {captain} grants)
        </span>
        <select
          value={teamId}
          onChange={(e) => changeTeam(e.target.value)}
          disabled={busy !== null || loading}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— select team —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>

      {teamId && teamRoster.length > 0 && (
        <label className="block">
          <span className="block text-xs font-semibold text-slate-700 mb-1">
            Pick the {captain}
          </span>
          <select
            value={pickedPlayerId}
            onChange={(e) => pickPlayer(e.target.value)}
            disabled={busy !== null}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— pick a player —</option>
            {teamRoster.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jersey ? `#${p.jersey} ` : ""}
                {p.name}
                {p.email ? ` · ${p.email}` : " · ⚠ no email on file"}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Email field: auto-filled from the picked player. We hide
          the visible input when the player has an email — admin
          shouldn't need to retype it. The field surfaces only when
          (a) no player is picked yet (free-form email entry for
          someone not on the roster), or (b) the picked player has
          no email on file (admin needs to type one to enable sign-in). */}
      {(() => {
        const picked = players.find((x) => x.id === pickedPlayerId);
        const showEmailInput =
          !pickedPlayerId || (picked && !picked.email);
        if (!showEmailInput) {
          return (
            <p className="text-xs text-slate-600 rounded bg-slate-50 px-3 py-2 border border-slate-200">
              Will grant {captain} access to{" "}
              <span className="font-semibold">{picked?.name}</span> using{" "}
              <span className="font-mono">{email}</span>.
            </p>
          );
        }
        return (
          <label className="block">
            <span className="block text-xs font-semibold text-slate-700 mb-1">
              {pickedPlayerId
                ? `Email for ${picked?.name} (none on file yet)`
                : "Email (for someone not on the roster)"}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder="captain@example.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              disabled={busy !== null}
              autoComplete="email"
            />
            <span className="block text-xs text-slate-500 mt-1">
              They'll sign in with this email via magic link. Stored on
              their player profile too.
            </span>
          </label>
        );
      })()}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => call("captain")}
          disabled={busy !== null || !email.trim() || !teamId}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "captain" ? "Granting…" : `Grant ${captain}`}
        </button>
        <button
          onClick={() => call("admin")}
          disabled={busy !== null || !email.trim()}
          className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "admin" ? "Granting…" : "Grant admin"}
        </button>
        <button
          onClick={() => call("remove")}
          disabled={busy !== null || !email.trim()}
          className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {busy === "remove" ? "Removing…" : "Remove all roles"}
        </button>
      </div>

      {result && (
        <div
          className={
            "text-sm rounded-md px-3 py-2 " +
            (result.ok
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-800")
          }
        >
          {result.ok ? "✓ " : "✗ "}
          {result.message}
        </div>
      )}
    </section>
  );
}
