/**
 * Local sidecar assets for a Studio document (e.g. `assets/foo.glb`).
 * Stored in IndexedDB; exposed to the viewer as blob: URL map.
 */

import { ASSETS_STORE, idbTxDone, openStudioDb } from "@/utils/storage";
import { bytesToBlob } from "@/utils/svg3dxz";

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

export function mimeForAssetPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".bin")) return "application/octet-stream";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ktx2")) return "image/ktx2";
  return "application/octet-stream";
}

export type PackageAssetInput = {
  path: string;
  bytes: Uint8Array | ArrayBuffer | Blob;
};

/** Canonical entry path inside a `.svg3dxz` package (matches core `MAIN_ENTRY`). */
export const PACKAGE_MAIN_ENTRY = "main.svg3dx";

/** One node in a package / sidecar path tree (folders have children). */
export type AssetPathTreeNode = {
  name: string;
  /** Relative path from package / document root. */
  path: string;
  children?: AssetPathTreeNode[];
};

/**
 * Build a folder tree from flat relative paths (e.g. `assets/bunny.glb`).
 * Folders sort before files; siblings are locale-sorted by name.
 */
export function buildAssetPathTree(paths: string[]): AssetPathTreeNode[] {
  type Mutable = {
    name: string;
    path: string;
    children?: Map<string, Mutable>;
  };
  const root = new Map<string, Mutable>();

  for (const raw of paths) {
    const parts = normalizeAssetPath(raw).split("/").filter(Boolean);
    if (!parts.length) continue;
    let cursor = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      acc = acc ? `${acc}/${part}` : part;
      let node = cursor.get(part);
      if (!node) {
        node = { name: part, path: acc };
        cursor.set(part, node);
      }
      if (i < parts.length - 1) {
        if (!node.children) node.children = new Map();
        cursor = node.children;
      }
    }
  }

  function toList(map: Map<string, Mutable>): AssetPathTreeNode[] {
    return [...map.values()]
      .sort((a, b) => {
        const aDir = !!a.children;
        const bDir = !!b.children;
        if (aDir !== bDir) return aDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({
        name: n.name,
        path: n.path,
        children: n.children ? toList(n.children) : undefined,
      }));
  }

  return toList(root);
}

/**
 * Paths shown under the Resources tree for a document.
 * Packages always include `main.svg3dx`; sidecars follow in path order.
 */
export function packageTreePaths(
  assetPaths: string[],
  isPackage: boolean
): string[] {
  const sidecars = [
    ...new Set(assetPaths.map(normalizeAssetPath).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  if (!isPackage) return sidecars;
  return [
    PACKAGE_MAIN_ENTRY,
    ...sidecars.filter((p) => p !== PACKAGE_MAIN_ENTRY),
  ];
}

/** Replace all sidecars for a document with the given package assets. */
export async function ingestPackageAssets(
  fileId: string,
  assets: PackageAssetInput[]
): Promise<void> {
  await deleteDocumentAssets(fileId);
  for (const asset of assets) {
    const mime = mimeForAssetPath(asset.path);
    let blob: Blob;
    if (asset.bytes instanceof Blob) {
      blob = asset.bytes;
    } else if (asset.bytes instanceof Uint8Array) {
      blob = bytesToBlob(asset.bytes, mime);
    } else {
      blob = bytesToBlob(new Uint8Array(asset.bytes), mime);
    }
    await putDocumentAsset(fileId, asset.path, blob, mime);
  }
}
