import { computed, ref } from "vue";
import {
  messages,
  TAG_LABELS,
  type Locale,
  type MessageTree,
  type TagKey,
} from "./messages";

const STORAGE_KEY = "svg3dx-studio-locale";

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language)) {
    return "zh";
  }
  return "en";
}

export const locale = ref<Locale>(detectLocale());

export function setLocale(next: Locale): void {
  locale.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}

function lookup(tree: MessageTree, path: string): string | undefined {
  const parts = path.split(".");
  let cur: string | MessageTree | undefined = tree;
  for (const p of parts) {
    if (!cur || typeof cur === "string") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Translate a dotted key, e.g. `app.nodes` or `tag.model`. */
export function t(key: string, fallback?: string): string {
  const hit = lookup(messages[locale.value], key);
  if (hit !== undefined) return hit;
  const other = locale.value === "zh" ? "en" : "zh";
  return lookup(messages[other], key) ?? fallback ?? key;
}

/** Reactive translator for use in computed / templates. */
export function useI18n() {
  const loc = locale;
  return {
    locale: loc,
    setLocale,
    t: (key: string, fallback?: string) => {
      void loc.value;
      return t(key, fallback);
    },
    tagLabel: (tag: TagKey) => {
      void loc.value;
      return TAG_LABELS[tag][loc.value];
    },
    modeLabel: (mode: string) => {
      void loc.value;
      return t(`mode.${mode}`, mode);
    },
  };
}

export function tagLabel(tag: TagKey): string {
  return TAG_LABELS[tag][locale.value];
}

export const isZh = computed(() => locale.value === "zh");

export type { Locale, TagKey };
export { TAG_LABELS, messages };
