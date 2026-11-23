import type {
  AssetListItem,
  AssetRepository,
  DocumentRepository,
  StudioDocument,
} from "./types";

const DB_NAME = "svg3dx-studio";
const DB_VERSION = 2;
const FILES_STORE = "files";
const ASSETS_STORE = "assets";
const ACTIVE_KEY = "svg3dx-studio:active-id";

type DocumentAssetRecord = {
  key: string;
  fileId: string;
  path: string;
  mime: string;
  blob: Blob;
  updatedAt: number;
};

function assetKey(fileId: string, path: string): string {
  return `${fileId}::${path}`;
}

function normalizeAssetPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function openStudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "id" });
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

/** @deprecated Prefer createIndexedDbDocumentRepository — kept for internal IDB helpers. */
export const STUDIO_ASSETS_STORE = ASSETS_STORE;

export function createIndexedDbDocumentRepository(): DocumentRepository {
  return {
    async list(): Promise<StudioDocument[]> {
      const db = await openStudioDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, "readonly");
        const req = tx.objectStore(FILES_STORE).getAll();
        req.onsuccess = () => {
          const list = (req.result as StudioDocument[]).sort(
            (a, b) => b.updatedAt - a.updatedAt
          );
          resolve(list);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async get(id: string): Promise<StudioDocument | null> {
      const db = await openStudioDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(FILES_STORE, "readonly");
        const req = tx.objectStore(FILES_STORE).get(id);
        req.onsuccess = () =>
          resolve((req.result as StudioDocument | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    },

    async save(doc: StudioDocument): Promise<StudioDocument> {
      const db = await openStudioDb();
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).put(doc);
      await idbTxDone(tx);
      return doc;
    },

    async remove(id: string): Promise<void> {
      const db = await openStudioDb();
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).delete(id);
      await idbTxDone(tx);
    },

    getActiveId(): string | null {
      try {
        return localStorage.getItem(ACTIVE_KEY);
      } catch {
        return null;
      }
    },

    setActiveId(id: string | null): void {
      try {
        if (id) localStorage.setItem(ACTIVE_KEY, id);
        else localStorage.removeItem(ACTIVE_KEY);
      } catch {
        /* ignore */
      }
    },

    async clearAll(): Promise<void> {
      const db = await openStudioDb();
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).clear();
      await idbTxDone(tx);
    },
  };
}

export function createIndexedDbAssetRepository(): AssetRepository {
  async function listRecords(fileId: string): Promise<DocumentAssetRecord[]> {
    const db = await openStudioDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ASSETS_STORE, "readonly");
      const idx = tx.objectStore(ASSETS_STORE).index("fileId");
      const req = idx.getAll(fileId);
      req.onsuccess = () =>
        resolve((req.result as DocumentAssetRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async list(fileId: string): Promise<AssetListItem[]> {
      const records = await listRecords(fileId);
      return records.map((r) => ({ path: r.path, mime: r.mime }));
    },

    async read(fileId: string, path: string): Promise<Blob | null> {
      const normalized = normalizeAssetPath(path);
      const db = await openStudioDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(ASSETS_STORE, "readonly");
        const req = tx.objectStore(ASSETS_STORE).get(assetKey(fileId, normalized));
        req.onsuccess = () => {
          const rec = req.result as DocumentAssetRecord | undefined;
          resolve(rec?.blob ?? null);
        };
        req.onerror = () => reject(req.error);
      });
    },

    async write(
      fileId: string,
      path: string,
      blob: Blob,
      mime?: string
    ): Promise<void> {
      const normalized = normalizeAssetPath(path);
      const record: DocumentAssetRecord = {
        key: assetKey(fileId, normalized),
        fileId,
        path: normalized,
        mime: mime || blob.type || "model/gltf-binary",
        blob,
        updatedAt: Date.now(),
      };
      const db = await openStudioDb();
      const tx = db.transaction(ASSETS_STORE, "readwrite");
      tx.objectStore(ASSETS_STORE).put(record);
      await idbTxDone(tx);
    },

    async removeAll(fileId: string): Promise<void> {
      const list = await listRecords(fileId);
      const db = await openStudioDb();
      const tx = db.transaction(ASSETS_STORE, "readwrite");
      const store = tx.objectStore(ASSETS_STORE);
      for (const rec of list) store.delete(rec.key);
      await idbTxDone(tx);
    },
  };
}
