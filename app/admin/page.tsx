"use client";

// Admin dashboard. Originally a flat stack of every admin section
// underneath each other in a narrow 672px column — fine for a dev
// poking around, awful for the league commissioner who actually
// uses this thing day-to-day.
//
// Now: a tabs layout. Default tab = Health (the most-used thing —
// "are there pending captain submissions to approve / publish").
// Developer-only sections (smoke test, recalc) live under "Tools"
// so they're available but out of the way.

import { useState } from "react";
import { signOut, useLeagueRole, useUser } from "@/lib/auth-client";
import { getDb } from "@/lib/firebase";
import { useTenant } from "@/lib/tenant-context";
import { captainNoun } from "@/lib/tenants";
import { doc, setDoc } from "firebase/firestore";
import { SendPushSection } from "@/components/admin/SendPushSection";
import { PagesManager } from "@/components/admin/PagesManager";
import { CaptainClaimsManager } from "@/components/admin/CaptainClaimsManager";
import { CaptainsRoster } from "@/components/admin/CaptainsRoster";
import { BulkInviteSection } from "@/components/admin/BulkInviteSection";
import { BrandingSection } from "@/components/admin/BrandingSection";
import { AuditLogViewer } from "@/components/admin/AuditLogViewer";
import { FormSubmissionsViewer } from "@/components/admin/FormSubmissionsViewer";
import { TeamsManager } from "@/components/admin/TeamsManager";
import { LeagueHealthDashboard } from "@/components/admin/LeagueHealthDashboard";
import { ScheduleEditor } from "@/components/admin/ScheduleEditor";
import { PlayoffsManager } from "@/components/admin/PlayoffsManager";
import { AlertsManager } from "@/components/admin/AlertsManager";
import { SignupsReview } from "@/components/admin/SignupsReview";
import { CalendarFeeds } from "@/components/admin/CalendarFeeds";
import { ChatModerator } from "@/components/admin/ChatModerator";
import { PhotosManager } from "@/components/admin/PhotosManager";
import { ScoresManager } from "@/components/admin/ScoresManager";
import { SponsorsManager } from "@/components/admin/SponsorsManager";
import { NewsManager } from "@/components/admin/NewsManager";
import { PlayerOfWeekManager } from "@/components/admin/PlayerOfWeekManager";
import { PaymentsAdmin } from "@/components/admin/PaymentsAdmin";
import { FieldUsage } from "@/components/admin/FieldUsage";
import { FieldsManager } from "@/components/admin/FieldsManager";
import { AdminPasswordGate } from "@/components/admin/AdminPasswordGate";

type TabKey =
  | "health"
  | "scores"
  | "schedule"
  | "playoffs"
  | "teams"
  | "signups"
  | "captains"
  | "payments"
  | "fields"
  | "alerts"
  | "news"
  | "potw"
  | "pages"
  | "photos"
  | "sponsors"
  | "branding"
  | "notifications"
  | "calendar"
  | "chat"
  | "forms"
  | "audit";

