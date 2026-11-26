<script setup lang="ts">
import { computed, nextTick, reactive, watch } from "vue";
import { SettingIcon, ToolsIcon } from "tdesign-icons-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import { CopilotKitProvider } from "@copilotkit/vue/v2";
import AiChatSidebarChrome from "@/components/AiChatSidebarChrome.vue";
import StudioCopilotInner from "@/components/StudioCopilotInner.vue";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/stores/chat";

type CopilotWebInspectorEl = HTMLElement & {
  openInspector?: (source: "floating_button" | "message_toolbar") => void;
};

const { t } = useI18n();
const chatStore = useChatStore();

const isDev = import.meta.env.DEV;

const runtimeUrl =
  (import.meta.env.VITE_COPILOT_RUNTIME_URL as string | undefined)?.trim() ||
  "/api/copilotkit";

const configUrl =
  (import.meta.env.VITE_STUDIO_LLM_CONFIG_URL as string | undefined)?.trim() ||
  "/api/studio-llm-config";

const draft = reactive({
  baseUrl: "",
  apiKey: "",
  model: "",
});

const teleportTo = computed(() => chatStore.mountEl ?? "body");
const teleportActive = computed(() => !!chatStore.mountEl);

watch(
  () => chatStore.settingsOpen,
  (open) => {
    if (!open) return;
    draft.baseUrl = chatStore.llm.baseUrl;
    draft.apiKey = chatStore.llm.apiKey;
    draft.model = chatStore.llm.model;
  }
);

