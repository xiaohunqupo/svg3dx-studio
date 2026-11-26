import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";

export type StudioChatLlmSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

const OPEN_KEY = "svg3dx-studio-chat-open";
const LLM_KEY = "svg3dx-studio-chat-llm";
const WIDTH_KEY = "svg3dx-studio-chat-width";

const AI_W_MIN = 280;
const AI_W_MAX = 560;
const AI_W_DEFAULT = 360;

const DEFAULT_LLM: StudioChatLlmSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
};

function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(n)) return Math.min(AI_W_MAX, Math.max(AI_W_MIN, n));
  } catch {
    /* ignore */
  }
  return AI_W_DEFAULT;
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function readLlm(): StudioChatLlmSettings {
  try {
    const raw = localStorage.getItem(LLM_KEY);
    if (!raw) return { ...DEFAULT_LLM };
    const parsed = JSON.parse(raw) as Partial<StudioChatLlmSettings>;
    return {
      baseUrl:
        String(parsed.baseUrl ?? DEFAULT_LLM.baseUrl).trim() ||
        DEFAULT_LLM.baseUrl,
      apiKey: String(parsed.apiKey ?? ""),
      model:
        String(parsed.model ?? DEFAULT_LLM.model).trim() || DEFAULT_LLM.model,
    };
  } catch {
    return { ...DEFAULT_LLM };
  }
}

export const useChatStore = defineStore("chat", () => {
  const open = ref(readOpen());
  const llm = ref<StudioChatLlmSettings>(readLlm());
  const settingsOpen = ref(false);
  const width = ref(readWidth());
  /** CopilotKit Inspector overlay; off by default, opened from Settings. */
  const inspectorEnabled = ref(false);
  /** Layout mount provided by Browse/Edit workspace (rightmost column). */
  const mountEl = shallowRef<HTMLElement | null>(null);

  const configured = computed(
    () =>
      llm.value.apiKey.trim().length > 0 &&
      llm.value.baseUrl.trim().length > 0 &&
      llm.value.model.trim().length > 0
  );

  watch(open, (v) => {
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  });

  watch(
    llm,
    (next) => {
      try {
        localStorage.setItem(LLM_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    { deep: true }
  );

  watch(width, (v) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(v));
    } catch {
      /* ignore */
    }
  });

  function setOpen(next: boolean): void {
    open.value = next;
  }

  function toggle(): void {
    open.value = !open.value;
  }

  function setLlm(next: Partial<StudioChatLlmSettings>): void {
    llm.value = {
      baseUrl:
        String(next.baseUrl ?? llm.value.baseUrl).trim() || DEFAULT_LLM.baseUrl,
      apiKey: String(next.apiKey ?? llm.value.apiKey),
      model: String(next.model ?? llm.value.model).trim() || DEFAULT_LLM.model,
    };
  }

  function setWidth(next: number): void {
    width.value = Math.min(AI_W_MAX, Math.max(AI_W_MIN, next));
  }

  function setMountEl(el: HTMLElement | null): void {
    mountEl.value = el;
  }

  function openSettings(): void {
    settingsOpen.value = true;
  }

  function closeSettings(): void {
    settingsOpen.value = false;
  }

  function enableInspector(): void {
    inspectorEnabled.value = true;
  }

  return {
    open,
    llm,
    settingsOpen,
    width,
    inspectorEnabled,
    mountEl,
    configured,
    setOpen,
    toggle,
    setLlm,
    setWidth,
    setMountEl,
    enableInspector,
    openSettings,
    closeSettings,
  };
});