const TABS: { key: TabKey; label: string; description: string }[] = [
  { key: "health", label: "Health", description: "League snapshot, pending submissions, rule violations." },
  { key: "scores", label: "Scores", description: "Quick batch score entry + resolve captain submission conflicts." },
  { key: "schedule", label: "Schedule", description: "Add games, reschedule, mark a date rained out, edit scores." },
  { key: "playoffs", label: "Playoffs", description: "Build the playoff bracket — seed from standings, divisions, rounds, matchups, results. Toggle Active to publish it to /playoffs." },
  { key: "teams", label: "Teams", description: "Roster import, edit team metadata, manage divisions." },
  { key: "signups", label: "Signups", description: "Approve or reject players added by captains (walk-ons)." },
  { key: "captains", label: "Captains", description: "Every team's captain: contact, password status, and last login." },
  { key: "payments", label: "Payments", description: "League-wide fee collection — who's paid, per team, with totals." },
  { key: "fields", label: "Fields", description: "Add / edit the league's fields (name + address), and see how many games each has hosted." },
  { key: "alerts", label: "Alerts", description: "Publish a homepage banner — weather, registration, deadlines." },
  { key: "news", label: "News", description: "From-the-commissioner news & events shown on the homepage." },
  { key: "potw", label: "Player of Week", description: "Curate the Player of the Week spotlight + archive shown at /player-of-the-week." },
  { key: "pages", label: "Pages", description: "Edit Rules, News, Register, Sponsors, and other content pages." },
  { key: "photos", label: "Photos", description: "Upload photos to the public gallery at /photos." },
  { key: "sponsors", label: "Sponsors", description: "Manage the sponsor logo strip in the site footer." },
  { key: "branding", label: "Branding", description: "League logo, colors, and theming." },
  { key: "notifications", label: "Notifications", description: "Send push announcements to players." },
  { key: "calendar", label: "Calendar", description: "Subscription URLs (Google / Apple / Outlook) per team or league-wide." },
  // Chat hidden for now (Adam, 2026-05-18). Re-add to re-enable.
  // { key: "chat", label: "Chat", description: "Browse and moderate captains-chat or team chats." },
  { key: "forms", label: "Form submissions", description: "Review player + team registrations, waivers, and umpire evaluations submitted from the public site." },
  { key: "audit", label: "Audit log", description: "Recent admin actions and score changes." },
  // Tools tab (recalc / smoke test / CSV importer) hidden per Adam —
  // Recalc is already accessible from the Health tab, CSV import is a
  // first-day-of-onboarding workflow not a commissioner one, smoke test
  // is dev-only. Re-add the entry here if SFBL needs CSV reimports.
];

// Less-frequent tabs tucked into a "More ▾" dropdown so the tab strip
// isn't overwhelming (Adam, 2026-06). Order is Adam's. Content +
// descriptions still key off activeTab, so only the nav changes.
const MORE_KEYS: TabKey[] = [
  "news",
  "photos",
  "sponsors",
  "branding",
  "audit",
  "potw",
  "pages",
];
const MORE_SET = new Set<TabKey>(MORE_KEYS);
const TOP_TABS = TABS.filter((t) => !MORE_SET.has(t.key));
const MORE_TABS = MORE_KEYS.map((k) => TABS.find((t) => t.key === k)).filter(
  (t): t is (typeof TABS)[number] => !!t,
);

// Tabs that name the team-manager role render through the tenant's
// configured noun (captainNoun): SFBL shows "Manager", the default
// stays "Captain". The stored TabKey ("captains") and the static TABS
// text above are unchanged — only the displayed label/description are
// relabeled here.
function tabLabel(t: (typeof TABS)[number], captain: string): string {
  return t.key === "captains" ? `${captain}s` : t.label;
}

function tabDescription(t: (typeof TABS)[number], captain: string): string {
  switch (t.key) {
    case "captains":
      return `Every team's ${captain}: contact, password status, and last login.`;
    case "signups":
      return `Approve or reject players added by ${captain}s (walk-ons).`;
    case "scores":
      return `Quick batch score entry + resolve ${captain} submission conflicts.`;
    default:
      return t.description;
  }
}

