<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FolderOpenIcon } from "tdesign-icons-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import FileDropZone from "@/components/FileDropZone.vue";
import FileListPanel from "@/components/FileListPanel.vue";
import ReposMenu from "@/components/ReposMenu.vue";
import SettingsMenu from "@/components/SettingsMenu.vue";
import BrowsePageSkeleton from "@/components/skeletons/BrowsePageSkeleton.vue";
import ViewportSkeleton from "@/components/skeletons/ViewportSkeleton.vue";
import ViewerHost from "@/components/ViewerHost.vue";
import { useDocumentAssets } from "@/composables/useDocumentAssets";
import { useI18n } from "@/i18n";
import { useFilesStore } from "@/stores/files";
import {
  defaultAssetHref,
  ingestPackageAssets,
  isGltfFileName,
  putDocumentAsset,
} from "@/utils/documentAssets";
import {
  fetchOfficialSamples,
  preferredSampleName,
  supersededLooseNames,
} from "@/utils/officialSamples";
import { clearGltfCache } from "svg3dx-viewer";

withDefaults(
  defineProps<{
    /** Show official-samples fetch UI. */
    showOfficialSamples?: boolean;
    showReposMenu?: boolean;
    showSettingsMenu?: boolean;
  }>(),
  {
    showOfficialSamples: true,
    showReposMenu: true,
    showSettingsMenu: true,
  }
);

const SIDEBAR_W_KEY = "svg3dx.studio.browseSidebarWidth";
const SIDEBAR_W_MIN = 200;
const SIDEBAR_W_MAX = 480;
const SIDEBAR_W_DEFAULT = 280;

function readStoredWidth(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  } catch {
    /* ignore */
  }
  return fallback;
}

const store = useFilesStore();
const { t } = useI18n();
const dragOverMain = ref(false);
const previewReady = ref(false);
const loadingSamples = ref(false);
const sidebarWidth = ref(
  readStoredWidth(SIDEBAR_W_KEY, SIDEBAR_W_DEFAULT, SIDEBAR_W_MIN, SIDEBAR_W_MAX)
);
const resizing = ref(false);
const workspaceEl = ref<HTMLElement | null>(null);

const showEmpty = computed(() => store.ready && store.isEmpty);
const activeContent = computed(() => store.activeFile?.content ?? "");
const activeDocumentBaseUrl = computed(
  () => store.activeFile?.documentBaseUrl
);
const activeFileId = computed(() => store.activeId);
const {
  documentAssetUrls: previewAssetUrls,
  refreshDocumentAssetUrls: refreshPreviewAssets,
} = useDocumentAssets(activeFileId);
const showPreviewSkeleton = computed(
  () => !!activeContent.value && !previewReady.value
);
const workspaceStyle = computed(() => ({
  gridTemplateColumns: `${sidebarWidth.value}px 0px minmax(0, 1fr)`,
}));

function persistSidebarWidth(): void {
  try {
    localStorage.setItem(SIDEBAR_W_KEY, String(sidebarWidth.value));
  } catch {
    /* ignore */
  }
}

function onResizeMove(ev: PointerEvent): void {
  if (!resizing.value || !workspaceEl.value) return;
  const rect = workspaceEl.value.getBoundingClientRect();
  sidebarWidth.value = Math.min(
    SIDEBAR_W_MAX,
    Math.max(SIDEBAR_W_MIN, ev.clientX - rect.left)
  );
}

function stopResize(): void {
  if (!resizing.value) return;
  resizing.value = false;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  persistSidebarWidth();
}

function startResize(ev: PointerEvent): void {
  ev.preventDefault();
  resizing.value = true;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}

onMounted(async () => {
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
  if (!store.ready) await store.hydrate();
  await refreshPreviewAssets();
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
  stopResize();
  clearGltfCache();
});

watch(
  () => store.activeId,
  () => {
    previewReady.value = false;
    clearGltfCache();
    // Sidecar map clear/refresh is handled by useDocumentAssets(fileId).
  }
);

async function onFiles(list: FileList | File[]): Promise<void> {
  try {
    const arr = Array.from(list);
    const gltfs = arr.filter((f) => isGltfFileName(f.name));
    const docs = arr.filter(
      (f) => /\.(svg|svg3dx|svg3dxz)$/i.test(f.name)
    );

    // Documents first so a multi-drop of `.svg3dx` + `.glb` can attach to the new file.
    if (docs.length) {
      const created = await store.addBrowserFiles(docs);
      if (!created.length) {
        MessagePlugin.warning(t("browse.noSvgFiles"));
        return;
      }
      MessagePlugin.success(t("browse.filesAdded", { n: created.length }));
    }

    if (gltfs.length) {
      const targetId = store.activeId;
      if (!targetId) {
        MessagePlugin.warning(t("browse.gltfNeedsDocument"));
      } else {
        for (const f of gltfs) {
          await putDocumentAsset(targetId, defaultAssetHref(f.name), f);
        }
        MessagePlugin.success(
          t("app.gltfAttached", { name: gltfs.map((g) => g.name).join(", ") })
        );
      }
    }

    if (!docs.length && !gltfs.length) {
      MessagePlugin.warning(t("browse.noSvgFiles"));
      return;
    }
    await refreshPreviewAssets();
  } catch (e) {
    MessagePlugin.error(e instanceof Error ? e.message : String(e));
  }
}

