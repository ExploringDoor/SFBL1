"use client";

import { useState } from "react";
import { signOut, useLeagueRole, useUser } from "@/lib/auth-client";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import { doc, setDoc } from "firebase/firestore";

export default function AdminPage() {
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);

  if (user === undefined || role === "loading") {
    return <Shell heading={config?.name ?? "Admin"}>Checking your access…</Shell>;
  }

  if (user === null) {
    return (
      <Shell heading={config?.name ?? "Admin"}>
        <p className="text-slate-700">You're not signed in.</p>
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
      <Shell heading="Admin">
        <p className="text-slate-700">
          Admin pages are tenant-scoped. Visit a tenant subdomain (e.g.{" "}
          <code className="rounded bg-slate-100 px-1">sfbl.localhost:3000</code>).
        </p>
      </Shell>
    );
  }

  if (role !== "admin") {
    return (
      <Shell heading={config?.name ?? "Admin"}>
        <SignedInHeader email={user.email} uid={user.uid} role={role} />
        <p className="text-slate-700">
          You're signed in but you don't have admin role for{" "}
          <span className="font-mono">{tenantId}</span>. Ask the league administrator,
          or run from your dev machine:
        </p>
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
          {(process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true"
            ? "npm run grant-claim:emulator -- "
            : "npm run grant-claim -- ") +
            `--email ${user.email ?? "<your-email>"} --league ${tenantId} --role admin`}
        </pre>
        <p className="text-xs text-slate-500">
          The token caches claims for ~1 hour. After granting, click "Refresh access"
          below to force a token reload.
        </p>
        <RefreshButton />
      </Shell>
    );
  }

  return (
    <Shell heading={config?.name ?? "Admin"}>
      <SignedInHeader email={user.email} uid={user.uid} role={role} />
      <AdminSmokeTest tenantId={tenantId} />
      <RecalcStatsButton tenantId={tenantId} />
    </Shell>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">{heading} — Admin</h1>
      <section className="space-y-4">{children}</section>
    </main>
  );
}

function SignedInHeader({
  email,
  uid,
  role,
}: {
  email: string | null;
  uid: string;
  role: string;
}) {
  return (
    <header className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs font-mono">
      <div>
        <span className="text-slate-500">email:</span>{" "}
        <span className="font-semibold">{email ?? "(none)"}</span>
      </div>
      <div>
        <span className="text-slate-500">uid:</span>{" "}
        <span className="font-semibold">{uid}</span>
      </div>
      <div>
        <span className="text-slate-500">role:</span>{" "}
        <span className="font-semibold">{role}</span>
      </div>
      <button
        onClick={() => signOut().then(() => (window.location.href = "/login"))}
        className="mt-2 rounded bg-slate-900 px-2 py-1 text-xs text-white"
      >
        Sign out
      </button>
    </header>
  );
}

function RefreshButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
    >
      Refresh access
    </button>
  );
}

function AdminSmokeTest({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "writing" }
    | { kind: "ok"; teamId: string }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function writeTeam() {
    const teamId = `team_smoke_${Date.now()}`;
    setStatus({ kind: "writing" });
    try {
      await setDoc(doc(getDb(), `leagues/${tenantId}/teams/${teamId}`), {
        name: "Smoke Test Team",
        created_via: "admin smoke test",
      });
      setStatus({ kind: "ok", teamId });
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : "Unknown error.",
      });
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <p className="font-semibold text-slate-900">Admin write smoke test</p>
      <p className="text-sm text-slate-600">
        Writes a single team doc to <code>/leagues/{tenantId}/teams/team_smoke_*</code>{" "}
        with your auth token. If the rule chain is wired correctly, this succeeds.
        If it doesn't, the error tells you what failed.
      </p>
      <button
        onClick={writeTeam}
        disabled={status.kind === "writing"}
        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {status.kind === "writing" ? "Writing…" : "Write test team"}
      </button>
      {status.kind === "ok" && (
        <p className="text-sm text-emerald-700">
          ✅ Wrote <span className="font-mono">{status.teamId}</span>.
        </p>
      )}
      {status.kind === "err" && (
        <p className="text-sm text-red-700">❌ {status.message}</p>
      )}
    </section>
  );
}

function RecalcStatsButton({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | {
        kind: "ok";
        result: {
          box_scores_read: number;
          players_aggregated: number;
          players_written: number;
          pitchers_written: number;
          duration_ms: number;
        };
      }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function run() {
    setStatus({ kind: "running" });
    try {
      // Get a fresh ID token; the API route verifies it server-side.
      const auth = (await import("firebase/auth")).getAuth(
        (await import("@/lib/firebase")).getFirebaseApp(),
      );
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in.");
      const token = await user.getIdToken();

      const res = await fetch("/api/recalc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId: tenantId }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const result = await res.json();
      setStatus({ kind: "ok", result });
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : "Unknown error.",
      });
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <p className="font-semibold text-slate-900">Recalc league stats</p>
      <p className="text-sm text-slate-600">
        Reads every final/approved box score under{" "}
        <code>/leagues/{tenantId}/box_scores</code>, aggregates per-player
        batting (and pitching for baseball), writes results to{" "}
        <code>/leagues/{tenantId}/players/&#123;pid&#125;.stats</code>. Skips
        players whose totals haven't changed (dirty-check).
      </p>
      <button
        onClick={run}
        disabled={status.kind === "running"}
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {status.kind === "running" ? "Recalculating…" : "Recalc league stats"}
      </button>
      {status.kind === "ok" && (
        <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
          {JSON.stringify(status.result, null, 2)}
        </pre>
      )}
      {status.kind === "err" && (
        <p className="text-sm text-red-700">❌ {status.message}</p>
      )}
    </section>
  );
}
