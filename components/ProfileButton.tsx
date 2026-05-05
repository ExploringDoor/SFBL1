"use client";

// Header profile chip. Three states:
//   - signed out → "Sign in" pill
//   - signed in, captain → "Captain" + email + sign-out
//   - signed in, admin   → "Admin" + email + sign-out
//   - signed in, other   → email + sign-out
//
// Each link is rendered as a separate small pill so the user can tell
// at a glance what privileges they have in the active league.

import Link from "next/link";
import { signOut, useLeagueRole, useUser } from "@/lib/auth-client";
import { NotificationBell } from "@/components/notifications/NotificationBell";

export function ProfileButton({ tenantId }: { tenantId: string }) {
  const user = useUser();
  const role = useLeagueRole(tenantId);

  if (user === undefined) {
    return (
      <div
        className="h-8 w-20 animate-pulse rounded-md bg-slate-100"
        aria-hidden
      />
    );
  }

  if (user === null) {
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
      <Link
        href="/profile"
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-700 hover:bg-slate-50"
        title="Profile (notifications, availability, team chat)"
      >
        Profile
      </Link>
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