async function loadSample(): Promise<void> {
  if (loadingSamples.value) return;
  loadingSamples.value = true;
  try {
    const samples = await fetchOfficialSamples();
    for (const sample of samples) {
      const file = await store.upsertFromText(sample.name, sample.content, {
        select: false,
        // Explicit empty clears a previous HTTP base when replacing with a package.
        documentBaseUrl: sample.documentBaseUrl ?? "",
      });
      await ingestPackageAssets(
        file.id,
        (sample.packageAssets ?? []).map((a) => ({
          path: a.path,
          bytes: a.blob,
        }))
      );
    }
    // Drop loose siblings superseded by a fetched `.svg3dxz` package.
    for (const looseName of supersededLooseNames(samples)) {
      const old = store.files.find((f) => f.name === looseName);
      if (old) await store.remove(old.id);
    }
    const preferred = preferredSampleName(samples);
    const active = store.files.find((f) => f.name === preferred);
    if (active) store.select(active.id);
    await refreshPreviewAssets();
    MessagePlugin.success(t("browse.samplesLoaded", { n: samples.length }));
  } catch (e) {
    MessagePlugin.error(e instanceof Error ? e.message : String(e));
  } finally {
    loadingSamples.value = false;
  }
}

function onMainDrop(e: DragEvent): void {
  dragOverMain.value = false;
  const list = e.dataTransfer?.files;
  if (list?.length) void onFiles(list);
}
</script>

<template>
  <div class="browse-page">
    <header class="topbar">
      <slot name="topbar-start">
        <div class="brand">
          <img class="logo" src="/logo.png" alt="svg3dx studio" width="22" height="22" />
          <span class="product">svg3dx Studio</span>
        </div>
      </slot>
      <div class="right">
        <slot name="topbar-end">
          <ReposMenu v-if="showReposMenu" />
          <SettingsMenu v-if="showSettingsMenu" />
        </slot>
      </div>
    </header>

    <BrowsePageSkeleton v-if="!store.ready" />

    <div v-else-if="showEmpty" class="empty-stage">
      <slot name="empty">
        <FileDropZone @files="onFiles" />
        <div v-if="showOfficialSamples" class="empty-extra">
          <t-link
            theme="primary"
            :disabled="loadingSamples"
            @click="loadSample"
          >
            <template #prefix-icon><FolderOpenIcon /></template>
            {{
              loadingSamples
                ? t("browse.fetchingSamples")
                : t("browse.fetchSamples")
            }}
          </t-link>
        </div>
      </slot>
    </div>

    <div
      v-else
      ref="workspaceEl"
      class="workspace"
      :class="{ 'drag-over': dragOverMain, resizing }"
      :style="workspaceStyle"
      @dragenter.prevent="dragOverMain = true"
      @dragover.prevent="dragOverMain = true"
      @dragleave.prevent="dragOverMain = false"
      @drop.prevent="onMainDrop"
    >
      <slot name="sidebar">
        <FileListPanel
          class="sidebar"
          :files="store.files"
          :active-id="store.activeId"
          :loading-samples="loadingSamples"
          :show-official-samples="showOfficialSamples"
          @select="store.select"
          @files="onFiles"
          @fetch-samples="loadSample"
        />
      </slot>
      <div
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="sidebarWidth"
        :title="t('app.resizePanel')"
        @pointerdown="startResize"
      />
      <main class="viewport">
        <slot name="viewport-chrome">
          <div v-if="dragOverMain" class="drop-mask">{{ t("browse.dropToAdd") }}</div>
          <ViewportSkeleton v-if="showPreviewSkeleton" />
          <ViewerHost
            v-if="activeContent"
            :key="store.activeId ?? 'preview'"
            :content="activeContent"
            :document-base-url="activeDocumentBaseUrl"
            :document-asset-urls="previewAssetUrls"
            @error="(m) => MessagePlugin.error(m)"
            @result="previewReady = true"
          />
          <div v-else class="viewport-empty">
            <t-empty :title="t('browse.selectToPreview')" />
          </div>
        </slot>
      </main>
    </div>
  </div>
</template>

<style scoped>
.browse-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.topbar {
  height: var(--svg3dx-studio-topbar-height, 40px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 6px;
}

.logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.product {
  font-weight: 600;
  font-size: 13px;
}

.right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.empty-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--td-bg-color-page);
}

.empty-extra {
  font-size: 13px;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 0px minmax(0, 1fr);
  min-height: 0;
  position: relative;
}

.workspace.resizing {
  cursor: col-resize;
}

.sidebar {
  min-width: 0;
  min-height: 0;
}

.resize-handle {
  position: relative;
  width: 0;
  margin: 0 -3px;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
}

.resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  background: transparent;
  transition: background 0.12s ease;
}

.resize-handle:hover::after,
.workspace.resizing .resize-handle::after {
  background: var(--td-brand-color-light);
}

.viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--td-bg-color-page);
  overflow: hidden;
}

.viewport-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--td-text-color-secondary);
}

.drop-mask {
  position: absolute;
  inset: 12px;
  z-index: 5;
  display: grid;
  place-items: center;
  border: 2px dashed var(--td-brand-color);
  border-radius: var(--td-radius-large);
  background: color-mix(in srgb, var(--td-bg-color-container) 88%, transparent);
  color: var(--td-brand-color);
  font-weight: 600;
  pointer-events: none;
}

.workspace.drag-over .viewport {
  filter: brightness(0.98);
}
</style>
