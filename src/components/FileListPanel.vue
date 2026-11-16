<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  ClearIcon,
  DeleteIcon,
  Edit1Icon,
  FileIcon,
  FolderOpenIcon,
} from "tdesign-icons-vue-next";
import { MessagePlugin, DialogPlugin } from "tdesign-vue-next";
import { useI18n } from "@/i18n";
import type { StudioFile } from "@/types/file";
import { useFilesStore } from "@/stores/files";
import FileDropZone from "./FileDropZone.vue";

const props = withDefaults(
  defineProps<{
    files: StudioFile[];
    activeId: string | null;
    loadingSamples?: boolean;
  }>(),
  { loadingSamples: false }
);

const emit = defineEmits<{
  select: [id: string];
  files: [FileList | File[]];
  "fetch-samples": [];
}>();

const store = useFilesStore();
const router = useRouter();
const { t, locale } = useI18n();

const sorted = computed(() =>
  [...props.files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )
);

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(locale.value === "zh" ? "zh-CN" : "en-US");
}

function onEdit(id: string): void {
  router.push({ name: "edit", params: { id } });
}

async function onRemove(file: StudioFile): Promise<void> {
  const dialog = DialogPlugin.confirm({
    header: t("browse.removeFileHeader"),
    body: t("browse.removeFileBody", { name: file.name }),
    confirmBtn: t("browse.removeFileConfirm"),
    theme: "danger",
    onConfirm: async () => {
      await store.remove(file.id);
      MessagePlugin.success(t("browse.removed"));
      dialog.destroy();
    },
  });
}

function onClearAll(): void {
  if (!props.files.length) return;
  const count = props.files.length;
  const dialog = DialogPlugin.confirm({
    header: t("browse.clearCacheHeader"),
    body: t("browse.clearCacheBody", { n: count }),
    confirmBtn: t("browse.clearCacheConfirm"),
    theme: "danger",
    // Close first: clearing empties the list and unmounts this panel,
    // which can strand an async onConfirm (confirm appears to do nothing).
    onConfirm: () => {
      dialog.hide();
      void store
        .clearAll()
        .then(() => {
          MessagePlugin.success(t("browse.clearedCache"));
        })
        .catch((e) => {
          MessagePlugin.error(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          dialog.destroy();
        });
    },
  });
}
</script>

<template>
  <aside class="file-list-panel">
    <div class="panel-head">
      <span class="panel-title">{{ t("browse.files") }}</span>
      <div class="panel-head-right">
        <span class="count">{{ files.length }}</span>
        <t-tooltip :content="t('browse.clearCacheTooltip')">
          <t-button
            size="small"
            variant="text"
            theme="danger"
            :disabled="!files.length"
            @click="onClearAll"
          >
            <template #icon><ClearIcon /></template>
            {{ t("browse.clearCache") }}
          </t-button>
        </t-tooltip>
      </div>
    </div>

    <FileDropZone compact class="drop-inline" @files="emit('files', $event)" />
    <div class="sample-extra">
      <t-link
        theme="primary"
        :disabled="loadingSamples"
        @click="emit('fetch-samples')"
      >
        <template #prefix-icon><FolderOpenIcon /></template>
        {{
          loadingSamples
            ? t("browse.fetchingSamples")
            : t("browse.fetchSamples")
        }}
      </t-link>
    </div>

    <ul class="list">
      <li
        v-for="file in sorted"
        :key="file.id"
        class="item"
        :class="{ active: file.id === activeId }"
        @click="emit('select', file.id)"
      >
        <FileIcon class="file-icon" />
        <div class="meta">
          <div class="name" :title="file.name">
            {{ file.name }}
            <span v-if="file.dirty" class="dirty">•</span>
          </div>
          <div class="time">
            {{ formatTime(file.updatedAt) }}
          </div>
        </div>
        <div class="actions" @click.stop>
          <t-tooltip :content="t('browse.edit')">
            <t-button
              shape="square"
              variant="text"
              size="small"
              @click="onEdit(file.id)"
            >
              <template #icon><Edit1Icon /></template>
            </t-button>
          </t-tooltip>
          <t-tooltip :content="t('browse.removeFile')">
            <t-button
              shape="square"
              variant="text"
              size="small"
              theme="danger"
              @click="onRemove(file)"
            >
              <template #icon><DeleteIcon /></template>
            </t-button>
          </t-tooltip>
        </div>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.file-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--studio-panel);
  border-right: 1px solid var(--studio-line);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 8px;
}

.panel-head-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--studio-ink);
}

.count {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: 999px;
  padding: 1px 8px;
}

.drop-inline {
  margin: 0 12px 0;
  width: auto !important;
}

.sample-extra {
  display: flex;
  justify-content: center;
  padding: 8px 12px 10px;
  font-size: 13px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0 8px 12px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}

.item {
  display: grid;
  grid-template-columns: 20px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px 8px;
  border-radius: 8px;
  color: var(--td-text-color-primary);
  cursor: pointer;
  transition: background 0.12s ease;
}

.item:hover {
  background: var(--td-bg-color-container-hover);
}

.item.active {
  background: var(--td-brand-color-light);
}

.file-icon {
  color: var(--td-brand-color);
}

.meta {
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty {
  color: var(--td-warning-color);
  margin-left: 2px;
}

.time {
  font-size: 11px;
  color: var(--td-text-color-secondary);
  margin-top: 2px;
}

.actions {
  display: flex;
  opacity: 0.55;
}

.item:hover .actions,
.item.active .actions {
  opacity: 1;
}
</style>
