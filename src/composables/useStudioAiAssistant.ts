import { computed, watch, type MaybeRefOrGetter, toValue } from "vue";
import { getStudioRuntime } from "@/repos";
import { useChatStore } from "@/stores/chat";

/**
 * Resolve whether Studio's built-in AI assistant chrome should be shown.
 * Page prop wins when explicitly set; otherwise `installStudio({ showAiAssistant })`.
 * When disabled, clears persisted open state so a later re-enable does not pop the dock.
 */
export function useStudioAiAssistantEnabled(
  pageProp?: MaybeRefOrGetter<boolean | undefined>
) {
  const chatStore = useChatStore();
  const enabled = computed(() => {
    const fromPage = toValue(pageProp);
    if (typeof fromPage === "boolean") return fromPage;
    return getStudioRuntime().showAiAssistant;
  });

  watch(
    enabled,
    (on) => {
      if (!on && chatStore.open) chatStore.setOpen(false);
    },
    { immediate: true }
  );

  return enabled;
}