async function pushLlmConfigToRuntime(llm: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  const res = await fetch(configUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(llm),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
}

async function clearLlmConfigOnRuntime(): Promise<void> {
  const res = await fetch(configUrl, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
}

async function saveSettings(): Promise<void> {
  const baseUrl = draft.baseUrl.trim();
  const apiKey = draft.apiKey.trim();
  const model = draft.model.trim();
  if (!baseUrl) {
    MessagePlugin.warning(t("chat.settingsBaseUrlRequired"));
    return;
  }
  if (!apiKey) {
    MessagePlugin.warning(t("chat.settingsApiKeyRequired"));
    return;
  }
  if (!model) {
    MessagePlugin.warning(t("chat.settingsModelRequired"));
    return;
  }
  try {
    await pushLlmConfigToRuntime({ baseUrl, apiKey, model });
    chatStore.setLlm({ baseUrl, apiKey, model });
    chatStore.closeSettings();
    chatStore.setOpen(true);
    MessagePlugin.success(t("chat.settingsSaved"));
  } catch (err) {
    MessagePlugin.error(
      t("chat.settingsSyncFailed", {
        detail: err instanceof Error ? err.message : String(err),
      })
    );
  }
}

async function clearSettings(): Promise<void> {
  draft.apiKey = "";
  chatStore.setLlm({
    baseUrl: draft.baseUrl.trim() || chatStore.llm.baseUrl,
    apiKey: "",
    model: draft.model.trim() || chatStore.llm.model,
  });
  try {
    await clearLlmConfigOnRuntime();
  } catch {
    /* runtime may be down; local key already cleared */
  }
  MessagePlugin.success(t("chat.settingsCleared"));
}

async function openCopilotInspector(): Promise<void> {
  if (!isDev) {
    MessagePlugin.warning(t("chat.settingsInspectorDevOnly"));
    return;
  }
  if (!chatStore.configured) {
    MessagePlugin.warning(t("chat.setupTitle"));
    return;
  }
  chatStore.enableInspector();
  chatStore.closeSettings();
  await nextTick();
  for (let i = 0; i < 40; i++) {
    const el = document.querySelector(
      "cpk-web-inspector"
    ) as CopilotWebInspectorEl | null;
    if (el?.openInspector) {
      el.openInspector("floating_button");
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  MessagePlugin.warning(t("chat.settingsInspectorOpenFailed"));
}

watch(
  () => chatStore.configured,
  (ok) => {
    if (!ok) return;
    void pushLlmConfigToRuntime({
      baseUrl: chatStore.llm.baseUrl,
      apiKey: chatStore.llm.apiKey,
      model: chatStore.llm.model,
    }).catch(() => {
      /* runtime may not be up yet; re-save from Settings */
    });
  },
  { immediate: true }
);
</script>

<template>
  <!--
    Dock into Browse/Edit workspace mount when available.
    When parked (no mount), keep configured chat mounted but hidden so tools persist.
  -->
  <CopilotKitProvider
    v-if="chatStore.configured"
    :runtime-url="runtimeUrl"
    :enable-inspector="chatStore.inspectorEnabled"
  >
    <Teleport :disabled="!teleportActive" :to="teleportTo">
      <aside
        class="ai-sidebar"
        :class="{ 'ai-sidebar--parked': !teleportActive }"
        role="complementary"
        :aria-label="t('chat.title')"
        :aria-hidden="!teleportActive"
      >
        <AiChatSidebarChrome />
        <div class="ai-sidebar-body">
          <StudioCopilotInner />
        </div>
      </aside>
    </Teleport>
  </CopilotKitProvider>

  <Teleport
    v-else-if="chatStore.open && teleportActive"
    :to="teleportTo"
  >
    <aside
      class="ai-sidebar"
      role="complementary"
      :aria-label="t('chat.title')"
    >
      <AiChatSidebarChrome />
      <div class="ai-sidebar-body">
        <div class="ai-sidebar-setup">
          <p class="ai-sidebar-setup-title">{{ t("chat.setupTitle") }}</p>
          <p class="ai-sidebar-setup-hint">{{ t("chat.setupHint") }}</p>
          <t-button theme="primary" @click="chatStore.openSettings()">
            <template #icon><SettingIcon /></template>
            {{ t("chat.setupAction") }}
          </t-button>
        </div>
      </div>
    </aside>
  </Teleport>

  <t-dialog
    :visible="chatStore.settingsOpen"
    :header="t('chat.settingsTitle')"
    :confirm-btn="t('chat.settingsSave')"
    :cancel-btn="t('chat.settingsCancel')"
    width="480px"
    attach="body"
    @confirm="saveSettings"
    @close="chatStore.closeSettings()"
    @cancel="chatStore.closeSettings()"
    @update:visible="(v: boolean) => (v ? chatStore.openSettings() : chatStore.closeSettings())"
  >
    <div class="ai-chat-settings">
      <p class="ai-chat-settings-hint">{{ t("chat.settingsHint") }}</p>
      <t-form label-align="top">
        <t-form-item :label="t('chat.settingsBaseUrl')">
          <t-input
            v-model="draft.baseUrl"
            :placeholder="t('chat.settingsBaseUrlPlaceholder')"
          />
        </t-form-item>
        <t-form-item :label="t('chat.settingsApiKey')">
          <t-input
            v-model="draft.apiKey"
            type="password"
            :placeholder="t('chat.settingsApiKeyPlaceholder')"
          />
        </t-form-item>
        <t-form-item :label="t('chat.settingsModel')">
          <t-input
            v-model="draft.model"
            :placeholder="t('chat.settingsModelPlaceholder')"
          />
        </t-form-item>
      </t-form>
      <div class="ai-chat-settings-inspector">
        <div class="ai-chat-settings-inspector-text">
          <div class="ai-chat-settings-inspector-title">
            {{ t("chat.settingsInspector") }}
          </div>
          <p class="ai-chat-settings-hint">{{ t("chat.settingsInspectorHint") }}</p>
        </div>
        <t-button
          variant="outline"
          :disabled="!isDev || !chatStore.configured"
          :title="isDev ? undefined : t('chat.settingsInspectorDevOnly')"
          @click="openCopilotInspector"
        >
          <template #icon><ToolsIcon /></template>
          {{ t("chat.settingsInspectorOpen") }}
        </t-button>
      </div>
      <div class="ai-chat-settings-footer">
        <t-button
          variant="outline"
          theme="danger"
          :disabled="!chatStore.llm.apiKey"
          @click="clearSettings"
        >
          {{ t("chat.settingsClearKey") }}
        </t-button>
      </div>
    </div>
  </t-dialog>
</template>

<style scoped>
.ai-sidebar {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--td-bg-color-container);
  border-left: 1px solid var(--td-component-border);
}

.ai-sidebar--parked {
  display: none;
}

.ai-sidebar-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.ai-sidebar-setup {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 16px;
}

.ai-sidebar-setup-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--td-text-color-primary);
}

.ai-sidebar-setup-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--td-text-color-secondary);
}

.ai-chat-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-chat-settings-hint {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--td-text-color-secondary);
}

.ai-chat-settings-inspector {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--td-component-border);
}

.ai-chat-settings-inspector-text {
  min-width: 0;
  flex: 1;
}

.ai-chat-settings-inspector-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  margin-bottom: 4px;
}

.ai-chat-settings-footer {
  display: flex;
  justify-content: flex-start;
  margin-top: 4px;
}
</style>
