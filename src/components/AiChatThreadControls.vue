<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  ChatAddIcon,
  ChatBubbleHistoryIcon,
} from "tdesign-icons-vue-next";
import {
  useCopilotChatConfiguration,
  useThreads,
  type Thread,
} from "@copilotkit/vue/v2";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/stores/chat";

const { t, locale } = useI18n();
const chatStore = useChatStore();
const config = useCopilotChatConfiguration();

const runtimeUrl =
  (import.meta.env.VITE_COPILOT_RUNTIME_URL as string | undefined)?.trim() ||
  "/api/copilotkit";

const historyVisible = ref(false);
const agentId = computed(() => config.value?.agentId || "default");
const threadsApi = useThreads({
  agentId,
  includeArchived: false,
  limit: 50,
});

const previews = reactive<Record<string, string>>({});
const previewPending = new Set<string>();

if (chatStore.savedThreadId) {
  config.value?.setActiveThreadId(chatStore.savedThreadId, { explicit: true });
}

const threads = computed(() =>
  [...threadsApi.threads.value]
    .filter((thread) => !thread.archived)
    .sort((a, b) => threadTime(b) - threadTime(a))
);

const activeThreadId = computed(() => config.value?.threadId ?? "");

const historyLoading = computed(
  () => threadsApi.isLoading.value && threads.value.length === 0
);
const historyFailed = computed(
  () => !!threadsApi.listError.value && threads.value.length === 0
);

watch(
  [() => config.value?.threadId, threads],
  ([id, list]) => {
    if (!id) return;
    if (list.some((thread) => thread.id === id)) chatStore.rememberThread(id);
  }
);

watch([historyVisible, threads], ([open, list]) => {
  if (!open) return;
  for (const thread of list) {
    if (thread.name?.trim()) continue;
    void loadPreview(thread.id);
  }
});

function onHistoryVisible(visible: boolean) {
  historyVisible.value = visible;
  if (visible) threadsApi.refetchThreads();
}

function newThread(): void {
  config.value?.startNewThread();
  chatStore.forgetThread();
  historyVisible.value = false;
}

function selectThread(id: string): void {
  config.value?.setActiveThreadId(id, { explicit: true });
  chatStore.rememberThread(id);
  historyVisible.value = false;
}

function titleOf(thread: Thread): string {
  return thread.name?.trim() || previews[thread.id] || t("chat.untitled");
}

function whenOf(thread: Thread): string {
  const stamp = threadTime(thread);
  if (!stamp) return "";
  const minutes = Math.round((Date.now() - stamp) / 60000);
  if (minutes < 1) return t("chat.justNow");
  if (minutes < 60) return t("chat.minutesAgo", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("chat.hoursAgo", { n: hours });
  return new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  }).format(stamp);
}

function threadTime(thread: Thread): number {
  const raw = thread.lastRunAt || thread.updatedAt || thread.createdAt;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const rec = part as Record<string, unknown>;
    if (typeof rec.text === "string") parts.push(rec.text);
    else if (typeof rec.content === "string") parts.push(rec.content);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function loadPreview(id: string): Promise<void> {
  if (previews[id] || previewPending.has(id)) return;
  previewPending.add(id);
  try {
    const res = await fetch(
      `${runtimeUrl}/threads/${encodeURIComponent(id)}/messages`
    );
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages?: { role?: string; content?: unknown }[];
    };
    const firstUser = data.messages?.find((message) => message.role === "user");
    const text = messageText(firstUser?.content);
    if (text) previews[id] = text.slice(0, 120);
  } catch {
    /* runtime may be down; the row stays untitled */
  } finally {
    previewPending.delete(id);
  }
}
</script>

<template>
  <t-button
    variant="text"
    shape="square"
    size="small"
    :title="t('chat.newThread')"
    :aria-label="t('chat.newThread')"
    @click="newThread"
  >
    <template #icon><ChatAddIcon /></template>
  </t-button>
  <t-popup
    :visible="historyVisible"
    trigger="click"
    placement="bottom-right"
    attach="body"
    :overlay-inner-style="{ padding: '0' }"
    @visible-change="onHistoryVisible"
  >
    <t-button
      variant="text"
      shape="square"
      size="small"
      class="ai-thread-history-btn"
      :class="{ 'is-open': historyVisible }"
      :title="t('chat.history')"
      :aria-label="t('chat.history')"
      :aria-expanded="historyVisible"
    >
      <template #icon><ChatBubbleHistoryIcon /></template>
    </t-button>
    <template #content>
      <div class="ai-thread-menu" role="menu" :aria-label="t('chat.history')">
        <div class="ai-thread-menu-title">{{ t("chat.history") }}</div>
        <p v-if="historyLoading" class="ai-thread-menu-hint">
          {{ t("chat.historyLoading") }}
        </p>
        <p v-else-if="historyFailed" class="ai-thread-menu-hint">
          {{ t("chat.historyFailed") }}
        </p>
        <p v-else-if="threads.length === 0" class="ai-thread-menu-hint">
          {{ t("chat.historyEmpty") }}
        </p>
        <div v-else class="ai-thread-list">
          <button
            v-for="thread in threads"
            :key="thread.id"
            type="button"
            class="ai-thread-item"
            role="menuitem"
            :class="{ 'is-active': thread.id === activeThreadId }"
            :aria-current="thread.id === activeThreadId ? 'true' : undefined"
            @click="selectThread(thread.id)"
          >
            <span class="ai-thread-title">{{ titleOf(thread) }}</span>
            <span v-if="whenOf(thread)" class="ai-thread-time">{{
              whenOf(thread)
            }}</span>
          </button>
        </div>
      </div>
    </template>
  </t-popup>
</template>

<style scoped>
.ai-thread-history-btn.is-open {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.ai-thread-menu {
  width: 280px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: var(--td-bg-color-container);
}

.ai-thread-menu-title {
  padding: 10px 12px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--td-text-color-secondary);
}

.ai-thread-menu-hint {
  margin: 0;
  padding: 4px 12px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--td-text-color-placeholder);
}

.ai-thread-list {
  overflow: auto;
  padding: 0 4px 4px;
}

.ai-thread-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 8px;
  border: 0;
  border-radius: var(--td-radius-default);
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--td-text-color-primary);
}

.ai-thread-item:hover {
  background: var(--td-bg-color-container-hover);
}

.ai-thread-item.is-active {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}

.ai-thread-title {
  width: 100%;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ai-thread-time {
  font-size: 12px;
  line-height: 1.3;
  color: var(--td-text-color-placeholder);
}

.ai-thread-item.is-active .ai-thread-time {
  color: var(--td-brand-color);
}
</style>
