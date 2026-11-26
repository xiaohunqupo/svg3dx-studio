<script setup lang="ts">
import { ChatBubbleIcon } from "tdesign-icons-vue-next";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/stores/chat";

const { t } = useI18n();
const chatStore = useChatStore();
</script>

<template>
  <t-button
    class="ai-header-trigger"
    :class="{ 'is-active': chatStore.open }"
    variant="text"
    shape="square"
    size="small"
    :title="chatStore.open ? t('chat.close') : t('chat.open')"
    :aria-label="chatStore.open ? t('chat.close') : t('chat.open')"
    :aria-pressed="chatStore.open"
    @click="chatStore.toggle()"
  >
    <template #icon><ChatBubbleIcon /></template>
  </t-button>
</template>

<style scoped>
.ai-header-trigger {
  color: var(--td-text-color-secondary);
}

.ai-header-trigger.is-active {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}
</style>
