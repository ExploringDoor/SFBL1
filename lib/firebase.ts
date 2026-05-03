import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from "firebase/firestore";

// Placeholder env vars — fill these in via .env.local before Phase 1.
// All NEXT_PUBLIC_* values are baked into the client bundle, so they are
// safe to expose (Firebase web config is not a secret).
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;
let _authEmulatorConnected = false;
let _dbEmulatorConnected = false;

function shouldUseEmulator(): boolean {
  return (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true"
  );
}

export function getFirebaseApp(): FirebaseApp {
  if (_app) return _app;
  _app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return _app;
}

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(getFirebaseApp());
  if (shouldUseEmulator() && !_authEmulatorConnected) {
    connectAuthEmulator(_auth, "http://127.0.0.1:9099", { disableWarnings: true });
    _authEmulatorConnected = true;
  }
  return _auth;
}

export function getDb(): Firestore {
  if (_db) return _db;
  _db = getFirestore(getFirebaseApp());
  if (shouldUseEmulator() && !_dbEmulatorConnected) {
    connectFirestoreEmulator(_db, "127.0.0.1", 8080);
    _dbEmulatorConnected = true;
  }
  return _db;
}
