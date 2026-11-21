import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { StudioFile } from "@/types/file";
import {
  clearAllFiles as idbClearAll,
  createFileId,
  deleteFile as idbDelete,
  getActiveId,
  loadAllFiles,
  saveFile as idbSave,
  setActiveId,
} from "@/utils/storage";
import { deleteDocumentAssets, putDocumentAsset } from "@/utils/documentAssets";
import {
  bytesToBlob,
  isSvg3dxzFileName,
  openSvg3dxzBytes,
  packageDisplayName,
} from "@/utils/svg3dxz";

function normalizeName(name: string): string {
  return name.trim() || "untitled.svg3dx";
}

export const useFilesStore = defineStore("files", () => {
  const files = ref<StudioFile[]>([]);
  const activeId = ref<string | null>(null);
  const ready = ref(false);
  const loading = ref(false);

  const activeFile = computed(
    () => files.value.find((f) => f.id === activeId.value) ?? null
  );
  const isEmpty = computed(() => files.value.length === 0);

  async function hydrate(): Promise<void> {
    loading.value = true;
    try {
      files.value = await loadAllFiles();
      const saved = getActiveId();
      if (saved && files.value.some((f) => f.id === saved)) {
        activeId.value = saved;
      } else {
        activeId.value = files.value[0]?.id ?? null;
        setActiveId(activeId.value);
      }
    } finally {
      ready.value = true;
      loading.value = false;
    }
  }

  function select(id: string): void {
    if (!files.value.some((f) => f.id === id)) return;
    activeId.value = id;
    setActiveId(id);
  }

  async function upsertFromText(
    name: string,
    content: string,
    opts?: { select?: boolean; id?: string; documentBaseUrl?: string }
  ): Promise<StudioFile> {
    const now = Date.now();
    const existing = opts?.id
      ? files.value.find((f) => f.id === opts.id)
      : files.value.find((f) => f.name === name);

    let file: StudioFile;
    if (existing) {
      file = {
        ...existing,
        name: normalizeName(name),
        content,
        updatedAt: now,
        dirty: false,
        documentBaseUrl:
          opts?.documentBaseUrl !== undefined
            ? opts.documentBaseUrl
            : existing.documentBaseUrl,
      };
      files.value = files.value.map((f) => (f.id === file.id ? file : f));
    } else {
      file = {
        id: opts?.id ?? createFileId(),
        name: normalizeName(name),
        content,
        updatedAt: now,
        dirty: false,
        documentBaseUrl: opts?.documentBaseUrl,
      };
      files.value = [file, ...files.value];
    }

    await idbSave(file);
    if (opts?.select !== false) {
      activeId.value = file.id;
      setActiveId(file.id);
    }
    return file;
  }

  async function addBrowserFiles(list: FileList | File[]): Promise<StudioFile[]> {
    const arr = Array.from(list).filter(
      (f) => /\.(svg|svg3dx)$/i.test(f.name) || isSvg3dxzFileName(f.name)
    );
    if (!arr.length) return [];

    const created: StudioFile[] = [];
    for (const f of arr) {
      if (isSvg3dxzFileName(f.name)) {
        const opened = await openSvg3dxzBytes(await f.arrayBuffer());
        // Empty base URL: sidecars come from the package via documentAssets, not HTTP.
        // XML-only packages (no sidecars) are valid.
        const file = await upsertFromText(packageDisplayName(f.name), opened.mainXml, {
          select: false,
          documentBaseUrl: "",
        });
        // Replace assets atomically so a re-drop does not keep stale blobs.
        await deleteDocumentAssets(file.id);
        for (const asset of opened.assets) {
          const mime = asset.path.toLowerCase().endsWith(".gltf")
            ? "model/gltf+json"
            : "model/gltf-binary";
          await putDocumentAsset(
            file.id,
            asset.path,
            bytesToBlob(asset.bytes, mime),
            mime
          );
        }
        created.push(file);
      } else {
        const text = await f.text();
        created.push(await upsertFromText(f.name, text, { select: false }));
      }
    }
    if (created.length) {
      activeId.value = created[0].id;
      setActiveId(created[0].id);
    }
    return created;
  }

  async function updateContent(id: string, content: string, dirty = true): Promise<void> {
    const target = files.value.find((f) => f.id === id);
    if (!target) return;
    const next: StudioFile = {
      ...target,
      content,
      updatedAt: Date.now(),
      dirty,
    };
    files.value = files.value.map((f) => (f.id === id ? next : f));
    if (!dirty) await idbSave(next);
  }

  async function persist(id: string): Promise<StudioFile | null> {
    const target = files.value.find((f) => f.id === id);
    if (!target) return null;
    const next: StudioFile = { ...target, dirty: false, updatedAt: Date.now() };
    files.value = files.value.map((f) => (f.id === id ? next : f));
    await idbSave(next);
    return next;
  }

  async function rename(id: string, name: string): Promise<void> {
    const target = files.value.find((f) => f.id === id);
    if (!target) return;
    const next: StudioFile = {
      ...target,
      name: normalizeName(name),
      updatedAt: Date.now(),
    };
    files.value = files.value.map((f) => (f.id === id ? next : f));
    await idbSave(next);
  }

  async function remove(id: string): Promise<void> {
    files.value = files.value.filter((f) => f.id !== id);
    await deleteDocumentAssets(id);
    await idbDelete(id);
    if (activeId.value === id) {
      activeId.value = files.value[0]?.id ?? null;
      setActiveId(activeId.value);
    }
  }

  async function clearAll(): Promise<void> {
    for (const f of files.value) {
      await deleteDocumentAssets(f.id);
    }
    await idbClearAll();
    files.value = [];
    activeId.value = null;
    setActiveId(null);
  }

  function getById(id: string): StudioFile | undefined {
    return files.value.find((f) => f.id === id);
  }

  return {
    files,
    activeId,
    activeFile,
    isEmpty,
    ready,
    loading,
    hydrate,
    select,
    upsertFromText,
    addBrowserFiles,
    updateContent,
    persist,
    rename,
    remove,
    clearAll,
    getById,
  };
});
