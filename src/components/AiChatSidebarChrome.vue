<script setup lang="ts">
import { CloseIcon, SettingIcon } from "tdesign-icons-vue-next";
import AiChatThreadControls from "@/components/AiChatThreadControls.vue";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/stores/chat";

withDefaults(
  defineProps<{
    /** New-chat and history controls. Only inside a configured Copilot session. */
    showThreads?: boolean;
  }>(),
  { showThreads: false }
);

const { t } = useI18n();
const chatStore = useChatStore();
</script>

<template>
  <header class="ai-sidebar-header">
    <div class="ai-sidebar-title">{{ t("chat.title") }}</div>
    <div class="ai-sidebar-actions">
      <AiChatThreadControls v-if="showThreads" />
      <t-button
        variant="text"
        shape="square"
        size="small"
        :title="t('chat.settings')"
        :aria-label="t('chat.settings')"
        @click="chatStore.openSettings()"
      >
        <template #icon><SettingIcon /></template>
      </t-button>
      <t-button
        variant="text"
        shape="square"
        size="small"
        :title="t('chat.close')"
        :aria-label="t('chat.close')"
        @click="chatStore.setOpen(false)"
      >
        <template #icon><CloseIcon /></template>
      </t-button>
    </div>
  </header>
</template>

<style scoped>
.ai-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  padding: 0 8px 0 14px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--td-component-border);
  background: var(--td-bg-color-secondarycontainer);
}

.ai-sidebar-title {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ai-sidebar-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 0;
}
</style>
