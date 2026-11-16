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

const sorted = computed(() =>
  [...props.files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )
);

function onEdit(id: string): void {
  router.push({ name: "edit", params: { id } });
}

async function onRemove(file: StudioFile): Promise<void> {
  const dialog = DialogPlugin.confirm({
    header: "移除文件",
    body: `从本地缓存中移除「${file.name}」？`,
    confirmBtn: "移除",
    theme: "danger",
    onConfirm: async () => {
      await store.remove(file.id);
      MessagePlugin.success("已移除");
      dialog.destroy();
    },
  });
}

function onClearAll(): void {
  if (!props.files.length) return;
  const count = props.files.length;
  const dialog = DialogPlugin.confirm({
    header: "清空缓存",
    body: `将从本地缓存移除全部 ${count} 个文件，此操作不可恢复。`,
    confirmBtn: "清空",
    theme: "danger",
    // Close first: clearing empties the list and unmounts this panel,
    // which can strand an async onConfirm (confirm appears to do nothing).
    onConfirm: () => {
      dialog.hide();
      void store
        .clearAll()
        .then(() => {
          MessagePlugin.success("已清空缓存列表");
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
      <span class="panel-title">文件</span>
      <div class="panel-head-right">
        <span class="count">{{ files.length }}</span>
        <t-tooltip content="清空缓存列表">
          <t-button
            size="small"
            variant="text"
            theme="danger"
            :disabled="!files.length"
            @click="onClearAll"
          >
            <template #icon><ClearIcon /></template>
            清空
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
        {{ loadingSamples ? "正在获取…" : "获取官方示例" }}
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
            {{ new Date(file.updatedAt).toLocaleString() }}
          </div>
        </div>
        <div class="actions" @click.stop>
          <t-tooltip content="编辑">
            <t-button
              shape="square"
              variant="text"
              size="small"
              @click="onEdit(file.id)"
            >
              <template #icon><Edit1Icon /></template>
            </t-button>
          </t-tooltip>
          <t-tooltip content="移除">
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
  color: var(--studio-muted);
  background: #eef2f7;
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
  cursor: pointer;
  transition: background 0.12s ease;
}

.item:hover {
  background: #f2f6fb;
}

.item.active {
  background: #e4eefc;
}

.file-icon {
  color: var(--studio-accent);
}

.meta {
  min-width: 0;
}

.name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty {
  color: #e37318;
  margin-left: 2px;
}

.time {
  font-size: 11px;
  color: var(--studio-muted);
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
