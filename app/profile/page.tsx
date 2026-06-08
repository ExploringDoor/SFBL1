"use client";

// /profile — user-scoped settings page. Mirrors DVSL's /profile.html.
// The `#notif` section is the canonical notification-preferences UI;
// the captain portal links here from its tab strip rather than
// duplicating the prefs UI inline (DVSL's structural pattern at
// captain.html:810).
//
// Tabs are URL-hash-driven: #notif | #account | (future: #avail, etc).
// The captain link punts straight to /profile#notif so the user lands
// on the right tab without an extra click.

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut, useUser } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";
import { NotificationsPanel } from "@/components/notifications/NotificationsPanel";
import { PlayerAvailabilityPanel } from "@/components/profile/PlayerAvailabilityPanel";
import { PlayerTeamChatPanel } from "@/components/profile/PlayerTeamChatPanel";
import { InboxPanel } from "@/components/profile/InboxPanel";

const TABS: { key: string; label: string }[] = [
  { key: "avail", label: "📅 Availability" },
  // Team Chat hidden for now (Adam, 2026-05-18). The render + panel
  // are kept below; restore this line to bring the tab back.
  // { key: "teamchat", label: "💬 Team Chat" },
  { key: "inbox", label: "📨 Inbox" },
  { key: "notif", label: "🔔 Notifications" },
  { key: "account", label: "Account" },
];

// Default to availability — that's what most players want when they
// land here (typically arriving from a captain's "Remind Waiting"
// push that deep-links to /profile#avail).
function useProfileTab(): [string, (k: string) => void] {
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "avail";
    const h = window.location.hash.replace(/^#/, "");
    return TABS.some((t) => t.key === h) ? h : "avail";
  });
  useEffect(() => {
    function onHash() {
      const h = window.location.hash.replace(/^#/, "");
      setTab(TABS.some((t) => t.key === h) ? h : "avail");
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  function go(k: string) {
    window.location.hash = k;
    setTab(k);
  }
  return [tab, go];
}

export default function ProfilePage() {
  const { tenantId } = useTenant();
  const user = useUser();
  const [tab, go] = useProfileTab();

  if (!tenantId) {
    return (
      <main className="container py-16">
        <p>Profile is tenant-scoped. Visit a league subdomain.</p>
      </main>
    );
  }
  if (user === undefined) {
    // Quick auth-resolution skeleton — Firebase typically settles in
    // <300ms but on iOS PWA cold starts it can take a beat. The
    // "Loading…" string used to flash here looked broken; this hero
    // skeleton matches the eventual layout so the page doesn't pop.
    return (
      <main className="container py-16">
        <div
          style={{
            maxWidth: 360,
            margin: "0 auto",
            textAlign: "center",
            color: "var(--muted)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.06)",
              margin: "0 auto 16px",
            }}
          />
          <div
            style={{
              width: "60%",
              height: 14,
              background: "rgba(0,0,0,0.06)",
              borderRadius: 4,
              margin: "0 auto",
            }}
          />
        </div>
      </main>
    );
  }
  if (user === null) {
    // Friendlier sign-in CTA than a one-liner. Explains why the user
    // would sign in (RSVP availability, push notifications, captain
    // tools) rather than just demanding it.
    return (
      <main
        className="container py-16"
        style={{ maxWidth: 480, textAlign: "center" }}
      >
        <div aria-hidden style={{ fontSize: 56, marginBottom: 12 }}>
          🙋
        </div>
        <h1
          className="font-display"
          style={{
            fontSize: 28,
            color: "var(--text-strong)",
            margin: "0 0 8px",
          }}
        >
          Sign in to your profile
        </h1>
        <p
          style={{
            color: "var(--muted)",
            fontSize: 14,
            lineHeight: 1.6,
            margin: "0 0 24px",
          }}
        >
          RSVP for games, get push notifications when your team plays,
          and (if you&rsquo;re a captain) submit scores. Signs you in by
          emailing a one-tap link — no password needed.
        </p>
        <Link
          href="/login"
          className="le-cap-btn-primary"
          style={{
            display: "inline-block",
            padding: "12px 28px",
            background: "var(--brand-primary)",
            color: "white",
            borderRadius: 10,
            fontWeight: 800,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            textDecoration: "none",
            fontSize: 14,
          }}
        >
          Sign in by email
        </Link>
      </main>
    );
  }

  return (
    <main className="le-cap-shell">
      <section className="le-cap-hero" style={{ background: "linear-gradient(135deg, var(--brand-primary, #0a0e1c) 0%, #0a0e1c 100%)" }}>
        <div className="le-cap-hero-inner">
          <p className="le-cap-eyebrow">Your Profile</p>
          <h1 className="le-cap-team-name">Settings</h1>
          <p className="le-cap-greeting">Signed in as {user.email ?? user.uid}</p>
        </div>
      </section>

      <nav className="cap-tab-nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={"cap-tab-item" + (tab === t.key ? " active" : "")}
            onClick={() => go(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "avail" && <PlayerAvailabilityPanel leagueId={tenantId} />}
      {tab === "teamchat" && <PlayerTeamChatPanel leagueId={tenantId} />}
      {tab === "inbox" && <InboxPanel leagueId={tenantId} />}
      {tab === "notif" && <NotificationsPanel leagueId={tenantId} />}
      {tab === "account" && (
        <div className="cap-tab">
          <div className="cap-section-head">
            <h2 className="cap-section-title">Account</h2>
            <p className="cap-section-sub">
              Signed in with{" "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {user.email ?? user.uid}
              </span>
              .
            </p>
          </div>
          <div
            style={{
              padding: "16px 20px",
              background: "white",
              border: "1px solid rgba(0, 0, 0, 0.08)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              maxWidth: 460,
              marginTop: 12,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.55,
              }}
            >
              Switching accounts? Sign out, then sign back in with a
              different email.
            </p>
            <button
              type="button"
              onClick={() => {
                signOut().then(() => {
                  window.location.href = "/";
                });
              }}
              style={{
                alignSelf: "flex-start",
                background: "transparent",
                color: "#991b1b",
                border: "1px solid rgba(220, 38, 38, 0.25)",
                padding: "10px 18px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 13,
                fontFamily: "inherit",
                cursor: "pointer",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
