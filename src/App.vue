<script setup lang="ts">
import { computed } from "vue";
import type { GlobalConfigProvider } from "tdesign-vue-next";
import enUS from "tdesign-vue-next/es/locale/en_US";
import zhCN from "tdesign-vue-next/es/locale/zh_CN";
import AiChatPanel from "@/components/AiChatPanel.vue";
import { useStudioAiAssistantEnabled } from "@/composables/useStudioAiAssistant";
import { locale } from "@/i18n";

const globalConfig = computed(
  () => (locale.value === "zh" ? zhCN : enUS) as unknown as GlobalConfigProvider
);
const showAiAssistant = useStudioAiAssistantEnabled();
</script>

<template>
  <t-config-provider :global-config="globalConfig">
    <router-view />
    <ai-chat-panel v-if="showAiAssistant" />
  </t-config-provider>
</template>
