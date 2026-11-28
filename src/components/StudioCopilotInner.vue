<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { CopilotChat, useAgentContext } from "@copilotkit/vue/v2";
import {
  listChatUploads,
  registerChatUpload,
} from "@/chat/chatUploads";
import { getStudioEditBridge } from "@/chat/editBridge";
import { useStudioFrontendTools } from "@/chat/useStudioFrontendTools";
import { useI18n } from "@/i18n";
import { useFilesStore } from "@/stores/files";
import { isSvg3dxzFileName } from "@/utils/svg3dxz";

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

function isLibraryImportFile(file: File): boolean {
  return (
    isSvg3dxzFileName(file.name) || /\.(svg3dx|svg)$/i.test(file.name)
  );
}

const attachments = {
  enabled: true,
  accept:
    "image/*,application/pdf,text/*,.svg,.svg3dx,.svg3dxz,.md,.txt,.json",
  maxSize: 12 * 1024 * 1024,
  onUpload: async (file: File) => {
    if (isLibraryImportFile(file)) {
      const meta = await registerChatUpload(file);
      // Tiny placeholder — real bytes stay in chatUploads; model uses uploadId.
      return {
        type: "data" as const,
        value: btoa(`svg3dx-upload:${meta.uploadId}`),
        mimeType: "text/plain",
        metadata: {
          uploadId: meta.uploadId,
          filename: meta.name,
          kind: meta.kind,
          importHint:
            "Call import_file({ uploadId }) to add this file to the Studio library",
        },
      };
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () =>
        reject(reader.error ?? new Error(`Failed to read ${file.name}`));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
    return {
      type: "data" as const,
      value: base64,
      mimeType: file.type || "application/octet-stream",
      metadata: { filename: file.name },
    };
  },
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
      pendingUploads: listChatUploads().map((u) => ({
        uploadId: u.uploadId,
        name: u.name,
        kind: u.kind,
        size: u.size,
      })),
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
