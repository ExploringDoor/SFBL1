"use client";

// Notifications panel — shared component embedded in every role surface
// that lets the user manage push prefs (captain dashboard, profile,
// future admin dashboard). Verbatim port of softball-site/
// notifications.html UI (categories list + team picker + admin row),
// plus the multi-tenant `leagueId` plumbing (every read/write scoped).
//
// **Why this lives in /components/notifications and not /components/profile:**
//
// The first cut of this component was profile-only — captains clicked
// "🔔 Notifications" in their tab strip and got bounced to /profile#notif.
// DVSL captain.html:810 did the same thing for years. Then DVSL hit a
// real bug from it (v271): captains felt yanked out of their dashboard
// mid-session. DVSL fix: embed the panel in EVERY role surface using a
// shared component. We're matching that pattern.
//
// Same panel renders in /captain#notifications and /profile#notif.
// localStorage dismiss state (Unread/Archive sections, when they land)
// is keyed by leagueId so a captain in two leagues doesn't share state.
//
// FUTURE: when /api/check-pending-nav + the inbox land, add Unread +
// Archive sections above the prefs settings (DVSL pattern post-v271 —
// "Notifications" panel has three sections: Unread / Archive / Settings).
// The Settings section is what's here today.
//
// States:
//   1. UNSUPPORTED       — browser has no Notification + SW + Push API
//   2. iOS_NEEDS_PWA     — iOS Safari NOT in standalone mode (push only
//                          works once the user installs to home screen).
//                          We surface install instructions instead of
//                          a broken "Enable" button.
//   3. NOT_ENABLED       — supported but the user hasn't subscribed yet
//                          → show big "Enable notifications" button
//   4. ENABLED           — token exists; show categories + teams + admin,
//                          plus a status badge + Disable button at the
//                          bottom.
//
// The token doc lives at /notification_tokens/<token>_<leagueId>. The
// rules let the user read their own row (auth_uid match) so we can
// load current prefs straight from Firestore. Mutations go through
// /api/register-notification-token so the server can stamp leagueId
// + re-derive trust fields.

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { useUser } from "@/lib/auth-client";
import {
  CATEGORY_DISPLAY_ORDER,
  CATEGORY_LABELS,
  CATEGORY_SUBLABELS,
  DEFAULT_CATEGORIES,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import {
  disablePush,
  enablePushAndGetToken,
  getCachedToken,
  isPushSupported,
  setCachedToken,
} from "@/lib/notifications/fcm-client";

interface TeamOption {
  id: string;
  name: string;
}

interface TokenDoc {
  categories: NotificationCategory[];
  teams: string[];
  is_admin: boolean;
  is_captain_authed: boolean;
  authed_teams: string[];
}

interface Props {
  leagueId: string;
}

type TeamMode = "all" | "mine" | "custom";

// Detect iOS Safari and whether the page is in PWA standalone mode.
// On iOS, push only works inside an installed PWA (iOS 16.4+); a
// regular Safari tab cannot subscribe. DVSL surfaces install
// instructions instead of letting the user click a broken Enable
// button.
function detectIosNeedsPwa(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const isIos = /iPad|iPhone|iPod/.test(ua);
  if (!isIos) return false;
  // navigator.standalone is iOS-specific; falsy in Safari tab, true in
  // installed PWA. Modern browsers also expose display-mode media query.
  type IosNav = Navigator & { standalone?: boolean };
  const inStandalone =
    (window.navigator as IosNav).standalone === true ||
    (window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches);
  return !inStandalone;
}

export function NotificationsPanel({ leagueId }: Props) {
  const user = useUser();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [iosNeedsPwa, setIosNeedsPwa] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  const [token, setToken] = useState<string | null>(null);
  const [docState, setDocState] = useState<TokenDoc | null>(null);
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([]);
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyEnable, setBusyEnable] = useState(false);
  const [busyDisable, setBusyDisable] = useState(false);

  // Detect support + permission state on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isSup = await isPushSupported();
      if (cancelled) return;
      setSupported(isSup);
      setIosNeedsPwa(detectIosNeedsPwa());
      if (isSup && typeof Notification !== "undefined") {
        setPerm(Notification.permission);
      }
      const cached = getCachedToken();
      if (cached) setToken(cached);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load teams list (so the user can pick a subset to subscribe to)
  // AND auto-detect "my team" — the team the captain claim names, or
  // the team of the linked player record. Mirrors DVSL's
  // `_detectMyTeam()` (notifications.html:952).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = getDb();
      const teamsSnap = await getDocs(
        collection(db, `leagues/${leagueId}/teams`),
      );
      if (cancelled) return;
      setTeamOptions(
        teamsSnap.docs
          .map((d) => ({ id: d.id, name: String(d.data().name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );

      // "My team" detection: prefer authed_teams (server-derived) once
      // the token doc is loaded; fall back to player_id lookup. We do
      // a best-effort player query here too so the radio label can
      // populate before the token doc reads.
      if (user) {
        try {
          const playerSnap = await getDocs(
            query(
              collection(db, `leagues/${leagueId}/players`),
              where("auth_uid", "==", user.uid),
            ),
          );
          if (cancelled) return;
          const tid = playerSnap.docs[0]?.data()?.team_id;
          if (typeof tid === "string" && tid) setMyTeamId(tid);
        } catch {
          /* best effort */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, user]);

  // Load existing token doc when we have a token.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      setDocState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const db = getDb();
      const snap = await getDoc(
        doc(db, `notification_tokens/${token}_${leagueId}`),
      );
      if (cancelled) return;
      if (snap.exists()) {
        const data = snap.data();
        setDocState({
          categories: (Array.isArray(data.categories)
            ? data.categories
            : DEFAULT_CATEGORIES) as NotificationCategory[],
          teams: Array.isArray(data.teams) ? data.teams.map(String) : [],
          is_admin: data.is_admin === true,
          is_captain_authed: data.is_captain_authed === true,
          authed_teams: Array.isArray(data.authed_teams)
            ? data.authed_teams.map(String)
            : [],
        });
        // Server's authed_teams is more authoritative — pin myTeamId
        // from there if present.
        if (
          Array.isArray(data.authed_teams) &&
          data.authed_teams.length > 0
        ) {
          setMyTeamId(String(data.authed_teams[0]));
        }
      } else {
        setDocState({
          categories: DEFAULT_CATEGORIES,
          teams: [],
          is_admin: false,
          is_captain_authed: false,
          authed_teams: [],
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, leagueId]);

  // Reverse-derive the active team-mode radio from teams[] state,
  // matching DVSL notifications.html:965-977:
  //   length 0                          → 'all'
  //   length 1 && [0] === myTeamId      → 'mine'
  //   else                              → 'custom'
  const teamMode: TeamMode = useMemo(() => {
    if (!docState) return "all";
    if (docState.teams.length === 0) return "all";
    if (
      docState.teams.length === 1 &&
      myTeamId &&
      docState.teams[0] === myTeamId
    ) {
      return "mine";
    }
    return "custom";
  }, [docState, myTeamId]);

  const myTeamName = useMemo(() => {
    if (!myTeamId) return null;
    return teamOptions.find((t) => t.id === myTeamId)?.name ?? null;
  }, [myTeamId, teamOptions]);

  async function callRegister(patch: {
    token: string;
    categories?: NotificationCategory[];
    teams?: string[];
  }): Promise<boolean> {
    if (!user) return false;
    setError(null);
    setSaving(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/register-notification-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ leagueId, ...patch }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Save failed");
        return false;
      }
      const data = (await res.json()) as {
        is_admin?: boolean;
        is_captain_authed?: boolean;
        authed_teams?: string[];
      };
      setDocState((cur) =>
        cur
          ? {
              ...cur,
              ...(patch.categories ? { categories: patch.categories } : {}),
              ...(patch.teams !== undefined ? { teams: patch.teams } : {}),
              is_admin: data.is_admin === true,
              is_captain_authed: data.is_captain_authed === true,
              authed_teams: Array.isArray(data.authed_teams)
                ? data.authed_teams
                : cur.authed_teams,
            }
          : null,
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onEnable() {
    setBusyEnable(true);
    setError(null);
    try {
      const result = await enablePushAndGetToken();
      if (!result.ok) {
        if (result.reason === "permission_denied") {
          setError(
            "Notifications are blocked. Open browser settings, allow them for this site, then click Enable again.",
          );
        } else if (result.reason === "no_vapid_key") {
          setError(
            "Notifications coming soon! Push notifications are being set up. Check back after the admin configures push notifications in the Firebase Console.",
          );
        } else if (result.reason === "unsupported") {
          setError(
            "This browser doesn't support push notifications. Try Chrome, Safari (iOS 16.4+ as a home-screen app), or Firefox.",
          );
        } else {
          setError("Couldn't get a push token. Try again in a moment.");
        }
        return;
      }
      setCachedToken(result.token!);
      setToken(result.token!);
      await callRegister({ token: result.token! });
      if (typeof Notification !== "undefined") setPerm(Notification.permission);
    } finally {
      setBusyEnable(false);
    }
  }

  async function onDisable() {
    setBusyDisable(true);
    setError(null);
    try {
      await disablePush();
      setCachedToken(null);
      setToken(null);
      setDocState(null);
      // Note: the /notification_tokens doc is intentionally left in
      // place. If the user re-enables on this device later they get a
      // fresh FCM token (and a new doc id), so the old doc becomes
      // unreachable from this device — the dead-token prune in the
      // send endpoint cleans it up the next time someone tries to
      // push to it. We don't expose a "delete server-side row" path
      // because it would require a second API endpoint and the prune
      // is self-healing.
    } finally {
      setBusyDisable(false);
    }
  }

  function toggleCategory(cat: NotificationCategory) {
    if (!docState || !token) return;
    const next = docState.categories.includes(cat)
      ? docState.categories.filter((c) => c !== cat)
      : [...docState.categories, cat];
    callRegister({ token, categories: next });
  }

  function setTeamMode(mode: TeamMode) {
    if (!docState || !token) return;
    if (mode === "all") {
      callRegister({ token, teams: [] });
    } else if (mode === "mine") {
      if (!myTeamId) return;
      callRegister({ token, teams: [myTeamId] });
    } else {
      // custom — preserve existing teams[]; if it's empty (coming from
      // 'all'), seed with myTeamId so the user has a starting point.
      // Otherwise leave whatever they had so toggling all → custom →
      // mine → custom doesn't lose their picks.
      if (docState.teams.length > 0) return;
      if (myTeamId) callRegister({ token, teams: [myTeamId] });
      else {
        // No detectable team — just flip to a non-empty list with one
        // dummy entry that the user will replace. Use the first team
        // option so the UI renders.
        const seed = teamOptions[0]?.id;
        if (seed) callRegister({ token, teams: [seed] });
      }
    }
  }

  function toggleTeam(teamId: string) {
    if (!docState || !token) return;
    const next = docState.teams.includes(teamId)
      ? docState.teams.filter((t) => t !== teamId)
      : [...docState.teams, teamId];
    callRegister({ token, teams: next });
  }

  // ── Render ────────────────────────────────────────────────────────
  if (supported === null) {
    return (
      <div className="cap-tab">
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="cap-tab">
      <div className="cap-section-head">
        <h2 className="cap-section-title">Notifications</h2>
        <p className="cap-section-sub">
          Get a push when scores post, schedules shift, or your team
          chat lights up. Toggle which categories you care about — you
          can come back any time.
        </p>
      </div>

      {/* Status badge — visible whenever we know the support state. */}
      <div className="notif-status-row">
        <span
          className={
            "notif-status-badge " +
            (token ? "notif-status-on" : "notif-status-off")
          }
        >
          {token
            ? "● Notifications enabled"
            : iosNeedsPwa
              ? "○ Install app to enable"
              : "○ Notifications disabled"}
        </span>
      </div>

      {error && <div className="cap-error-banner">{error}</div>}

      {!supported ? (
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>Push notifications aren't supported here.</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.5,
                }}
              >
                Try Chrome, Firefox, or — on iPhone — Safari with this
                site added to your home screen (iOS 16.4 or later).
              </p>
            </div>
          </div>
        </div>
      ) : iosNeedsPwa && !token ? (
        // iOS PWA install banner — verbatim copy from DVSL spec §4
        // ("iOS-PWA-required banner"). Push subscription on iOS only
        // works inside an installed home-screen app.
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>🔔 Install the app to enable push notifications</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.6,
                }}
              >
                On iPhone: tap the <strong>Share</strong> button in
                Safari, then <strong>"Add to Home Screen."</strong>
                <br />
                On Android: tap the browser menu, then{" "}
                <strong>"Install app."</strong>
                <br />
                Push only works once installed.
              </p>
            </div>
          </div>
        </div>
      ) : !token || !docState ? (
        <div className="cap-pending-card">
          <div className="cap-pending-row">
            <div>
              <strong>Enable push notifications</strong>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  margin: "6px 0 0",
                  lineHeight: 1.5,
                }}
              >
                We'll ping you for the categories you pick — game
                results, schedule changes, team chat, and more. Your
                browser will ask for permission first.
              </p>
            </div>
            <button
              type="button"
              className="le-cap-btn-primary"
              disabled={busyEnable || perm === "denied"}
              onClick={onEnable}
            >
              {busyEnable
                ? "Enabling…"
                : perm === "denied"
                  ? "Blocked"
                  : "Enable Notifications"}
            </button>
          </div>
        </div>
      ) : loading ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading prefs…</p>
      ) : (
        <>
          {/* ── Categories ───────────────────────────────────── */}
          <h3 className="cap-section-h3">Categories</h3>
          <p
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginTop: -6,
              marginBottom: 10,
            }}
          >
            Pick what you want pinged about. Captains chat is opt-in;
            you only see it if you're a captain.
          </p>
          <div className="notif-cats">
            {CATEGORY_DISPLAY_ORDER.map((cat) => {
              // Hide captains_chat for non-captains, admin for non-admins
              // (matches DVSL's auth-aware reveal pattern).
              if (cat === "captains_chat" && !docState.is_captain_authed)
                return null;
              if (cat === "admin" && !docState.is_admin) return null;
              const checked = docState.categories.includes(cat);
              return (
                <label
                  key={cat}
                  className="notif-cat-row"
                  style={{ opacity: saving ? 0.7 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving}
                    onChange={() => toggleCategory(cat)}
                  />
                  <div className="notif-cat-text">
                    <span className="notif-cat-label">
                      {CATEGORY_LABELS[cat]}
                    </span>
                    <span className="notif-cat-sub">
                      {CATEGORY_SUBLABELS[cat]}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          {/* ── Team picker (3 modes: all / mine / custom) ──── */}
          <h3 className="cap-section-h3" style={{ marginTop: 24 }}>
            Which teams?
          </h3>
          <div className="notif-team-mode">
            <label className="notif-radio">
              <input
                type="radio"
                name="team-mode"
                checked={teamMode === "all"}
                disabled={saving}
                onChange={() => setTeamMode("all")}
              />
              <div className="notif-radio-text">
                <span className="notif-radio-label">All teams</span>
                <span className="notif-radio-sub">
                  Get score updates and league alerts for every team
                </span>
              </div>
            </label>
            {myTeamId && (
              <label className="notif-radio">
                <input
                  type="radio"
                  name="team-mode"
                  checked={teamMode === "mine"}
                  disabled={saving}
                  onChange={() => setTeamMode("mine")}
                />
                <div className="notif-radio-text">
                  <span className="notif-radio-label">
                    Just my team{myTeamName ? ` — ${myTeamName}` : ""}
                  </span>
                  <span className="notif-radio-sub">
                    Only my team's scores, schedule changes, and chat
                  </span>
                </div>
              </label>
            )}
            <label className="notif-radio">
              <input
                type="radio"
                name="team-mode"
                checked={teamMode === "custom"}
                disabled={saving}
                onChange={() => setTeamMode("custom")}
              />
              <div className="notif-radio-text">
                <span className="notif-radio-label">
                  Custom — pick teams
                </span>
                <span className="notif-radio-sub">
                  Follow specific teams (e.g. friends' teams, your kid's
                  team)
                </span>
              </div>
            </label>
          </div>
          {teamMode === "custom" && (
            <div className="notif-team-list">
              {teamOptions.map((t) => (
                <label key={t.id} className="notif-team-row">
                  <input
                    type="checkbox"
                    checked={docState.teams.includes(t.id)}
                    disabled={saving}
                    onChange={() => toggleTeam(t.id)}
                  />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
          )}

          {saving && (
            <p
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginTop: 14,
              }}
            >
              Saving…
            </p>
          )}

          <p
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginTop: 22,
              lineHeight: 1.5,
            }}
          >
            Notifications are tied to <strong>this device</strong>. If
            you sign in on another phone or browser, enable
            notifications there too.
          </p>

          {/* ── Disable button (DVSL post-enable footer) ────── */}
          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              className="le-cap-btn-secondary"
              disabled={busyDisable || saving}
              onClick={onDisable}
            >
              {busyDisable ? "Disabling…" : "Disable Notifications"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
