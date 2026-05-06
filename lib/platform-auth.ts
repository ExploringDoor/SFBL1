// Server-side helper for platform-admin gating.
//
// Distinct from the per-tenant `admin` claim that lets a commissioner
// run their own league's /admin page. Platform admins (currently:
// Adam, eventually a small team) get to see EVERY tenant via
// /_platform — billing state, error stream, recent writes — and need
// a stronger gate than a per-tenant claim.
//
// The list is read from PLATFORM_ADMIN_UIDS env var (comma-separated
// Firebase Auth UIDs). If the env var is unset, NO ONE is treated as
// platform admin — fail closed. The route should refuse rather than
// silently grant access if the env is missing.
//
// To find your UID for first-time setup:
//   1. Sign in once at /login on prod
//   2. In Firebase Console → Auth → find your email → copy the UID
//   3. Add to Vercel env: PLATFORM_ADMIN_UIDS=your_uid_here
//   4. Redeploy
//
// Multi-admin: PLATFORM_ADMIN_UIDS=uid_a,uid_b — supports comma-list.

export function platformAdminUids(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_UIDS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean),
  );
}

export function isPlatformAdmin(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return platformAdminUids().has(uid);
}
