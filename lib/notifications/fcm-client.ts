"use client";

// Browser-side FCM helper: registers the service worker, requests
// notification permission, fetches the current FCM token, and hands
// it to /api/register-notification-token (which stamps `leagueId` and
// the server-derived trust fields).
//
// Verbatim port of softball-site/notifications.html:993-1100 except for
// the multi-tenant `leagueId` requirement (we ALWAYS pass leagueId on
// register; DVSL is single-tenant so it didn't have to).
//
// SSR-safe: every call returns early on the server. The functions
// in this module assume they're called from a "use client" component
// inside an event handler, not during render.

import { getFirebaseApp } from "@/lib/firebase";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  type Messaging,
} from "firebase/messaging";

const SW_PATH = "/firebase-messaging-sw.js";

let _msg: Messaging | null = null;
let _supportedCache: boolean | null = null;

/** Resolve once whether this browser supports FCM web push. */
export async function isPushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (_supportedCache !== null) return _supportedCache;
  try {
    _supportedCache = await isSupported();
  } catch {
    _supportedCache = false;
  }
  return _supportedCache;
}

function getMsg(): Messaging {
  if (_msg) return _msg;
  _msg = getMessaging(getFirebaseApp());
  return _msg;
}

/**
 * Register the FCM service worker. Idempotent — if a registration
 * already exists for the same scope, returns it.
 */
async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers not supported in this browser");
  }
  const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH);
}

export interface EnableResult {
  ok: boolean;
  reason?:
    | "unsupported"
    | "permission_denied"
    | "no_vapid_key"
    | "no_token";
  token?: string;
}

/**
 * One-shot "Enable notifications" button handler.
 *
 * Returns `{ ok: true, token }` on success — caller is then expected
 * to POST to /api/register-notification-token.
 */
export async function enablePushAndGetToken(): Promise<EnableResult> {
  if (!(await isPushSupported())) {
    return { ok: false, reason: "unsupported" };
  }

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    // Surfaced to the user as "ask the league admin to finish push setup."
    // Deliberately not a hard error — the prefs UI still loads so the
    // user can adjust categories that take effect on next register.
    return { ok: false, reason: "no_vapid_key" };
  }

  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  const reg = await ensureServiceWorker();
  const token = await getToken(getMsg(), {
    vapidKey,
    serviceWorkerRegistration: reg,
  });

  if (!token) {
    return { ok: false, reason: "no_token" };
  }
  return { ok: true, token };
}

/** Best-effort "Disable" — deletes the FCM token from the device.
 * The corresponding /notification_tokens doc is left intact (the user
 * can re-enable). The actual permission grant in browser settings is
 * NOT revoked — only the user can do that. */
export async function disablePush(): Promise<void> {
  if (!(await isPushSupported())) return;
  try {
    await deleteToken(getMsg());
  } catch {
    // Non-fatal — token may already be invalid.
  }
}

const TOKEN_KEY = "leagueplatform:fcm-token";

export function getCachedToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setCachedToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing / quota — ignore */
  }
}
