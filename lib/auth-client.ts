"use client";

import { useEffect, useState } from "react";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebase";

// localStorage key used to remember the email between "send link" and the
// magic-link click on a (possibly different) device. Per Firebase docs.
const PENDING_EMAIL_KEY = "leagueplatform:pendingMagicLinkEmail";

export async function sendMagicLink(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  const finishUrl = `${window.location.origin}/login/finish`;
  await sendSignInLinkToEmail(auth, email, {
    url: finishUrl,
    handleCodeInApp: true,
  });
  window.localStorage.setItem(PENDING_EMAIL_KEY, email);
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
