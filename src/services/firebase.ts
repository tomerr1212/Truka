import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getDatabase, Database } from 'firebase/database';
import { getAuth, Auth, signInAnonymously, setPersistence, browserSessionPersistence, inMemoryPersistence } from 'firebase/auth';

// ─── Firebase config ──────────────────────────────────────────────────────────
// Replace these values with your own Firebase project config.
// See: https://console.firebase.google.com → Project Settings → Your apps

const FIREBASE_CONFIG = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY            ?? '',
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN        ?? '',
  databaseURL:       process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL       ?? '',
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID         ?? '',
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET     ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID             ?? '',
};

// Singleton pattern — safe to call multiple times
let app: FirebaseApp;
let db: Database;
let auth: Auth;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
  }
  return app;
}

export function getDb(): Database {
  if (!db) db = getDatabase(getFirebaseApp());
  return db;
}

export function getFirebaseAuth(): Auth {
  if (!auth) auth = getAuth(getFirebaseApp());
  return auth;
}

export async function signInAnon(): Promise<string> {
  const firebaseAuth = getFirebaseAuth();

  // Use session-scoped persistence on web so each browser tab gets its own
  // anonymous identity. On native, fall back to in-memory (per-launch).
  // This is intentional for multiplayer testing: opening 3 tabs = 3 players.
  const persistence = typeof window !== 'undefined'
    ? browserSessionPersistence
    : inMemoryPersistence;

  await setPersistence(firebaseAuth, persistence);
  const cred = await signInAnonymously(firebaseAuth);
  return cred.user.uid;
}
