"use client";

import { useEffect, useState } from "react";
import { accessFromClaim, type AdminAccess } from "@/lib/admin-roles";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  sendPasswordResetEmail,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

// localStorage key used to remember the email between "send link" and the
// magic-link click on a (possibly different) device. Per Firebase docs.
const PENDING_EMAIL_KEY = "leagueplatform:pendingMagicLinkEmail";

// When a magic link is requested from an iOS PWA, tapping the link
// opens Safari (Apple won't let it land back in the standalone
// PWA). To get the user signed in inside the PWA too, we generate a
// bridgeId here, encode it into the magic-link's continue URL, and
// the PWA polls /api/auth-bridge/claim for the resulting custom
// token. See app/api/auth-bridge/{create,claim}/route.ts.
//
// `bridgeId` is a UUID v4 created by the caller (LoginPage). When
// provided, we append it to the finishUrl as ?bridge=<id> so
// /login/finish can complete the bridge handoff after sign-in.
export async function sendMagicLink(
  email: string,
  bridgeId?: string,
): Promise<void> {
  const auth = getFirebaseAuth();
  const base = `${window.location.origin}/login/finish`;
  const finishUrl = bridgeId
    ? `${base}?bridge=${encodeURIComponent(bridgeId)}`
    : base;
  await sendSignInLinkToEmail(auth, email, {
    url: finishUrl,
    handleCodeInApp: true,
  });
  window.localStorage.setItem(PENDING_EMAIL_KEY, email);
}

// Email + password sign-in (coach "own login"). Coaches get an account
// when they register their team and set a password; after that they sign
// in here from any device. The session persists like any Firebase login.
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<User> {
  const result = await signInWithEmailAndPassword(
    getFirebaseAuth(),
    email.trim(),
    password,
  );
  return result.user;
}

// "Forgot password" — Firebase emails a reset link. (Registration + the
// initial set-password email go through our own Resend sender; this
// client-side reset is the self-serve fallback from the login page.)
export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim(), {
    url: `${window.location.origin}/login`,
  });
}

// Sign the local Firebase Auth instance into the same uid that
// completed the bridged sign-in in Safari. Called by the PWA after
// the claim endpoint returns a token.
export async function signInWithBridgeToken(token: string): Promise<User> {
  const result = await signInWithCustomToken(getFirebaseAuth(), token);
  return result.user;
}

// Module-level dedup. React Strict Mode (Next dev) runs useEffect twice
// on mount; without this guard, the second call tries to consume an
// already-used magic-link code and the user sees `auth/invalid-action-code`
// even though the sign-in actually succeeded. Scoped to a single page
// load — full navigation away resets module state.
let _signInPromise: Promise<User> | null = null;

export function completeSignIn(): Promise<User> {
  if (_signInPromise) return _signInPromise;
  _signInPromise = (async () => {
    const auth = getFirebaseAuth();
    const link = window.location.href;
    if (!isSignInWithEmailLink(auth, link)) {
      throw new Error("This URL is not a valid sign-in link.");
    }
    let email = window.localStorage.getItem(PENDING_EMAIL_KEY);
    if (!email) {
      // Fallback: the click happened on a different device than the request.
      email = window.prompt("Confirm your email to finish signing in:") ?? "";
    }
    if (!email) throw new Error("Email required to complete sign-in.");
    const result = await signInWithEmailLink(auth, email, link);
    window.localStorage.removeItem(PENDING_EMAIL_KEY);
    return result.user;
  })();
  // If the in-flight call rejects, clear the cache so a retry can happen.
  _signInPromise.catch(() => {
    _signInPromise = null;
  });
  return _signInPromise;
}

export async function signOut(): Promise<void> {
  await fbSignOut(getFirebaseAuth());
}

// Reactively track the current Firebase user. `undefined` means "not yet
// resolved" (initial render); `null` means "no user signed in".
export function useUser(): User | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);
  return user;
}

export type LeagueRole = "admin" | "captain" | "player" | "none" | "loading";

