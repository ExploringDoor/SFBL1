"use client";

// Header profile chip. States:
//   - signed out, passwordless tenant (SFBL/LBDC) → a single "Profile"
//     button that asks "Captain or Player?" and routes to the right
//     sign-in (/captain password gate, or /login for players). Admin
//     is NOT here — it lives in the More nav menu (Adam, 2026-05-18).
//   - signed out, regular tenant → "Sign in" → /login (magic link).
//   - signed in, captain (passwordless) → "Captain" + sign-out (no
//     separate Profile — the captain portal is their one home).
//   - signed in, player/other → "Profile" + sign-out.
//
// Each link is a small pill so the user can tell at a glance what
// they can reach in the active league.

import { useState } from "react";
import Link from "next/link";
import { signOut, useLeagueRole, useUser } from "@/lib/auth-client";
import { useTenant } from "@/lib/tenant-context";
import { NotificationBell } from "@/components/notifications/NotificationBell";

export function ProfileButton({ tenantId }: { tenantId: string }) {
  const user = useUser();
  const role = useLeagueRole(tenantId);
  const { config } = useTenant();
  const captainPasswordless = config?.captain?.passwordless === true;

  if (user === undefined) {
    return (
      <div
        className="h-8 w-20 animate-pulse rounded-md bg-slate-100"
        aria-hidden
      />
    );
  }

  if (user === null) {
    // Passwordless tenants: one "Profile" entry → Captain / Player
    // chooser. (Admin is in the More menu now.)
    if (captainPasswordless) {
      return <AccessChooser />;
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
      {/* Hide the separate "Profile" link for passwordless captains —
          they sign in as a team identity, not a personal player, so
          the player Profile page is empty for them. Players and
          magic-link captains still get it. */}
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

// Signed-out entry for passwordless tenants. A "Profile" button that
// opens a small menu asking whether you're a captain or a player, then
// sends you to the matching sign-in (Adam, 2026-05-18).
function AccessChooser() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-primary hover:opacity-90"
      >
        👤 Profile
      </button>
      {open && (
        <>
          {/* Tap-outside backdrop */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Sign in as…
            </p>
            <Link
              href="/captain"
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              ⚾ Captain / Manager
            </Link>
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
            >
              🙋 Player
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
