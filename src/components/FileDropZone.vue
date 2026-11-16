<script setup lang="ts">
import { computed, ref } from "vue";
import { FileAddIcon, UploadIcon } from "tdesign-icons-vue-next";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    compact?: boolean;
    hint?: string;
  }>(),
  {
    compact: false,
  }
);

const emit = defineEmits<{
  files: [FileList | File[]];
}>();

const { t } = useI18n();
const dragging = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);

const title = computed(() =>
  props.compact ? t("browse.dropCompact") : t("browse.openTitle")
);
const resolvedHint = computed(() => props.hint ?? t("browse.dropHint"));

function openPicker(): void {
  inputRef.value?.click();
}

function onInputChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) emit("files", input.files);
  input.value = "";
}

function onDrop(e: DragEvent): void {
  dragging.value = false;
  const list = e.dataTransfer?.files;
  if (list?.length) emit("files", list);
}

defineExpose({ openPicker });
</script>

<template>
  <div
    class="dropzone"
    :class="{ compact, dragging }"
    role="button"
    tabindex="0"
    @click="openPicker"
    @keydown.enter.prevent="openPicker"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="inputRef"
      class="hidden-input"
      type="file"
      multiple
      accept=".svg,.svg3dx,image/svg+xml,text/xml"
      @change="onInputChange"
      @click.stop
    />
    <div class="icon-wrap">
      <UploadIcon v-if="!compact" size="40px" />
      <FileAddIcon v-else size="22px" />
    </div>
    <div class="title">{{ title }}</div>
    <div class="hint">{{ resolvedHint }}</div>
    <t-button v-if="!compact" theme="primary" variant="base" @click.stop="openPicker">
      {{ t("browse.chooseFiles") }}
    </t-button>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: min(520px, 92%);
  min-height: 280px;
  padding: 36px 28px;
  border: 1.5px dashed var(--studio-line);
  border-radius: 12px;
  background: var(--studio-surface-soft);
  color: var(--studio-ink);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  user-select: none;
}

.dropzone:hover,
.dropzone.dragging {
  border-color: var(--studio-accent);
  background: var(--studio-surface-hover);
  box-shadow: 0 8px 28px rgba(47, 111, 237, 0.08);
}

.dropzone.compact {
  width: 100%;
  min-height: 72px;
  padding: 12px 16px;
  flex-direction: row;
  justify-content: flex-start;
  gap: 10px;
  border-radius: 8px;
  background: var(--studio-surface-compact);
}

.dropzone.compact .title {
  font-size: 13px;
  font-weight: 500;
}

.dropzone.compact .hint {
  display: none;
}

.icon-wrap {
  color: var(--studio-accent);
  display: flex;
}

.title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.hint {
  font-size: 13px;
  color: var(--studio-muted);
}

.hidden-input {
  display: none;
}
</style>
