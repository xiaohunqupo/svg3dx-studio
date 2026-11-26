<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { z } from "zod";
import {
  CopilotChat,
  useAgentContext,
  useFrontendTool,
} from "@copilotkit/vue/v2";
import { runStudioChatTool } from "@/chat/studioTools";
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
  description: "svg3dx Studio page context (route, active file, file list)",
  value: () => ({
    locale: locale.value,
    route: route.fullPath,
    activeId: filesStore.activeId,
    files: filesStore.files.map((f) => ({ id: f.id, name: f.name })),
  }),
});

useFrontendTool({
  name: "list_files",
  description: "List cached svg3dx documents in the Studio file list",
  handler: async () => {
    const result = await runStudioChatTool({ name: "list_files" });
    return JSON.stringify(result);
  },
});

useFrontendTool({
  name: "go_browse",
  description: "Navigate to the Studio browse (file list) page",
  handler: async () => {
    const result = await runStudioChatTool({ name: "go_browse" });
    return JSON.stringify(result);
  },
});

useFrontendTool({
  name: "go_edit",
  description: "Open a document in the Studio editor by file id",
  parameters: z.object({
    id: z.string().describe("Document id from list_files"),
  }),
  handler: async ({ id }) => {
    const result = await runStudioChatTool({
      name: "go_edit",
      args: { id },
    });
    return JSON.stringify(result);
  },
});
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
