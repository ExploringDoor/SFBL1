"use client";

// Header profile chip. If signed in, shows email + sign-out menu trigger;
// otherwise shows a "Sign in" button. Uses existing useUser hook.

import Link from "next/link";
import { signOut, useUser } from "@/lib/auth-client";

export function ProfileButton({ tenantId }: { tenantId: string }) {
  const user = useUser();

  if (user === undefined) {
    // Loading state — placeholder so the header doesn't reflow.
    return (
      <div className="h-8 w-20 animate-pulse rounded-md bg-slate-100" aria-hidden />
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

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/admin"
        className="rounded-md bg-brand-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-on-primary hover:opacity-90"
      >
        ◉ {user.email?.split("@")[0] ?? "Profile"}
      </Link>
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
