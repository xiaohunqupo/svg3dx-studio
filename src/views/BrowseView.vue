<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Edit1Icon, FolderOpenIcon } from "tdesign-icons-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import FileDropZone from "@/components/FileDropZone.vue";
import FileListPanel from "@/components/FileListPanel.vue";
import SettingsMenu from "@/components/SettingsMenu.vue";
import BrowsePageSkeleton from "@/components/skeletons/BrowsePageSkeleton.vue";
import ViewportSkeleton from "@/components/skeletons/ViewportSkeleton.vue";
import ViewerHost from "@/components/ViewerHost.vue";
import { useI18n } from "@/i18n";
import { useFilesStore } from "@/stores/files";
import {
  fetchOfficialSamples,
  preferredSampleName,
} from "@/utils/officialSamples";

const store = useFilesStore();
const router = useRouter();
const { t } = useI18n();
const status = ref("");
const dragOverMain = ref(false);
const previewReady = ref(false);
const loadingSamples = ref(false);

const showEmpty = computed(() => store.ready && store.isEmpty);
const activeContent = computed(() => store.activeFile?.content ?? "");
const showPreviewSkeleton = computed(
  () => !!activeContent.value && !previewReady.value
);

onMounted(async () => {
  if (!store.ready) await store.hydrate();
});

watch(
  () => store.activeId,
  () => {
    previewReady.value = false;
  }
);

async function onFiles(list: FileList | File[]): Promise<void> {
  try {
    const created = await store.addBrowserFiles(list);
    if (!created.length) {
      MessagePlugin.warning(t("browse.noSvgFiles"));
      return;
    }
    const msg = t("browse.filesAdded", { n: created.length });
    status.value = msg;
    MessagePlugin.success(msg);
  } catch (e) {
    MessagePlugin.error(e instanceof Error ? e.message : String(e));
  }
}

async function loadSample(): Promise<void> {
  if (loadingSamples.value) return;
  loadingSamples.value = true;
  try {
    status.value = t("browse.fetchingSamplesStatus");
    const samples = await fetchOfficialSamples();
    for (const sample of samples) {
      await store.upsertFromText(sample.name, sample.content, { select: false });
    }
    const preferred = preferredSampleName(samples);
    const active = store.files.find((f) => f.name === preferred);
    if (active) store.select(active.id);
    const msg = t("browse.samplesLoaded", { n: samples.length });
    status.value = msg;
    MessagePlugin.success(msg);
  } catch (e) {
    MessagePlugin.error(e instanceof Error ? e.message : String(e));
    status.value = String(e);
  } finally {
    loadingSamples.value = false;
  }
}

async function goEdit(): Promise<void> {
  const id = store.activeId;
  if (!id) {
    MessagePlugin.warning(t("browse.selectFileFirst"));
    return;
  }
  await router.push(`/edit/${id}`);
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
      <div class="brand">
        <img class="logo" src="/logo.png" alt="svg3dx studio" width="28" height="28" />
        <span class="product">svg3dx Studio</span>
      </div>
      <div class="actions">
        <SettingsMenu />
        <t-button
          v-if="!showEmpty"
          theme="primary"
          :disabled="!store.activeId"
          @click="goEdit"
        >
          <template #icon><Edit1Icon /></template>
          {{ t("browse.editCurrent") }}
        </t-button>
      </div>
      <div class="status">{{ status || (store.activeFile?.name ?? "") }}</div>
    </header>

    <BrowsePageSkeleton v-if="!store.ready" />

    <div v-else-if="showEmpty" class="empty-stage">
      <FileDropZone @files="onFiles" />
      <div class="empty-extra">
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
    </div>

    <div
      v-else
      class="workspace"
      :class="{ 'drag-over': dragOverMain }"
      @dragenter.prevent="dragOverMain = true"
      @dragover.prevent="dragOverMain = true"
      @dragleave.prevent="dragOverMain = false"
      @drop.prevent="onMainDrop"
    >
      <FileListPanel
        class="sidebar"
        :files="store.files"
        :active-id="store.activeId"
        :loading-samples="loadingSamples"
        @select="store.select"
        @files="onFiles"
        @fetch-samples="loadSample"
      />
      <main class="viewport">
        <div v-if="dragOverMain" class="drop-mask">{{ t("browse.dropToAdd") }}</div>
        <ViewportSkeleton v-if="showPreviewSkeleton" />
        <ViewerHost
          v-if="activeContent"
          :key="store.activeId ?? 'preview'"
          :content="activeContent"
          @error="(m) => (status = m)"
          @result="
            (r) => {
              previewReady = true;
              status = `${store.activeFile?.name ?? ''} · ${r.instructions.length} groups`;
            }
          "
        />
        <div v-else class="viewport-empty">{{ t("browse.selectToPreview") }}</div>
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
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--studio-panel);
  border-bottom: 1px solid var(--studio-line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo {
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 4px;
}

.product {
  font-weight: 600;
  font-size: 15px;
}

.actions {
  display: flex;
  gap: 8px;
}

.status {
  margin-left: auto;
  font-size: 12px;
  color: var(--studio-muted);
  max-width: 42%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background:
    radial-gradient(1200px 500px at 50% 0%, var(--studio-empty-top) 0%, transparent 60%),
    linear-gradient(180deg, var(--studio-empty-mid) 0%, var(--studio-empty-bot) 100%);
}

.empty-extra {
  font-size: 13px;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 0;
  position: relative;
}

.sidebar {
  min-height: 0;
}

.viewport {
  position: relative;
  min-height: 0;
  background: var(--studio-viewport);
  overflow: hidden;
}

.viewport-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--studio-muted);
}

.drop-mask {
  position: absolute;
  inset: 12px;
  z-index: 5;
  display: grid;
  place-items: center;
  border: 2px dashed var(--studio-accent);
  border-radius: 12px;
  background: var(--studio-drop-mask);
  color: var(--studio-accent);
  font-weight: 600;
  pointer-events: none;
}

.workspace.drag-over .viewport {
  filter: brightness(0.98);
}
</style>
