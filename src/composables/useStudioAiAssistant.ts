import { computed, watch, type MaybeRefOrGetter, toValue } from "vue";
import { getStudioRuntime } from "@/repos";
import { useChatStore } from "@/stores/chat";

/**
 * Whether Studio's built-in AI (tools + chrome) is enabled.
 *
 * - `installStudio({ showAiAssistant: false })` is a host kill-switch (always off).
 * - Page prop defaults to `true`; set `:show-ai-assistant="false"` to hide chrome on one page.
 * - When disabled, clears persisted open state so re-enable does not pop the dock.
 */
export function useStudioAiAssistantEnabled(
  pageProp?: MaybeRefOrGetter<boolean | undefined>
) {
  const chatStore = useChatStore();
  const enabled = computed(() => {
    if (getStudioRuntime().showAiAssistant === false) return false;
    return toValue(pageProp) !== false;
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
