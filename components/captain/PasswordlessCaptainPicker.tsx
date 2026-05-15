"use client";

// Team picker for tenants with captain.passwordless = true (LBDC).
// Replaces the magic-link sign-in screen on the captain landing
// page. Loads the league's teams, lets the user pick one, then mints
// a Firebase custom token with the corresponding `captain:<team_id>`
// claim via /api/public-captain-claim. Once signed in, the existing
// captain portal renders normally — no API or hook changes needed.

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getDb } from "@/lib/firebase";

interface TeamOption {
  id: string;
  name: string;
}

export function PasswordlessCaptainPicker({
  leagueId,
}: {
  leagueId: string;
}) {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the team list for the dropdown. Public read — security
  // rules permit reading /teams for anyone.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDb();
        const snap = await getDocs(
          collection(db, `leagues/${leagueId}/teams`),
        );
        if (cancelled) return;
        const list: TeamOption[] = snap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name ?? d.id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setTeams(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function signIn() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public-captain-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leagueId, teamId: picked }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        customToken?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.customToken) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Sign in with the minted token. The existing useUser /
      // useCaptainTeam / useLeagueRole hooks pick up the new auth
      // state automatically — the captain portal re-renders into
      // the normal post-sign-in view.
      await signInWithCustomToken(getAuth(), data.customToken);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 460, margin: "0 auto", textAlign: "center" }}>
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
        Captain portal
      </h2>
      <p
        style={{
          color: "var(--muted)",
          fontSize: 14,
          lineHeight: 1.6,
          margin: "0 0 22px",
        }}
      >
        Pick your team to manage your roster, submit final scores,
        and chat with your players. No password required.
      </p>

      <div style={{ marginBottom: 14 }}>
        <select
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          disabled={loading || busy}
          style={{
            width: "100%",
            maxWidth: 360,
            padding: "12px 14px",
            border: "1px solid var(--border, rgba(0,0,0,0.15))",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 600,
            background: "white",
            color: "var(--text-strong)",
            cursor: loading || busy ? "wait" : "pointer",
          }}
        >
          <option value="">
            {loading ? "Loading teams…" : "— Choose your team —"}
          </option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={signIn}
        disabled={!picked || busy}
        className="le-cap-btn-primary"
        style={{
          padding: "12px 28px",
          background: "var(--brand-primary)",
          color: "white",
          borderRadius: 10,
          fontWeight: 800,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          fontSize: 14,
          border: "none",
          cursor: !picked || busy ? "not-allowed" : "pointer",
          opacity: !picked || busy ? 0.6 : 1,
        }}
      >
        {busy ? "Signing in…" : "Continue as captain"}
      </button>

      {error && (
        <p
          style={{
            marginTop: 14,
            padding: "8px 12px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </p>
      )}

      <p
        style={{
          marginTop: 22,
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.55,
        }}
      >
        Anyone on the league can pick a team and submit. If you need a
        password-protected captain account instead, ask the
        commissioner.
      </p>
    </div>
  );
}
