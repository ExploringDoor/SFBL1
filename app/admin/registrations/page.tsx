"use client";

// Admin-only view of team registrations. Reuses the /admin auth gating
// (useUser + useLeagueRole). Fetches /api/registrations with the admin's
// ID token (the endpoint enforces the admin claim server-side).

import { useEffect, useState } from "react";
import { useLeagueRole, useUser } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";

interface Registration {
  id: string;
  status?: string;
  submitted_at?: string;
  season?: string;
  registration_type?: string;
  fee?: number;
  head_coach?: { name?: string; email?: string; phone?: string };
  team?: {
    name?: string;
    age_group?: string;
    estimated_players?: number;
    gamechanger_link?: string;
  };
}

export default function AdminRegistrationsPage() {
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const [rows, setRows] = useState<Registration[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || role !== "admin" || !tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/registrations?leagueId=${tenantId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as {
          ok?: boolean;
          registrations?: Registration[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) setError(json.error ?? "Failed to load registrations.");
        else setRows(json.registrations ?? []);
      } catch {
        if (!cancelled) setError("Network error loading registrations.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, role, tenantId]);

  const heading = `${config?.name ?? "League"} — Registrations`;

  if (user === undefined || role === "loading") {
    return <Shell heading={heading}>Checking your access…</Shell>;
  }
  if (user === null) {
    return (
      <Shell heading={heading}>
        <p className="text-slate-700">You&rsquo;re not signed in.</p>
        <a
          href="/login"
          className="inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          Go to sign-in
        </a>
      </Shell>
    );
  }
  if (!tenantId) {
    return (
      <Shell heading="Registrations">
        <p className="text-slate-700">Visit a tenant subdomain.</p>
      </Shell>
    );
  }
  if (role !== "admin") {
    return (
      <Shell heading={heading}>
        <p className="text-slate-700">
          You&rsquo;re signed in but don&rsquo;t have admin role for{" "}
          <span className="font-mono">{tenantId}</span>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell heading={heading}>
      {error && <p className="text-sm text-red-700">❌ {error}</p>}
      {!error && rows === null && <p className="text-slate-600">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="text-slate-600">No registrations yet.</p>
      )}
      {rows && rows.length > 0 && (
        <>
          <p className="text-sm text-slate-600">
            {rows.length} registration{rows.length === 1 ? "" : "s"}
          </p>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Age</th>
                  <th className="px-3 py-2">Coach</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Fee</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-semibold">
                      {r.team?.name ?? "—"}
                      {r.team?.gamechanger_link && (
                        <a
                          href={r.team.gamechanger_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-xs font-normal text-blue-600 underline"
                        >
                          GameChanger ↗
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.team?.age_group ?? "—"}</td>
                    <td className="px-3 py-2">{r.head_coach?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">
                      <div>{r.head_coach?.email ?? "—"}</div>
                      <div>{r.head_coach?.phone ?? ""}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.registration_type === "with_insurance"
                        ? "w/ insurance"
                        : r.registration_type === "without_insurance"
                          ? "no insurance"
                          : "—"}
                    </td>
                    <td className="px-3 py-2">{r.fee != null ? `$${r.fee}` : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {r.status ?? "pending"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.submitted_at ? r.submitted_at.slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
      <section className="space-y-4">{children}</section>
    </main>
  );
}
