/**
 * Browser download helpers + backwards-compatible re-exports.
 * Persistence lives in `@/repos` (DocumentRepository / AssetRepository).
 */

export { createFileId } from "@/repos/ids";
export { openStudioDb, idbTxDone } from "@/repos/indexedDb";

/** @deprecated Use AssetRepository — IDB store name kept for legacy callers. */
export const ASSETS_STORE = "assets";

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
