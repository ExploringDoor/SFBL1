"use client";

// Two-step captain landing for tenants with captain.passwordless=true.
//   Step 1 — team grid: card per team in the league
//   Step 2 — password gate: text input for the picked team
// On submit the client POSTs {leagueId, teamId, teamPassword} to
// /api/public-captain-claim which validates that the password
// matches the SPECIFIC team (its captain_password field, falling
// back to the team's name / id / abbrev / first word). On success
// the response carries a Firebase custom token; client signs in
// via signInWithCustomToken and the existing captain portal takes
// over.

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { getAuth, signInWithCustomToken } from "firebase/auth";
import { getDb } from "@/lib/firebase";

interface TeamOption {
  id: string;
  name: string;
  color?: string;
  logoUrl?: string | null;
}

export function PasswordlessCaptainPicker({
  leagueId,
}: {
  leagueId: string;
}) {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  // Two-step state: until a team is picked, render the team grid.
  // Once `pickedTeam` is set, render the password field. "Back"
  // resets to null.
  const [pickedTeam, setPickedTeam] = useState<TeamOption | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              name: String(data.name ?? d.id),
              color: data.color ? String(data.color) : undefined,
              logoUrl: data.logo_url ? String(data.logo_url) : null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setTeams(list);
      } finally {
        if (!cancelled) setLoadingTeams(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!pickedTeam || !password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public-captain-claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leagueId,
          teamId: pickedTeam.id,
          teamPassword: password.trim(),
        }),
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
      await signInWithCustomToken(getAuth(), data.customToken);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2: password gate (team is picked) ─────────────────────
  if (pickedTeam) {
    const accent = pickedTeam.color ?? "var(--brand-primary, #002d6e)";
    return (
      <div style={{ maxWidth: 460, margin: "0 auto", textAlign: "center" }}>
        <button
          type="button"
          onClick={() => {
            setPickedTeam(null);
            setPassword("");
            setError(null);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 18,
          }}
        >
          ← Pick a different team
        </button>

        <div
          style={{
            background: "white",
            border: `1px solid ${accent}`,
            borderRadius: 14,
            padding: "22px 18px",
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          {pickedTeam.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={pickedTeam.logoUrl}
              alt=""
              style={{
                width: 48,
                height: 48,
                objectFit: "contain",
              }}
            />
          ) : null}
          <span
            style={{
              fontFamily: "var(--font-barlow), sans-serif",
              fontSize: 22,
              fontWeight: 900,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
              color: "var(--text-strong)",
            }}
          >
            {pickedTeam.name}
          </span>
        </div>

        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.55,
            margin: "0 0 16px",
          }}
        >
          Enter your team password to manage roster, submit scores,
          and chat with your players.
        </p>

        <form onSubmit={submit}>
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="Password"
            aria-label="Team password"
            autoFocus
            style={{
              width: "100%",
              padding: "12px 14px",
              border: "1px solid var(--border, rgba(0,0,0,0.15))",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              background: "white",
              color: "var(--text-strong)",
              textAlign: "center",
              letterSpacing: "0.06em",
            }}
          />

          <div style={{ marginTop: 14 }}>
            <button
              type="submit"
              disabled={!password.trim() || busy}
              style={{
                padding: "12px 28px",
                background: accent,
                color: "white",
                borderRadius: 10,
                fontWeight: 800,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontSize: 14,
                border: "none",
                cursor: !password.trim() || busy ? "not-allowed" : "pointer",
                opacity: !password.trim() || busy ? 0.6 : 1,
              }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>

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
          Don't know the password? Ask your commissioner.
        </p>
      </div>
    );
  }

  // ── Step 1: team grid ──────────────────────────────────────────
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
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
          lineHeight: 1.55,
          margin: "0 0 22px",
        }}
      >
        Pick your team to continue.
      </p>

      {loadingTeams ? (
        <p style={{ color: "var(--muted)" }}>Loading teams…</p>
      ) : teams.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No teams set up yet.</p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {teams.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  setPickedTeam(t);
                  setPassword("");
                  setError(null);
                }}
                style={{
                  width: "100%",
                  padding: "18px 14px",
                  background: "white",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderLeft: `4px solid ${t.color ?? "var(--brand-primary, #002d6e)"}`,
                  borderRadius: 12,
                  cursor: "pointer",
                  textAlign: "center",
                  fontFamily: "var(--font-barlow), sans-serif",
                  fontWeight: 800,
                  fontSize: 15,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  color: "var(--text-strong)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                  transition: "transform 0.08s ease, box-shadow 0.12s ease",
                }}
                className="le-cap-team-btn"
              >
                {t.logoUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={t.logoUrl}
                    alt=""
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: "contain",
                    }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: "50%",
                      background: t.color ?? "var(--brand-primary, #002d6e)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                    }}
                  >
                    {t.name[0]}
                  </div>
                )}
                <span>{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p
        style={{
          marginTop: 22,
          fontSize: 12,
          color: "var(--muted)",
          lineHeight: 1.55,
        }}
      >
        Don't see your team? Ask the commissioner to add you.
      </p>
    </div>
  );
}
