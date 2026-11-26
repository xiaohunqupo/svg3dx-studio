<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { CopilotChat, useAgentContext } from "@copilotkit/vue/v2";
import { getStudioEditBridge } from "@/chat/editBridge";
import { useStudioFrontendTools } from "@/chat/useStudioFrontendTools";
import { useI18n } from "@/i18n";
import { useFilesStore } from "@/stores/files";

const { t, locale } = useI18n();
const route = useRoute();
const filesStore = useFilesStore();

const labels = computed(
  () =>
    ({
      chatInputPlaceholder: t("chat.placeholder"),
      chatDisclaimerText: "",
      welcomeMessageText: t("chat.welcome"),
    }) as Record<string, string>
);

const attachments = {
  enabled: true,
  accept: "image/*,application/pdf,text/*,.svg,.svg3dx,.md,.txt,.json",
  maxSize: 12 * 1024 * 1024,
};

useAgentContext({
  description:
    "Current Studio page and active document only (not the full file library)",
  value: () => {
    const edit = getStudioEditBridge()?.getSnapshot() ?? null;
    const active = filesStore.activeFile;
    return {
      locale: locale.value,
      route: route.fullPath,
      page: edit ? "edit" : "browse",
      activeFile: active
        ? { id: active.id, name: active.name, dirty: !!active.dirty }
        : null,
      fileCount: filesStore.files.length,
      // Live editor snapshot when on EditPage — edit this document, do not scan other files.
      edit,
    };
  },
});

useStudioFrontendTools();
</script>

<template>
  <div class="studio-copilot">
    <CopilotChat
      class="studio-copilot-chat"
      :labels="labels"
      :attachments="attachments"
    />
  </div>
</template>

<style scoped>
.studio-copilot {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.studio-copilot-chat {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.studio-copilot :deep(.copilotKitChat) {
  height: 100%;
  min-height: 0;
}
</style>
