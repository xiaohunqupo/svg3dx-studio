import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createFileId } from "@/repos/ids";
import { getDocumentRepository } from "@/repos/runtime";
import type { StudioDocument } from "@/repos/types";
import {
  deleteDocumentAssets,
  ingestPackageAssets,
} from "@/utils/documentAssets";
import {
  isSvg3dxzFileName,
  openSvg3dxzBytes,
  packageDisplayName,
} from "@/utils/svg3dxz";

function normalizeName(name: string): string {
  return name.trim() || "untitled.svg3dx";
}

async function readActiveId(): Promise<string | null> {
  const repo = getDocumentRepository();
  if (!repo.getActiveId) return null;
  return await repo.getActiveId();
}

async function writeActiveId(id: string | null): Promise<void> {
  const repo = getDocumentRepository();
  if (!repo.setActiveId) return;
  await repo.setActiveId(id);
}

export const useFilesStore = defineStore("files", () => {
  const files = ref<StudioDocument[]>([]);
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
      const repo = getDocumentRepository();
      files.value = await repo.list();
      const saved = await readActiveId();
      if (saved && files.value.some((f) => f.id === saved)) {
        activeId.value = saved;
      } else {
        activeId.value = files.value[0]?.id ?? null;
        await writeActiveId(activeId.value);
      }
    } finally {
      ready.value = true;
      loading.value = false;
    }
  }

  async function select(id: string): Promise<void> {
    if (!files.value.some((f) => f.id === id)) return;
    activeId.value = id;
    await writeActiveId(id);
  }

  async function upsertFromText(
    name: string,
    content: string,
    opts?: { select?: boolean; id?: string; documentBaseUrl?: string }
  ): Promise<StudioDocument> {
    const repo = getDocumentRepository();
    const now = Date.now();
    const existing = opts?.id
      ? files.value.find((f) => f.id === opts.id)
      : files.value.find((f) => f.name === name);

    let file: StudioDocument;
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

    await repo.save(file);
    if (opts?.select !== false) {
      activeId.value = file.id;
      await writeActiveId(file.id);
    }
    return file;
  }

  async function addBrowserFiles(
    list: FileList | File[]
  ): Promise<StudioDocument[]> {
    const arr = Array.from(list).filter(
      (f) => /\.(svg|svg3dx)$/i.test(f.name) || isSvg3dxzFileName(f.name)
    );
    if (!arr.length) return [];

    const created: StudioDocument[] = [];
    for (const f of arr) {
      if (isSvg3dxzFileName(f.name)) {
        const opened = await openSvg3dxzBytes(await f.arrayBuffer());
        // Empty base URL: sidecars come from the package via documentAssets, not HTTP.
        const file = await upsertFromText(
          packageDisplayName(f.name),
          opened.mainXml,
          {
            select: false,
            documentBaseUrl: "",
          }
        );
        await ingestPackageAssets(file.id, opened.assets);
        created.push(file);
      } else {
        const text = await f.text();
        created.push(await upsertFromText(f.name, text, { select: false }));
      }
    }
    if (created.length) {
      activeId.value = created[0].id;
      await writeActiveId(created[0].id);
    }
    return created;
  }

  async function updateContent(
    id: string,
    content: string,
    dirty = true
  ): Promise<void> {
    const target = files.value.find((f) => f.id === id);
    if (!target) return;
    const next: StudioDocument = {
      ...target,
      content,
      updatedAt: Date.now(),
      dirty,
    };
    files.value = files.value.map((f) => (f.id === id ? next : f));
    if (!dirty) await getDocumentRepository().save(next);
  }

  async function persist(id: string): Promise<StudioDocument | null> {
    const target = files.value.find((f) => f.id === id);
    if (!target) return null;
    const next: StudioDocument = {
      ...target,
      dirty: false,
      updatedAt: Date.now(),
    };
    files.value = files.value.map((f) => (f.id === id ? next : f));
    await getDocumentRepository().save(next);
    return next;
  }

  async function rename(id: string, name: string): Promise<void> {
    const target = files.value.find((f) => f.id === id);
    if (!target) return;
    const next: StudioDocument = {
      ...target,
      name: normalizeName(name),
      updatedAt: Date.now(),
    };
    files.value = files.value.map((f) => (f.id === id ? next : f));
    await getDocumentRepository().save(next);
  }

  async function remove(id: string): Promise<void> {
    files.value = files.value.filter((f) => f.id !== id);
    await deleteDocumentAssets(id);
    await getDocumentRepository().remove(id);
    if (activeId.value === id) {
      activeId.value = files.value[0]?.id ?? null;
      await writeActiveId(activeId.value);
    }
  }

  async function clearAll(): Promise<void> {
    const repo = getDocumentRepository();
    for (const f of files.value) {
      await deleteDocumentAssets(f.id);
    }
    if (repo.clearAll) {
      await repo.clearAll();
    } else {
      for (const f of [...files.value]) {
        await repo.remove(f.id);
      }
    }
    files.value = [];
    activeId.value = null;
    await writeActiveId(null);
  }

  function getById(id: string): StudioDocument | undefined {
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
