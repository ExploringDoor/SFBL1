"use client";

// Header profile chip. States:
//   - signed out, passwordless tenant (LBDC) → "Captain" + "Admin"
//     pills linking direct to /captain and /admin (each of which
//     renders its own password prompt). Users have no "account" to
//     sign in to here — the team-name / admin-password gates do all
//     the auth.
//   - signed out, regular tenant (SFBL)      → "Sign in" pill →
//     /login (magic link).
//   - signed in, captain → "Captain" + email + sign-out
//   - signed in, admin   → "Admin" + email + sign-out
//   - signed in, other   → email + sign-out
//
// Each link is rendered as a separate small pill so the user can tell
// at a glance what privileges they have in the active league.

import Link from "next/link";
import { signOut, useLeagueRole, useUser } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";
import { NotificationBell } from "@/components/notifications/NotificationBell";

export function ProfileButton({ tenantId }: { tenantId: string }) {
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const { config } = useTenant();
  const captainPasswordless = config?.captain?.passwordless === true;
  const adminPasswordless = config?.admin?.passwordless === true;

  if (user === undefined) {
    return (
      <div
        className="h-8 w-20 animate-pulse rounded-md bg-slate-100"
        aria-hidden
      />
    );
  }

  if (user === null) {
    // Passwordless tenants — show Captain / Admin pills directly so
    // visitors can reach the password gates without needing to know
    // the URLs. Each link renders its own gate (team-name for
    // /captain, shared-secret for /admin).
    if (captainPasswordless || adminPasswordless) {
      return (
        <div className="flex items-center gap-2">
          {captainPasswordless && (
            <Link
              href="/captain"
              className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-primary hover:opacity-90"
              title="Captain portal"
            >
              ⚾ Captain
            </Link>
          )}
          {adminPasswordless && (
            <Link
              href="/admin"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50"
              title="Admin"
            >
              ◉ Admin
            </Link>
          )}
        </div>
      );
    }
    return (
      <Link
        href="/login"
        className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-primary hover:opacity-90"
      >
        Sign in
      </Link>
    );
  }

  // Every signed-in user gets a Profile link — that's where
  // notifications + availability + team chat live for non-captains.
  // Captains also benefit (they can switch to player-mode availability
  // and notifications without leaving the role they're signed into).
  return (
    <div className="flex items-center gap-2">
      <NotificationBell leagueId={tenantId} />
      {role === "captain" && (
        <Link
          href="/captain"
          className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-primary hover:opacity-90"
          title="Captain portal"
        >
          ⚾ Captain
        </Link>
      )}
      {role === "admin" && (
        <Link
          href="/admin"
          className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-primary hover:opacity-90"
          title="Admin"
        >
          ◉ Admin
        </Link>
      )}
      {/* Hide the separate "Profile" link for passwordless captains
          (Adam, 2026-05-18): they sign in as a team identity, not a
          personal player, so the player Profile page (availability /
          account) is empty for them — their one home is the Captain
          portal. Players and magic-link captains still get Profile
          (it's their real personal page). */}
      {!(role === "captain" && captainPasswordless) && (
        <Link
          href="/profile"
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50"
          title="Profile (notifications, availability)"
        >
          Profile
        </Link>
      )}
      <span
        className="hidden text-xs text-slate-600 md:inline"
        title={user.email ?? undefined}
      >
        {user.email?.split("@")[0] ?? ""}
      </span>
      <button
        type="button"
        onClick={() => signOut().then(() => (window.location.href = "/"))}
        className="text-xs text-slate-500 hover:text-slate-900"
        aria-label="Sign out"
        title="Sign out"
      >
        ✕
      </button>
    </div>
  );
}
