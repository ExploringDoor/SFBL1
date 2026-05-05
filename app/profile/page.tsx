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
import { useUser } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";
import { NotificationsPanel } from "@/components/notifications/NotificationsPanel";
import { PlayerAvailabilityPanel } from "@/components/profile/PlayerAvailabilityPanel";
import { PlayerTeamChatPanel } from "@/components/profile/PlayerTeamChatPanel";
import { InboxPanel } from "@/components/profile/InboxPanel";

const TABS: { key: string; label: string }[] = [
  { key: "avail", label: "📅 Availability" },
  { key: "teamchat", label: "💬 Team Chat" },
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
    return (
      <main className="container py-16">
        <p>Loading…</p>
      </main>
    );
  }
  if (user === null) {
    return (
      <main className="container py-16">
        <p style={{ marginBottom: 16 }}>You're not signed in.</p>
        <Link href="/login" className="le-cap-btn-primary">
          Sign in
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
              Account settings (email, password, sign out) — coming soon.
              For now, sign out from the top-right menu.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
