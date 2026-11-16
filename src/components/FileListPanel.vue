<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  ClearIcon,
  DeleteIcon,
  Edit1Icon,
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

/** Destructive confirm: red confirm, cancel as safer default (TDesign danger pattern). */
function openDangerConfirm(options: {
  header: string;
  body: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
}): void {
  const dialog = DialogPlugin.confirm({
    header: options.header,
    body: options.body,
    theme: "danger",
    // Official default maps dialog danger → confirm primary; override to red.
    confirmBtn: { content: options.confirmText, theme: "danger" },
    cancelBtn: { content: t("app.cancel"), theme: "default" },
    confirmOnEnter: false,
    onOpened: () => {
      // Prefer focusing Cancel so Enter/space is less likely to destroy data.
      const root = document.querySelector(".t-dialog__ctx--active .t-dialog__footer");
      const cancel = root?.querySelector<HTMLButtonElement>(
        ".t-button:not(.t-button--theme-danger)"
      );
      cancel?.focus();
    },
    onConfirm: async () => {
      // Hide first: clear-all unmounts this panel and can strand an open confirm.
      dialog.hide();
      try {
        await options.onConfirm();
      } finally {
        dialog.destroy();
      }
    },
  });
}

async function onRemove(file: StudioFile): Promise<void> {
  openDangerConfirm({
    header: t("browse.removeFileHeader"),
    body: t("browse.removeFileBody", { name: file.name }),
    confirmText: t("browse.removeFileConfirm"),
    onConfirm: async () => {
      await store.remove(file.id);
      MessagePlugin.success(t("browse.removed"));
    },
  });
}

function onClearAll(): void {
  if (!props.files.length) return;
  const count = props.files.length;
  openDangerConfirm({
    header: t("browse.clearCacheHeader"),
    body: t("browse.clearCacheBody", { n: count }),
    confirmText: t("browse.clearCacheConfirm"),
    onConfirm: async () => {
      await store.clearAll();
      MessagePlugin.success(t("browse.clearedCache"));
    },
  });
}
</script>

<template>
  <aside class="file-list-panel">
    <div class="panel-head">
      <span class="panel-title">
        {{ t("browse.files") }}
        <t-tag size="small" variant="light">{{ files.length }}</t-tag>
      </span>
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

    <div class="add-row">
      <FileDropZone compact class="drop-inline" @files="emit('files', $event)" />
      <div class="sample-extra">
        <t-link
          theme="primary"
          hover="color"
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
    </div>

    <t-list class="list" size="small" :split="false">
      <t-list-item
        v-for="file in sorted"
        :key="file.id"
        class="item"
        :class="{ active: file.id === activeId }"
        @click="emit('select', file.id)"
      >
        <div class="meta">
          <div class="name" :title="file.name">
            <span class="name-text">{{ file.name }}</span>
            <span
              v-if="file.dirty"
              class="dirty-dot"
              :title="t('app.unsaved')"
              :aria-label="t('app.unsaved')"
            />
          </div>
          <div class="time">{{ formatTime(file.updatedAt) }}</div>
        </div>
        <template #action>
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
        </template>
      </t-list-item>
    </t-list>
  </aside>
</template>

<style scoped>
.file-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 12px 6px;
}

.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.add-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 12px 8px;
}

.drop-inline {
  width: 100% !important;
}

.sample-extra {
  display: flex;
  justify-content: center;
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 6px 12px;
  background: transparent;
}

.item {
  cursor: pointer;
  border-radius: var(--td-radius-default);
  padding: 6px 8px !important;
  transition: background 0.12s ease;
}

.item:hover {
  background: var(--td-bg-color-container-hover);
}

.item.active {
  background: var(--td-brand-color-light);
}

.meta {
  min-width: 0;
  flex: 1;
}

.name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.name-text {
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--td-warning-color);
}

.time {
  margin-top: 2px;
  font-size: 11px;
  color: var(--td-text-color-secondary);
}

.actions {
  display: flex;
  opacity: 0.45;
}

.item:hover .actions,
.item.active .actions {
  opacity: 1;
}
</style>
