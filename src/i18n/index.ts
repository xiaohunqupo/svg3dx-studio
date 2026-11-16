import { computed, ref } from "vue";
import {
  messages,
  TAG_LABELS,
  type Locale,
  type MessageTree,
  type TagKey,
} from "./messages";

const STORAGE_KEY = "svg3dx-studio-locale";

function isZhTag(tag: string): boolean {
  return /^zh\b/i.test(tag.trim());
}

/** Browser UI language → zh / en. Prefers `navigator.languages` order. */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const tags = [
    ...(navigator.languages ?? []),
    navigator.language,
  ].filter(Boolean);
  for (const tag of tags) {
    if (isZhTag(tag)) return "zh";
  }
  return "en";
}

/**
 * Resolve locale:
 * 1. User setting in localStorage (if present)
 * 2. Otherwise browser language
 */
function resolveLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  return detectBrowserLocale();
}

export const locale = ref<Locale>(resolveLocale());

/** Persist only after an explicit user choice. */
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

function applyParams(
  text: string,
  params?: Record<string, string | number>
): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, k: string) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : all
  );
}

/**
 * Translate a dotted key, e.g. `app.nodes` or `tag.model`.
 * Second arg may be a fallback string or `{n}`-style params.
 */
export function t(
  key: string,
  fallbackOrParams?: string | Record<string, string | number>
): string {
  let fallback: string | undefined;
  let params: Record<string, string | number> | undefined;
  if (typeof fallbackOrParams === "string") fallback = fallbackOrParams;
  else if (fallbackOrParams) params = fallbackOrParams;

  const hit = lookup(messages[locale.value], key);
  if (hit !== undefined) return applyParams(hit, params);
  const other = locale.value === "zh" ? "en" : "zh";
  return applyParams(lookup(messages[other], key) ?? fallback ?? key, params);
}

/** Reactive translator for use in computed / templates. */
export function useI18n() {
  const loc = locale;
  return {
    locale: loc,
    setLocale,
    t: (
      key: string,
      fallbackOrParams?: string | Record<string, string | number>
    ) => {
      void loc.value;
      return t(key, fallbackOrParams);
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
