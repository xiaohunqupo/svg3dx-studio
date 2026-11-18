<script setup lang="ts">
import { computed, ref } from "vue";
import { FileAddIcon, UploadIcon } from "tdesign-icons-vue-next";
import type { UploadFile } from "tdesign-vue-next";
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
const uploadFiles = ref<UploadFile[]>([]);
const uploadRef = ref<{ triggerUpload?: () => void } | null>(null);

const title = computed(() =>
  props.compact ? t("browse.dropCompact") : t("browse.openTitle")
);
const resolvedHint = computed(() => props.hint ?? t("browse.dropHint"));
// Extensions only — MIME extras like text/xml / octet-stream flood the OS picker.
const accept = ".svg,.svg3dx";

function onSelectChange(files: File[]): void {
  if (!files.length) return;
  emit("files", files);
  uploadFiles.value = [];
}

defineExpose({
  openPicker() {
    uploadRef.value?.triggerUpload?.();
  },
});
</script>

<template>
  <t-upload
    ref="uploadRef"
    v-model="uploadFiles"
    class="dropzone-upload"
    :class="{ compact }"
    theme="custom"
    :draggable="true"
    :auto-upload="false"
    :multiple="true"
    :accept="accept"
    :show-upload-progress="false"
    @select-change="onSelectChange"
  >
    <template #dragContent>
      <div class="drag-content" :class="{ compact }">
        <UploadIcon v-if="!compact" class="drag-icon" size="40px" />
        <FileAddIcon v-else class="drag-icon" size="22px" />
        <div class="text">
          <div class="title">{{ title }}</div>
          <div v-if="!compact" class="hint">{{ resolvedHint }}</div>
        </div>
        <t-button
          v-if="!compact"
          theme="primary"
          variant="base"
          @click.stop="uploadRef?.triggerUpload?.()"
        >
          {{ t("browse.chooseFiles") }}
        </t-button>
      </div>
    </template>
  </t-upload>
</template>

<style scoped>
.dropzone-upload {
  width: min(520px, 92%);
}

.dropzone-upload.compact {
  width: 100%;
}

.dropzone-upload :deep(.t-upload__dragger) {
  width: 100%;
  height: auto;
  min-height: 280px;
  padding: 36px 28px;
}

/* TDesign default is height:144px — must override height, not only min-height. */
.dropzone-upload.compact :deep(.t-upload__dragger) {
  height: 60px;
  min-height: 60px;
  padding: 0 14px;
  overflow: hidden;
}

.drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  height: 100%;
  color: var(--td-text-color-primary);
}

.drag-content.compact {
  flex-direction: row;
  justify-content: flex-start;
  gap: 8px;
}

.drag-icon {
  color: var(--td-brand-color);
  flex-shrink: 0;
}

.text {
  min-width: 0;
}

.drag-content:not(.compact) .text {
  text-align: center;
}

.title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.drag-content.compact .title {
  font-size: 13px;
  font-weight: 500;
}

.hint {
  font-size: 13px;
  color: var(--td-text-color-secondary);
}
</style>
