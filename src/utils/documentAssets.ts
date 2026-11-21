/**
 * Local sidecar assets for a Studio document (e.g. `assets/foo.glb`).
 * Stored in IndexedDB; exposed to the viewer as blob: URL map.
 */

import { ASSETS_STORE, idbTxDone, openStudioDb } from "@/utils/storage";

export type DocumentAssetRecord = {
  /** `${fileId}::${path}` */
  key: string;
  fileId: string;
  path: string;
  mime: string;
  blob: Blob;
  updatedAt: number;
};

const objectUrlByKey = new Map<string, string>();

function assetKey(fileId: string, path: string): string {
  return `${fileId}::${normalizeAssetPath(path)}`;
}

/** Normalize to forward-slash relative path without leading `./`. */
export function normalizeAssetPath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

export function defaultAssetHref(fileName: string): string {
  const base = fileName.replace(/^.*[/\\]/, "") || "model.glb";
  return normalizeAssetPath(`assets/${base}`);
}

function revokeKey(key: string): void {
  const url = objectUrlByKey.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrlByKey.delete(key);
  }
}

export async function putDocumentAsset(
  fileId: string,
  path: string,
  file: Blob,
  mime?: string
): Promise<string> {
  const normalized = normalizeAssetPath(path);
  const key = assetKey(fileId, normalized);
  const record: DocumentAssetRecord = {
    key,
    fileId,
    path: normalized,
    mime: mime || file.type || "model/gltf-binary",
    blob: file,
    updatedAt: Date.now(),
  };
  const db = await openStudioDb();
  const tx = db.transaction(ASSETS_STORE, "readwrite");
  tx.objectStore(ASSETS_STORE).put(record);
  await idbTxDone(tx);
  revokeKey(key);
  return normalized;
}

export async function listDocumentAssets(
  fileId: string
): Promise<DocumentAssetRecord[]> {
  const db = await openStudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSETS_STORE, "readonly");
    const idx = tx.objectStore(ASSETS_STORE).index("fileId");
    const req = idx.getAll(fileId);
    req.onsuccess = () => resolve((req.result as DocumentAssetRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDocumentAssets(fileId: string): Promise<void> {
  const list = await listDocumentAssets(fileId);
  const db = await openStudioDb();
  const tx = db.transaction(ASSETS_STORE, "readwrite");
  const store = tx.objectStore(ASSETS_STORE);
  for (const rec of list) {
    store.delete(rec.key);
    revokeKey(rec.key);
  }
  await idbTxDone(tx);
}

/** Build relative-path → blob: URL map for the viewer. */
export async function buildDocumentAssetUrls(
  fileId: string
): Promise<Record<string, string>> {
  const list = await listDocumentAssets(fileId);
  const map: Record<string, string> = {};
  for (const rec of list) {
    let url = objectUrlByKey.get(rec.key);
    if (!url) {
      url = URL.createObjectURL(rec.blob);
      objectUrlByKey.set(rec.key, url);
    }
    map[rec.path] = url;
  }
  return map;
}

/**
 * Keep assets whose relative path appears in the document markup
 * (avoids packing blobs left behind after undo / href edits).
 */
export function filterAssetsReferencedInContent(
  content: string,
  assets: DocumentAssetRecord[]
): DocumentAssetRecord[] {
  return assets.filter((a) => {
    if (content.includes(a.path)) return true;
    try {
      return content.includes(encodeURI(a.path));
    } catch {
      return false;
    }
  });
}

export function pickGltfFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function isGltfFileName(name: string): boolean {
  return /\.(glb|gltf)$/i.test(name);
}
