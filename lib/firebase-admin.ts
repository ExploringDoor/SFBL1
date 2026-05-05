// Server-side Admin SDK init. Used by Next API routes (e.g. /api/recalc)
// that need to bypass security rules and / or verify ID tokens.
//
// Two modes (auto-detected):
//   • Emulator: when FIRESTORE_EMULATOR_HOST or FIREBASE_AUTH_EMULATOR_HOST
//     is set (the firebase CLI sets these inside `emulators:exec`).
//   • Production: requires FIREBASE_SERVICE_ACCOUNT_PATH pointing at a
//     downloaded service account JSON.

import * as path from "node:path";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

const APP_NAME = "league-platform-server";

let _app: App | null = null;

export function getAdminApp(): App {
  if (_app) return _app;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) {
    _app = existing;
    return _app;
  }

  const useEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST,
  );

  const projectId = useEmulator
    ? process.env.GCLOUD_PROJECT ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
    : process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (!projectId) {
    throw new Error(
      "[firebase-admin] No project ID. Set NEXT_PUBLIC_FIREBASE_PROJECT_ID in .env.local.",
    );
  }

  if (useEmulator) {
    _app = initializeApp({ projectId }, APP_NAME);
    return _app;
  }

  // Production: accept credentials as either an inline JSON env var
  // (FIREBASE_SERVICE_ACCOUNT_JSON — used on Vercel where there's no
  // local filesystem to point at) OR a path to a JSON file
  // (FIREBASE_SERVICE_ACCOUNT_PATH — used in local dev where the JSON
  // is stashed under ./secrets/ and gitignored).
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  let credential;
  if (saJson) {
    try {
      credential = cert(JSON.parse(saJson));
    } catch (e) {
      throw new Error(
        "[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON didn't parse as JSON: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  } else if (saPath) {
    credential = cert(path.resolve(process.cwd(), saPath));
  } else {
    throw new Error(
      "[firebase-admin] No service account configured. Set either " +
        "FIREBASE_SERVICE_ACCOUNT_JSON (inline JSON, for Vercel) or " +
        "FIREBASE_SERVICE_ACCOUNT_PATH (file path, for local dev). " +
        "See .env.local.example.",
    );
  }
  _app = initializeApp({ credential, projectId }, APP_NAME);
  return _app;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getAdminMessaging(): Messaging {
  return getMessaging(getAdminApp());
}