export default function AdminPage() {
  const { tenantId, config } = useTenant();
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const [activeTab, setActiveTab] = useState<TabKey>("health");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_SET.has(activeTab);
  const captain = captainNoun(config);

  if (user === undefined || role === "loading") {
    return <Shell heading={config?.name ?? "Admin"}>Checking your access…</Shell>;
  }

  if (user === null) {
    // Passwordless tenants (LBDC) show a shared-password gate
    // instead of redirecting to magic-link sign-in. The gate
    // posts to /api/public-admin-claim, gets a Firebase custom
    // token with admin claim, and signs in via
    // signInWithCustomToken — the rest of this page then renders.
    if (tenantId && config?.admin?.passwordless === true) {
      return <AdminPasswordGate leagueId={tenantId} />;
    }
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
        <SignedInHeader email={user.email} role={role} />
        <p className="text-slate-700">
          You're signed in but you don't have admin role for{" "}
          <span className="font-mono">{tenantId}</span>. Ask the league administrator
          to grant you access.
        </p>
        <RefreshButton />
      </Shell>
    );
  }

  return (
    <Shell heading={config?.name ?? "Admin"}>
      <SignedInHeader email={user.email} role={role} />

      {/* Tab nav — wraps to multiple rows on desktop, horizontally
          scrolls on phone with the active tab auto-scrolling into
          view. 16 tabs across 5 rows on a phone is unusable; one
          swipeable row is much better. */}
      <div className="le-admin-tabbar">
        <nav className="le-admin-tabs">
          {TOP_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              ref={(el) => {
                if (el && activeTab === t.key) {
                  el.scrollIntoView({
                    behavior: "smooth",
                    inline: "center",
                    block: "nearest",
                  });
                }
              }}
              className={
                "le-admin-tab " +
                (activeTab === t.key ? "le-admin-tab-active" : "")
              }
            >
              {tabLabel(t, captain)}
            </button>
          ))}
        </nav>
        {/* More ▾ lives OUTSIDE the scrolling nav so (a) it's always
            visible and (b) its dropdown anchors to the button and isn't
            clipped by the nav's overflow on mobile. */}
        <div className="le-admin-more-wrap">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            className={
              "le-admin-tab " + (moreActive ? "le-admin-tab-active" : "")
            }
          >
            More ▾
          </button>
          {moreOpen && (
            <>
              {/* Tap-outside backdrop */}
              <div
                className="le-admin-more-backdrop"
                aria-hidden
                onClick={() => setMoreOpen(false)}
              />
              <div className="le-admin-more-menu" role="menu">
                {MORE_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActiveTab(t.key);
                      setMoreOpen(false);
                    }}
                    className={
                      "le-admin-more-item " +
                      (activeTab === t.key ? "active" : "")
                    }
                  >
                    {tabLabel(t, captain)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <style jsx>{`
        .le-admin-tabbar {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          border-bottom: 1px solid rgb(226, 232, 240);
          margin: 0 -4px;
          padding: 0 4px;
        }
        .le-admin-tabs {
          display: flex;
          gap: 4px;
          padding: 4px 0;
          flex-wrap: wrap;
          flex: 1 1 auto;
          min-width: 0;
        }
        @media (max-width: 640px) {
          .le-admin-tabs {
            flex-wrap: nowrap;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
          }
          .le-admin-tabs::-webkit-scrollbar {
            display: none;
          }
        }
        .le-admin-tab {
          padding: 8px 12px;
          border-radius: 6px 6px 0 0;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgb(71, 85, 105);
          background: transparent;
          border: none;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
          font-family: inherit;
          transition: background 0.15s, color 0.15s;
        }
        .le-admin-tab:hover {
          background: rgb(241, 245, 249);
        }
        .le-admin-tab-active {
          background: rgb(15, 23, 42);
          color: white;
        }
        .le-admin-tab-active:hover {
          background: rgb(15, 23, 42);
        }
        .le-admin-more-wrap {
          position: relative;
          flex: 0 0 auto;
          padding: 4px 0;
        }
        .le-admin-more-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
        }
        .le-admin-more-menu {
          position: absolute;
          right: 0;
          top: 100%;
          z-index: 50;
          margin-top: 4px;
          min-width: 200px;
          background: white;
          border: 1px solid rgb(226, 232, 240);
          border-radius: 8px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14);
          padding: 4px;
          display: flex;
          flex-direction: column;
        }
        .le-admin-more-item {
          padding: 9px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgb(71, 85, 105);
          background: transparent;
          border: none;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          white-space: nowrap;
        }
        .le-admin-more-item:hover {
          background: rgb(241, 245, 249);
        }
        .le-admin-more-item.active {
          background: rgb(15, 23, 42);
          color: white;
        }
      `}</style>

      <p className="text-sm text-slate-500">
        {(() => {
          const active = TABS.find((t) => t.key === activeTab);
          return active ? tabDescription(active, captain) : null;
        })()}
      </p>

      <div>
        {activeTab === "health" && (
          <div className="space-y-4">
            <LeagueHealthDashboard
              leagueId={tenantId}
              user={user}
              onReviewForms={() => setActiveTab("forms")}
            />
            <section className="rounded-md border border-slate-200 bg-white p-4 space-y-2">
              <p className="font-semibold text-slate-900">PDF exports</p>
              <p className="text-xs text-slate-600">
                Open in a new tab and use your browser's print dialog to
                save as PDF.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href="/print/standings"
                  target="_blank"
                  rel="noopener"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  📄 Standings
                </a>
                <a
                  href="/print/schedule"
                  target="_blank"
                  rel="noopener"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  📄 Schedule
                </a>
                <a
                  href="/print/contacts"
                  target="_blank"
                  rel="noopener"
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  title="Confidential — emails + phones for every active player"
                >
                  📄 Contacts (confidential)
                </a>
              </div>
            </section>
            {/* Recalc Maintenance card hidden per Adam — confusing UI
             *  for the commissioner since stats auto-write on box score
             *  save. Re-mount this section if a manual data fix ever
             *  drifts the cache:
             *    <section ...>
             *      <p>Maintenance</p>
             *      <RecalcStatsButton tenantId={tenantId} user={user} variant="compact" />
             *    </section>
             */}
          </div>
        )}
        {activeTab === "scores" && (
          <ScoresManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "schedule" && (
          <ScheduleEditor leagueId={tenantId} user={user} />
        )}
        {activeTab === "playoffs" && (
          <PlayoffsManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "teams" && (
          <TeamsManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "signups" && (
          <SignupsReview leagueId={tenantId} user={user} />
        )}
        {activeTab === "captains" && (
          <div className="space-y-4">
            {/* Consolidated roster — every captain in one place. Useful
                for all tenants. */}
            <CaptainsRoster leagueId={tenantId} user={user} />
            {/* Email/magic-link captain claims only apply when captains
                sign in by email. Passwordless tenants (SFBL) use team
                passwords, so hide these to avoid confusion. */}
            {config?.captain?.passwordless !== true && (
              <>
                <CaptainClaimsManager leagueId={tenantId} user={user} />
                <BulkInviteSection leagueId={tenantId} user={user} />
              </>
            )}
          </div>
        )}
        {activeTab === "alerts" && (
          <AlertsManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "payments" && (
          <PaymentsAdmin leagueId={tenantId} user={user} />
        )}
        {activeTab === "fields" && (
          <div className="space-y-8">
            <FieldsManager leagueId={tenantId} user={user} />
            <FieldUsage leagueId={tenantId} user={user} />
          </div>
        )}
        {activeTab === "news" && (
          <NewsManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "potw" && (
          <PlayerOfWeekManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "pages" && (
          <PagesManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "photos" && (
          <PhotosManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "sponsors" && (
          <SponsorsManager leagueId={tenantId} user={user} />
        )}
        {activeTab === "branding" && (
          <BrandingSection leagueId={tenantId} user={user} />
        )}
        {activeTab === "notifications" && (
          <SendPushSection leagueId={tenantId} user={user} />
        )}
        {activeTab === "calendar" && (
          <CalendarFeeds leagueId={tenantId} user={user} />
        )}
        {activeTab === "chat" && (
          <ChatModerator leagueId={tenantId} user={user} />
        )}
        {activeTab === "forms" && (
          <FormSubmissionsViewer leagueId={tenantId} user={user} />
        )}
        {activeTab === "audit" && (
          <AuditLogViewer leagueId={tenantId} user={user} />
        )}
        {/* Tools tab render block removed (see comment near TABS list). */}
      </div>
    </Shell>
  );
}

function Shell({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-5 px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{heading} — Admin</h1>
      </header>
      <section className="space-y-4">{children}</section>
    </main>
  );
}

function SignedInHeader({
  email,
  role,
}: {
  email: string | null;
  role: string;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <div className="text-slate-700">
        Signed in as <span className="font-semibold">{email ?? "(none)"}</span>
        <span className="ml-2 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
          {role}
        </span>
      </div>
      <button
        onClick={() => signOut().then(() => (window.location.href = "/login"))}
        className="text-xs text-slate-500 underline hover:text-slate-900"
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

