import { ref, watch, type Ref } from "vue";
import {
  buildDocumentAssetUrls,
  defaultAssetHref,
  filterAssetsReferencedInContent,
  listDocumentAssets,
  pickGltfFile,
  putDocumentAsset,
  type DocumentAssetRecord,
} from "@/utils/documentAssets";

/**
 * Blob-URL map + attach/export helpers for the active Studio document.
 * Clears the map synchronously when `fileId` changes so hosts never bind the
 * previous document's sidecars during the async refresh window.
 */
export function useDocumentAssets(fileId: Ref<string | null | undefined>) {
  const documentAssetUrls = ref<Record<string, string>>({});
  let refreshSeq = 0;

  async function refreshDocumentAssetUrls(): Promise<void> {
    const id = fileId.value;
    const seq = ++refreshSeq;
    if (!id) {
      documentAssetUrls.value = {};
      return;
    }
    const next = await buildDocumentAssetUrls(id);
    // Ignore stale refreshes after a fast file switch.
    if (seq !== refreshSeq || fileId.value !== id) return;
    documentAssetUrls.value = next;
  }

  function clearDocumentAssetUrls(): void {
    refreshSeq++;
    documentAssetUrls.value = {};
  }

  watch(
    fileId,
    (id, prev) => {
      if (id === prev) return;
      // Drop previous map immediately; refresh fills the new one.
      clearDocumentAssetUrls();
      if (id) void refreshDocumentAssetUrls();
    }
  );

  /** Pick a local .glb/.gltf, store beside the document, return relative href. */
  async function pickAndAttachGltf(): Promise<string | null> {
    const id = fileId.value;
    if (!id) return null;
    const picked = await pickGltfFile();
    if (!picked) return null;
    const href = defaultAssetHref(picked.name);
    await putDocumentAsset(id, href, picked);
    await refreshDocumentAssetUrls();
    return href;
  }

  async function listReferencedAssets(
    content: string
  ): Promise<DocumentAssetRecord[]> {
    const id = fileId.value;
    if (!id) return [];
    const all = await listDocumentAssets(id);
    return filterAssetsReferencedInContent(content, all);
  }

  return {
    documentAssetUrls,
    refreshDocumentAssetUrls,
    clearDocumentAssetUrls,
    pickAndAttachGltf,
    listReferencedAssets,
  };
}
