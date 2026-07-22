"use client";

// Admin moderation queue for Player Ads.
//
// Ads do NOT appear on the public board until approved here. That review step
// is not bureaucracy: the ad body is free text written by the public and IS
// published, so this is where a phone number or a surname pasted into the
// message gets caught before it goes on a page about minors.
//
// Everything on this screen comes from /api/admin-player-ads (Admin SDK), which
// is the only reader of the private submission. Approving projects a redacted
// copy to /leagues/{id}/player_ads; the contact block below never leaves here.

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";

interface Ad {
  id: string;
  posted_by?: string;
  age_group?: string;
  position?: string;
  town?: string;
  team_name?: string;
  message?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  submitted_at?: string;
  ad_status?: string;
}

type Decision = "approve" | "reject" | "pending";

// Cheap heuristics for "this ad body leaks contact info". Not a blocker, just
// a flag on the card so the reviewer's eye goes to the right ads first.
const PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function PlayerAdsManager({
  leagueId,
  user,
}: {
  leagueId: string;
  user: User | null;
}) {
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/admin-player-ads?leagueId=${encodeURIComponent(leagueId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not load player ads.");
        setAds([]);
      } else {
        setAds(json.ads ?? []);
      }
    } catch {
      setError("Could not load player ads.");
    } finally {
      setLoading(false);
    }
  }, [leagueId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, decision: Decision) {
    if (!user) return;
    setBusy(id);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin-player-ads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ leagueId, id, decision }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Could not update that ad.");
      } else {
        await load();
      }
    } catch {
      setError("Could not update that ad.");
    } finally {
      setBusy(null);
    }
  }

  const statusOf = (a: Ad) => a.ad_status ?? "pending";
  const shown = ads.filter((a) =>
    tab === "pending"
      ? statusOf(a) === "pending"
      : tab === "approved"
        ? statusOf(a) === "approved"
        : statusOf(a) === "reject" || statusOf(a) === "rejected",
  );
  const count = (s: string) =>
    ads.filter((a) =>
      s === "rejected"
        ? statusOf(a) === "reject" || statusOf(a) === "rejected"
        : statusOf(a) === s,
    ).length;

  if (loading) return <p className="text-slate-600">Loading player ads…</p>;

  return (
    <div>
      {error && (
        <p
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 14,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(["pending", "approved", "rejected"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            style={{
              padding: "7px 15px",
              borderRadius: 999,
              border:
                tab === t ? "1px solid #002d6e" : "1px solid rgba(0,0,0,0.14)",
              background: tab === t ? "#002d6e" : "white",
              color: tab === t ? "white" : "#0f172a",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {t} ({count(t)})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-slate-600">Nothing {tab}.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {shown.map((ad) => {
            const body = ad.message ?? "";
            const leaks =
              PHONE_RE.test(body) || EMAIL_RE.test(body) ? true : false;
            return (
              <li
                key={ad.id}
                style={{
                  background: "white",
                  border: "1px solid rgba(0,0,0,0.1)",
                  borderLeft: `4px solid ${
                    ad.posted_by === "coach" ? "#002d6e" : "#35afea"
                  }`,
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    marginBottom: 6,
                  }}
                >
                  {ad.posted_by === "coach"
                    ? "Team seeking players"
                    : "Player seeking a team"}
                  {ad.submitted_at
                    ? ` · ${new Date(ad.submitted_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}`
                    : ""}
                </div>

                <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>
                  {[ad.age_group, ad.team_name, ad.position, ad.town]
                    .filter(Boolean)
                    .join(" · ") || "(no details)"}
                </div>

                {leaks && (
                  <p
                    style={{
                      margin: "8px 0 0",
                      background: "#fffbeb",
                      border: "1px solid #fde68a",
                      color: "#92400e",
                      borderRadius: 6,
                      padding: "7px 10px",
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    This ad body looks like it contains a phone number or email.
                    That text IS published. Edit it out or reject the ad.
                  </p>
                )}

                <p
                  style={{
                    margin: "8px 0 0",
                    fontSize: 14,
                    lineHeight: 1.55,
                    color: "#334155",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {body}
                </p>

                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 10,
                    borderTop: "1px dashed rgba(0,0,0,0.12)",
                    fontSize: 12.5,
                    color: "#64748b",
                  }}
                >
                  <strong style={{ color: "#0f172a" }}>Private contact</strong>{" "}
                  (never published): {ad.contact_name ?? "—"}
                  {ad.email ? ` · ${ad.email}` : ""}
                  {ad.phone ? ` · ${ad.phone}` : ""}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  {statusOf(ad) !== "approved" && (
                    <button
                      type="button"
                      disabled={busy === ad.id}
                      onClick={() => decide(ad.id, "approve")}
                      style={btn("#15803d")}
                    >
                      {busy === ad.id ? "Working…" : "Approve and publish"}
                    </button>
                  )}
                  {statusOf(ad) === "approved" && (
                    <button
                      type="button"
                      disabled={busy === ad.id}
                      onClick={() => decide(ad.id, "pending")}
                      style={btn("#b45309")}
                    >
                      {busy === ad.id ? "Working…" : "Unpublish"}
                    </button>
                  )}
                  {statusOf(ad) !== "reject" && statusOf(ad) !== "rejected" && (
                    <button
                      type="button"
                      disabled={busy === ad.id}
                      onClick={() => decide(ad.id, "reject")}
                      style={btn("#b91c1c")}
                    >
                      Reject
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    border: "none",
    background: bg,
    color: "white",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
