<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import {
  DeleteIcon,
  Edit1Icon,
  FileIcon,
} from "tdesign-icons-vue-next";
import { MessagePlugin, DialogPlugin } from "tdesign-vue-next";
import type { StudioFile } from "@/types/file";
import { useFilesStore } from "@/stores/files";
import FileDropZone from "./FileDropZone.vue";

const props = defineProps<{
  files: StudioFile[];
  activeId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  files: [FileList | File[]];
}>();

const store = useFilesStore();
const router = useRouter();

const sorted = computed(() =>
  [...props.files].sort((a, b) => b.updatedAt - a.updatedAt)
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
</script>

<template>
  <aside class="file-list-panel">
    <div class="panel-head">
      <span class="panel-title">文件</span>
      <span class="count">{{ files.length }}</span>
    </div>

    <FileDropZone compact class="drop-inline" @files="emit('files', $event)" />

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
  padding: 14px 14px 8px;
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
  margin: 0 12px 10px;
  width: auto !important;
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
