import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { createFileId } from "@/repos/ids";
import { getDocumentRepository } from "@/repos/runtime";
import type { StudioDocument } from "@/repos/types";
import {
  deleteDocumentAssets,
  ingestPackageAssets,
  listDocumentAssets,
  putDocumentAsset,
} from "@/utils/documentAssets";
import {
  EMPTY_DOCUMENT_TEMPLATE,
  ensureDocumentFileName,
  nextCopyFileName,
  nextUntitledName,
} from "@/utils/emptyDocument";
import {
  isSvg3dxzFileName,
  openSvg3dxzBytes,
  packageDisplayName,
} from "@/utils/svg3dxz";

function normalizeName(name: string): string {
  return name.trim() || "untitled.svg3dx";
}

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export class FileNameConflictError extends Error {
  readonly conflictingId: string;
  readonly conflictingName: string;

  constructor(conflictingId: string, conflictingName: string) {
    super(`name already exists: ${conflictingName}`);
    this.name = "FileNameConflictError";
    this.conflictingId = conflictingId;
    this.conflictingName = conflictingName;
  }
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

  function findByName(name: string): StudioDocument | undefined {
    return files.value.find((f) => namesEqual(f.name, name));
  }

  function assertUniqueName(name: string): string {
    const normalized = normalizeName(name);
    const existing = findByName(normalized);
    if (existing) {
      throw new FileNameConflictError(existing.id, existing.name);
    }
    return normalized;
  }

  async function insertNewDocument(
    name: string,
    content: string,
    opts?: { select?: boolean; documentBaseUrl?: string }
  ): Promise<StudioDocument> {
    const repo = getDocumentRepository();
    const file: StudioDocument = {
      id: createFileId(),
      name: assertUniqueName(name),
      content,
      updatedAt: Date.now(),
      dirty: false,
      documentBaseUrl: opts?.documentBaseUrl,
    };
    files.value = [file, ...files.value];
    await repo.save(file);
    if (opts?.select !== false) {
      activeId.value = file.id;
      await writeActiveId(file.id);
    }
    return file;
  }

  /**
   * Create a new library document. Never overwrites by name.
   * Omitting `name` picks the next `untitled.svg3dx`.
   */
  async function createDocument(opts?: {
    name?: string;
    content?: string;
    select?: boolean;
  }): Promise<StudioDocument> {
    const name = opts?.name?.trim()
      ? ensureDocumentFileName(opts.name)
      : nextUntitledName(files.value.map((f) => f.name));
    return insertNewDocument(
      name,
      opts?.content?.trim() ? opts.content : EMPTY_DOCUMENT_TEMPLATE,
      { select: opts?.select }
    );
  }

  /** Copy a document and its sidecar assets under a new id. */
  async function duplicateDocument(
    sourceId: string,
    opts?: { name?: string; select?: boolean }
  ): Promise<StudioDocument> {
    const source = files.value.find((f) => f.id === sourceId);
    if (!source) throw new Error(`file not found: ${sourceId}`);
    const name = opts?.name?.trim()
      ? ensureDocumentFileName(opts.name)
      : nextCopyFileName(
          source.name,
          files.value.map((f) => f.name)
        );
    const file = await insertNewDocument(name, source.content, {
      select: opts?.select,
      documentBaseUrl: source.documentBaseUrl,
    });
    const assets = await listDocumentAssets(sourceId);
    for (const asset of assets) {
      await putDocumentAsset(file.id, asset.path, asset.blob, asset.mime);
    }
    return file;
  }

  /**
   * Import XML or a `.svg3dxz` package into the library without overwriting.
   * Pass `bytes` for packages (and optional plain XML); `content` for loose XML.
   */
  async function importDocument(opts: {
    name: string;
    content?: string;
    bytes?: ArrayBuffer | Uint8Array;
    select?: boolean;
  }): Promise<StudioDocument> {
    const rawName = opts.name.trim() || "import.svg3dx";
    if (isSvg3dxzFileName(rawName)) {
      if (!opts.bytes) {
        throw new Error("svg3dxz import requires package bytes");
      }
      const opened = await openSvg3dxzBytes(opts.bytes);
      const file = await insertNewDocument(
        packageDisplayName(rawName),
        opened.mainXml,
        {
          select: opts.select,
          documentBaseUrl: "",
        }
      );
      await ingestPackageAssets(file.id, opened.assets);
      return file;
    }

    let content = opts.content;
    if (!content && opts.bytes) {
      content = new TextDecoder().decode(opts.bytes);
    }
    if (!content?.trim()) {
      throw new Error("import requires content or bytes");
    }
    return insertNewDocument(ensureDocumentFileName(rawName), content, {
      select: opts.select,
    });
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
    const normalized = ensureDocumentFileName(normalizeName(name));
    const clash = findByName(normalized);
    if (clash && clash.id !== id) {
      throw new FileNameConflictError(clash.id, clash.name);
    }
    const next: StudioDocument = {
      ...target,
      name: normalized,
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
    findByName,
    createDocument,
    duplicateDocument,
    importDocument,
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