// Reactively read the role for a specific league from the user's ID
// token claims. Returns "loading" until claims resolve. Calls
// `getIdTokenResult(user, true)` once after sign-in to force a refresh,
// because newly-set custom claims aren't in the cached token.
/** Admin access for one league, including SCOPED roles.
 *
 *  Separate from useLeagueRole rather than folded into it, deliberately.
 *  useLeagueRole answers "admin | captain | player | none" and the captain
 *  portal and several pages branch on it; teaching it to call a scoped
 *  assistant "admin" would quietly hand her whatever those pages gate on.
 *  This hook answers a different question and only the admin page asks it.
 *
 *  Returns "loading" until the token resolves, then an AdminAccess whose
 *  `full` is false and whose `scopes` is empty for anyone with no admin claim
 *  at all, so callers can treat "no access" and "some access" uniformly. */
export function useAdminAccess(
  leagueId: string | null,
): AdminAccess | "loading" {
  const user = useUser();
  const [access, setAccess] = useState<AdminAccess | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    if (!leagueId || user === null) {
      setAccess(accessFromClaim(null));
      return;
    }
    if (user === undefined) {
      setAccess("loading");
      return;
    }
    (async () => {
      // Force-refresh for the same reason useLeagueRole does: a password typed
      // seconds ago has to work without a sign-out cycle.
      const result = await user.getIdTokenResult(true);
      if (cancelled) return;
      const leagues = (result.claims.leagues ?? {}) as Record<string, unknown>;
      setAccess(accessFromClaim(leagues[leagueId]));
    })();
    return () => {
      cancelled = true;
    };
  }, [user, leagueId]);

  return access;
}

export function useLeagueRole(leagueId: string | null): LeagueRole {
  const user = useUser();
  const [role, setRole] = useState<LeagueRole>("loading");

  useEffect(() => {
    let cancelled = false;
    if (!leagueId) {
      setRole("none");
      return;
    }
    if (user === undefined) {
      setRole("loading");
      return;
    }
    if (user === null) {
      setRole("none");
      return;
    }
    (async () => {
      // Force-refresh once so newly-issued claims propagate without a
      // sign-out / sign-in cycle.
      const result = await user.getIdTokenResult(true);
      if (cancelled) return;
      const leagues = (result.claims.leagues ?? {}) as Record<string, string>;
      const raw = leagues[leagueId];
      if (raw === "admin") setRole("admin");
      else if (typeof raw === "string" && raw.startsWith("captain:")) setRole("captain");
      else if (typeof raw === "string" && raw.startsWith("player:")) setRole("player");
      else setRole("none");
    })();
    return () => {
      cancelled = true;
    };
  }, [user, leagueId]);

  return role;
}

/**
 * Reactively read the team_id this user is captain of in a given
 * league. Returns `null` when the user isn't a captain (or claims
 * haven't loaded). Pulls the `captain:<team_id>` claim from the
 * user's ID token (claim shape defined in firestore.rules:30-34).
 *
 * Pair with useLeagueRole — role tells you the user IS a captain,
 * this tells you WHICH team they captain.
 */
export function useCaptainTeam(
  leagueId: string | null,
): { teamId: string | null; loading: boolean } {
  const user = useUser();
  const [state, setState] = useState<{
    teamId: string | null;
    loading: boolean;
  }>({ teamId: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    if (!leagueId || user === null) {
      setState({ teamId: null, loading: false });
      return;
    }
    if (user === undefined) {
      setState({ teamId: null, loading: true });
      return;
    }
    (async () => {
      const result = await user.getIdTokenResult(true);
      if (cancelled) return;
      const leagues = (result.claims.leagues ?? {}) as Record<string, string>;
      const raw = leagues[leagueId];
      if (typeof raw === "string" && raw.startsWith("captain:")) {
        setState({ teamId: raw.slice("captain:".length), loading: false });
      } else {
        setState({ teamId: null, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, leagueId]);

  return state;
}
