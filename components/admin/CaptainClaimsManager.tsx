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

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";

interface TeamOpt {
  id: string;
  name: string;
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
  const [loading, setLoading] = useState(true);

  // Form state — one shared input pair, three submit handlers.
  const [email, setEmail] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState<null | "captain" | "admin" | "remove">(
    null,
  );
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const snap = await getDocs(collection(db, `leagues/${leagueId}/teams`));
      if (cancelled) return;
      setTeams(
        snap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function call(
    role: "admin" | "captain" | "remove",
  ): Promise<void> {
    if (!email.trim()) {
      setResult({ ok: false, message: "Email is required" });
      return;
    }
    if (role === "captain" && !teamId) {
      setResult({ ok: false, message: "Pick a team for captain grants" });
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
            : `Granted ${role}${teamLabel} to ${email}. ${data.note ?? ""}`,
      });
      // Reset on successful grant so a flurry of captain grants is
      // fast — clear email but keep teamId so admin can quickly add
      // another captain to the same team or pick a new team.
      if (res.ok) setEmail("");
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
      <p className="font-semibold text-slate-900">Captain &amp; admin claims</p>
      <p className="text-xs text-slate-600 leading-relaxed">
        Grant captain access to one of your teams, grant another admin,
        or remove someone's role. The user must have signed in via magic
        link at least once before you can grant them a role.
      </p>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700 mb-1">
          Email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="captain@example.com"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          disabled={busy !== null}
          autoComplete="email"
        />
      </label>

      <label className="block">
        <span className="block text-xs font-semibold text-slate-700 mb-1">
          Team (for captain grants)
        </span>
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          disabled={busy !== null || loading}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— select team —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.id})
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => call("captain")}
          disabled={busy !== null || !email.trim() || !teamId}
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === "captain" ? "Granting…" : "Grant captain"}
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
