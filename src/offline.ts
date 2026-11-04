// Offline copies of papers the user has opened (IndexedDB, this device only).
// Files: storage path → PDF bytes. Data: small JSON results (question details, markscheme pages, progress).
// Everything is wiped on logout, when another person signs in, and when access is removed.

import { tr } from "./i18n";

const DB_NAME = "pf-offline";
const USER_KEY = "pf-offline-user";
let dbp: Promise<IDBDatabase> | null = null;

/** Storage paths of the files saved on this device (kept in memory for the "Available offline" badge). */
export const offlineFiles = new Set<string>();

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files");
      req.result.createObjectStore("json");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

async function run<T>(store: "files" | "json", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const supported = () => typeof indexedDB !== "undefined";

export async function initOffline(): Promise<void> {
  if (!supported()) return;
  try {
    const keys = await run("files", "readonly", (s) => s.getAllKeys());
    offlineFiles.clear();
    for (const k of keys) offlineFiles.add(String(k));
  } catch {
    /* private mode or blocked storage: offline copies are simply off */
  }
}

export async function getFile(path: string): Promise<ArrayBuffer | undefined> {
  if (!supported()) return undefined;
  try {
    return (await run<ArrayBuffer | undefined>("files", "readonly", (s) => s.get(path))) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function putFile(path: string, bytes: ArrayBuffer): Promise<void> {
  if (!supported() || !currentUser) return;
  try {
    await run("files", "readwrite", (s) => s.put(bytes.slice(0), path));
    offlineFiles.add(path);
  } catch {
    /* storage full or blocked: ignore */
  }
}

export async function deleteFile(path: string): Promise<void> {
  offlineFiles.delete(path);
  if (!supported()) return;
  try {
    await run("files", "readwrite", (s) => s.delete(path));
  } catch {
    /* ignore */
  }
}

export async function getJson<T>(key: string): Promise<T | undefined> {
  if (!supported()) return undefined;
  try {
    return (await run<T | undefined>("json", "readonly", (s) => s.get(key))) ?? undefined;
  } catch {
    return undefined;
  }
}

async function putJson(key: string, value: unknown): Promise<void> {
  if (!supported() || !currentUser) return;
  try {
    await run("json", "readwrite", (s) => s.put(JSON.parse(JSON.stringify(value)), key));
  } catch {
    /* ignore */
  }
}

/** Deletes every offline copy on this device. */
export async function clearOffline(): Promise<void> {
  offlineFiles.clear();
  try {
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
  if (!supported()) return;
  try {
    await run("files", "readwrite", (s) => s.clear());
    await run("json", "readwrite", (s) => s.clear());
  } catch {
    /* ignore */
  }
}

let currentUser: string | null = null;

/**
 * Called after the profile is known. Only approved people keep offline copies, and only their own:
 * a different person signing in on this device starts from an empty cache.
 */
export async function setOfflineUser(userId: string | null, approved: boolean): Promise<void> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(USER_KEY);
  } catch {
    /* ignore */
  }
  if (!userId || !approved) {
    currentUser = null;
    if (saved || offlineFiles.size) await clearOffline();
    return;
  }
  if (saved && saved !== userId) await clearOffline();
  currentUser = userId;
  try {
    localStorage.setItem(USER_KEY, userId);
  } catch {
    /* ignore */
  }
}

export function offlineUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e instanceof TypeError) return true;
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|offline/i.test(msg);
}

/** Loads from the network and saves a copy; without a connection, returns the saved copy. */
export async function withOffline<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const c = await getJson<T>(key);
    if (c !== undefined) return c;
  }
  try {
    const v = await load();
    void putJson(key, v);
    return v;
  } catch (e) {
    if (isNetworkError(e)) {
      const c = await getJson<T>(key);
      if (c !== undefined) return c;
      throw new Error(tr("You're offline, and this hasn't been opened on this device before.", "No tienes conexión y esto no se ha abierto antes en este dispositivo."));
    }
    throw e;
  }
}

