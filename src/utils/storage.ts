import type { StudioFile } from "@/types/file";

const DB_NAME = "svg3dx-studio";
const DB_VERSION = 2;
const STORE = "files";
/** Shared with `documentAssets.ts` — keep schema upgrades in one place. */
export const ASSETS_STORE = "assets";
const ACTIVE_KEY = "svg3dx-studio:active-id";

/** Open the studio IndexedDB (files + document assets). */
export function openStudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        const assets = db.createObjectStore(ASSETS_STORE, { keyPath: "key" });
        assets.createIndex("fileId", "fileId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

export function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB tx failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB tx aborted"));
  });
}

export async function loadAllFiles(): Promise<StudioFile[]> {
  const db = await openStudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = (req.result as StudioFile[]).sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveFile(file: StudioFile): Promise<void> {
  const db = await openStudioDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(file);
  await idbTxDone(tx);
}

export async function saveFiles(files: StudioFile[]): Promise<void> {
  const db = await openStudioDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const f of files) store.put(f);
  await idbTxDone(tx);
}

export async function deleteFile(id: string): Promise<void> {
  const db = await openStudioDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await idbTxDone(tx);
}

export async function clearAllFiles(): Promise<void> {
  const db = await openStudioDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await idbTxDone(tx);
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

export function createFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  let name = filename;
  if (/\.svg3dxz$/i.test(name)) name = name.replace(/\.svg3dxz$/i, ".svg3dx");
  else if (!/\.(svg|svg3dx)$/i.test(name)) name = `${name}.svg3dx`;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
