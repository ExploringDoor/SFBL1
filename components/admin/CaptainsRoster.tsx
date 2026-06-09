"use client";

// Admin "Captains" roster — one screen with every team's captain:
// contact on file, whether a team password is set, and last login.
// Adam wanted this instead of expanding team-by-team in the Teams tab
// (2026-05-18). Data comes from /api/admin-captains; editing a
// captain's contact reuses the <ManagerContact> card inline.

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ManagerContact } from "@/components/ManagerContact";

interface Captain {
  teamId: string;
  teamName: string;
  managers: { name: string; email: string }[];
  hasPassword: boolean;
  lastLogin: string;
}

function fmtLogin(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // Date + exact local time (Adam, 2026-05-18). Local tz = the admin's
  // browser, so Eastern for SFBL.
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CaptainsRoster({
  leagueId,
  user,
}: {
  leagueId: string;
  user: User;
}) {
  const [rows, setRows] = useState<Captain[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin-captains", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        captains?: Captain[];
        error?: string;
      };
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else setRows(data.captains ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  if (error)
    return (
      <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-700">{error}</p>
    );
  if (rows === null)
    return <p className="text-sm text-slate-500">Loading captains…</p>;

  const withEmail = rows.filter((r) =>
    r.managers.some((m) => m.email),
  ).length;
  const withPw = rows.filter((r) => r.hasPassword).length;
  const loggedIn = rows.filter((r) => r.lastLogin).length;

  const filtered = rows.filter((r) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      r.teamName.toLowerCase().includes(s) ||
      r.managers.some(
        (m) =>
          m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s),
      )
    );
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Every team&rsquo;s captain in one place — contact on file, whether a
        team password is set, and last login. Click a row to edit the contact.
        Passwords are set in the <strong>Teams</strong> tab.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Teams" value={String(rows.length)} />
        <Card label="Have email" value={`${withEmail}/${rows.length}`} />
        <Card label="Password set" value={`${withPw}/${rows.length}`} />
        <Card label="Logged in" value={`${loggedIn}/${rows.length}`} />
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search team, captain name, or email…"
        className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm"
      />

      <div className="overflow-hidden rounded-md border border-slate-200">
        {/* header (hidden on mobile) */}
        <div className="hidden bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid sm:grid-cols-[1.1fr_1.5fr_0.6fr_1.1fr]">
          <span>Team</span>
          <span>Captain · email</span>
          <span>Password</span>
          <span>Last login</span>
        </div>
        {filtered.map((r) => {
          const open = expanded === r.teamId;
          const primary = r.managers[0];
          const extra = r.managers.length - 1;
          return (
            <div key={r.teamId} className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : r.teamId)}
                className="grid w-full grid-cols-1 gap-1 px-3 py-2 text-left text-sm hover:bg-slate-50 sm:grid-cols-[1.1fr_1.5fr_0.6fr_1.1fr] sm:items-center sm:gap-0"
              >
                <span className="font-semibold text-slate-900">
                  {open ? "▾ " : "▸ "}
                  {r.teamName}
                </span>
                <span className="text-slate-600">
                  {primary ? (
                    <>
                      {primary.name || "(unnamed)"}
                      {primary.email ? (
                        <span className="text-slate-400"> · {primary.email}</span>
                      ) : (
                        <span className="text-amber-600"> · no email</span>
                      )}
                      {extra > 0 && (
                        <span className="text-slate-400"> +{extra}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-600">no contact on file</span>
                  )}
                </span>
                <span>
                  {r.hasPassword ? (
                    <span className="text-emerald-600">✓ set</span>
                  ) : (
                    <span className="text-slate-400">— none</span>
                  )}
                </span>
                <span
                  className={r.lastLogin ? "text-slate-600" : "text-slate-400"}
                >
                  {fmtLogin(r.lastLogin)}
                </span>
              </button>
              {open && (
                <div className="bg-slate-50/60 px-3 py-3">
                  <ManagerContact leagueId={leagueId} teamId={r.teamId} />
                  {!r.hasPassword && (
                    <p className="mt-2 text-xs text-amber-700">
                      No team password set yet — set one in the Teams tab so
                      this captain can log in.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-3 text-sm italic text-slate-500">
            No captains match &ldquo;{q}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}
