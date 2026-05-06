// Platform admin dashboard. Lives at /_platform on the apex
// (leagueengine.com/_platform). Shows every tenant + recent errors at
// a glance — the "open one URL on phone" surface from PLAN.md §6.
//
// Auth posture: client-side fetches /api/_platform-overview, which
// gates on PLATFORM_ADMIN_UIDS server-side. Anyone hitting this page
// without that UID gets a "not authorized" message; this page never
// reveals tenant data without a successful API response.

"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { useUser } from "@/lib/auth-client";

interface TenantOverview {
  slug: string;
  name: string;
  sport: string | null;
  billing_status: string | null;
  paid_through: string | null;
  team_count: number;
  player_count: number;
  game_count: number;
  last_activity_at: string | null;
}

interface ErrorRow {
  id: string;
  at: string | null;
  message: string;
  leagueId: string | null;
  url: string | null;
  uid: string | null;
}

interface Overview {
  tenants: TenantOverview[];
  errors: ErrorRow[];
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; data: Overview }
  | { kind: "error"; status: number | null; message: string };

export default function PlatformPage() {
  const user = useUser();
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  useEffect(() => {
    if (user === undefined) return; // still resolving auth
    if (user === null) {
      setState({ kind: "error", status: null, message: "not signed in" });
      return;
    }
    void load(user, setState);
  }, [user]);

  // ── shell ────────────────────────────────────────────────────
  if (user === undefined || state.kind === "idle" || state.kind === "loading") {
    return (
      <Shell>
        <p style={{ color: "var(--muted)" }}>Loading platform overview…</p>
      </Shell>
    );
  }

  if (user === null) {
    return (
      <Shell>
        <p>You're not signed in.</p>
        <a
          href="/login"
          style={{
            display: "inline-block",
            background: "var(--brand-primary)",
            color: "white",
            padding: "8px 14px",
            borderRadius: 6,
            textDecoration: "none",
            marginTop: 12,
          }}
        >
          Sign in
        </a>
      </Shell>
    );
  }

  if (state.kind === "error") {
    const msg =
      state.status === 403
        ? `This page is for platform administrators only. Your UID isn't on the list. (${user.uid})`
        : state.status === 401
          ? "Your sign-in expired. Please sign in again."
          : state.message;
    return (
      <Shell>
        <p style={{ color: "var(--muted)" }}>{msg}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <SignedInHeader user={user} />
      <TenantTable tenants={state.data.tenants} />
      <ErrorList errors={state.data.errors} />
    </Shell>
  );
}

// ── helpers ────────────────────────────────────────────────────

async function load(
  user: User,
  setState: (s: FetchState) => void,
): Promise<void> {
  setState({ kind: "loading" });
  try {
    const idToken = await user.getIdToken();
    const res = await fetch("/api/_platform-overview", {
      headers: { authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setState({
        kind: "error",
        status: res.status,
        message: body.error ?? `HTTP ${res.status}`,
      });
      return;
    }
    const data = (await res.json()) as Overview;
    setState({ kind: "ok", data });
  } catch (e) {
    setState({
      kind: "error",
      status: null,
      message: e instanceof Error ? e.message : "Network error",
    });
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--muted)",
            margin: 0,
          }}
        >
          LeagueEngine
        </p>
        <h1
          style={{
            fontSize: "clamp(28px, 4vw, 40px)",
            fontWeight: 900,
            margin: "4px 0 0",
            color: "var(--text-strong)",
          }}
        >
          Platform Admin
        </h1>
      </header>
      {children}
    </main>
  );
}

function SignedInHeader({ user }: { user: User }) {
  return (
    <p
      style={{
        fontSize: 13,
        color: "var(--muted)",
        marginBottom: 16,
      }}
    >
      Signed in as <span style={{ fontFamily: "monospace" }}>{user.email}</span>
      {" · "}
      <span style={{ fontFamily: "monospace" }}>{user.uid}</span>
    </p>
  );
}

function TenantTable({ tenants }: { tenants: TenantOverview[] }) {
  if (tenants.length === 0) {
    return (
      <section style={{ marginBottom: 32 }}>
        <SectionHeader>Tenants</SectionHeader>
        <p style={{ color: "var(--muted)" }}>
          No tenants yet. Run <code>npm run provision</code> to create one.
        </p>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <SectionHeader>Tenants ({tenants.length})</SectionHeader>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 14,
          }}
        >
          <thead>
            <tr style={{ textAlign: "left", color: "var(--muted)" }}>
              <th style={th}>Slug</th>
              <th style={th}>Name</th>
              <th style={th}>Sport</th>
              <th style={th}>Billing</th>
              <th style={{ ...th, textAlign: "right" }}>Teams</th>
              <th style={{ ...th, textAlign: "right" }}>Players</th>
              <th style={{ ...th, textAlign: "right" }}>Games</th>
              <th style={th}>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr
                key={t.slug}
                style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}
              >
                <td style={td}>
                  <span style={{ fontFamily: "monospace" }}>{t.slug}</span>
                </td>
                <td style={td}>{t.name}</td>
                <td style={td}>{t.sport ?? "—"}</td>
                <td style={td}>
                  <BillingPill
                    status={t.billing_status}
                    paidThrough={t.paid_through}
                  />
                </td>
                <td style={{ ...td, textAlign: "right" }}>{t.team_count}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {t.player_count}
                </td>
                <td style={{ ...td, textAlign: "right" }}>{t.game_count}</td>
                <td style={td}>{formatTs(t.last_activity_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BillingPill({
  status,
  paidThrough,
}: {
  status: string | null;
  paidThrough: string | null;
}) {
  if (!status) {
    return <span style={{ color: "var(--muted)" }}>—</span>;
  }
  const color =
    status === "active"
      ? "#0a8f3a"
      : status === "lapsed"
        ? "#bf3c2f"
        : "var(--muted)";
  return (
    <span style={{ color, fontWeight: 600 }}>
      {status}
      {paidThrough ? (
        <span
          style={{
            color: "var(--muted)",
            fontWeight: 400,
            marginLeft: 6,
            fontSize: 12,
          }}
        >
          (thru {paidThrough})
        </span>
      ) : null}
    </span>
  );
}

function ErrorList({ errors }: { errors: ErrorRow[] }) {
  return (
    <section>
      <SectionHeader>
        Recent errors ({errors.length}
        {errors.length === 50 ? "+" : ""})
      </SectionHeader>
      {errors.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>No errors logged. 🎉</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {errors.map((e) => (
            <li
              key={e.id}
              style={{
                borderTop: "1px solid rgba(0,0,0,0.08)",
                padding: "10px 0",
                fontSize: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {formatTs(e.at)}
                </span>
                {e.leagueId ? (
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      background: "rgba(0,0,0,0.05)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {e.leagueId}
                  </span>
                ) : null}
              </div>
              <div style={{ marginTop: 4, color: "var(--text-strong)" }}>
                {e.message}
              </div>
              {e.url ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: "var(--muted)",
                    fontFamily: "monospace",
                  }}
                >
                  {e.url}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--brand-primary)",
        margin: "0 0 12px",
      }}
    >
      {children}
    </h2>
  );
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const th: React.CSSProperties = {
  padding: "8px 8px 8px 0",
  fontWeight: 600,
  fontSize: 12,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};
const td: React.CSSProperties = { padding: "10px 8px 10px 0" };
