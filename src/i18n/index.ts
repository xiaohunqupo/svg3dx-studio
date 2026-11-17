import { computed, ref } from "vue";
import {
  messages,
  TAG_LABELS,
  type Locale,
  type MessageTree,
  type TagKey,
} from "./messages";
import {
  ATTR_LABELS,
  CORNER_VALUE_LABELS,
  ELEMENT_LABELS,
  MATERIAL_LABELS,
  ORIENT_VALUE_LABELS,
  type AttrKey,
  type CornerValueKey,
  type ElementKey,
  type MaterialKey,
  type OrientValueKey,
} from "./vocab";

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

/** Official attribute display name (XML name unchanged on save). */
export function attrLabel(name: string): string {
  const hit = ATTR_LABELS[name as AttrKey];
  if (hit) return hit[locale.value];
  // Strip s3dx: prefix for unknown namespaced attrs.
  if (name.startsWith("s3dx:")) {
    const local = name.slice(5);
    const localHit = ATTR_LABELS[local as AttrKey];
    if (localHit) return localHit[locale.value];
  }
  return name;
}

/** Official element / type display name. */
export function elementLabel(kind: string): string {
  const hit = ELEMENT_LABELS[kind as ElementKey];
  return hit ? hit[locale.value] : kind;
}

/** Built-in material display name; `id` is still what gets saved. */
export function materialLabel(id: string): string {
  const hit = MATERIAL_LABELS[id as MaterialKey];
  return hit ? hit[locale.value] : id;
}

/** Enum attr value display name (`orient` / `corner`, …). */
export function attrValueLabel(attr: string, value: string): string {
  const v = value.trim();
  if (!v) return v;
  if (attr === "orient") {
    const hit = ORIENT_VALUE_LABELS[v as OrientValueKey];
    return hit ? hit[locale.value] : v;
  }
  if (attr === "corner") {
    const hit = CORNER_VALUE_LABELS[v as CornerValueKey];
    return hit ? hit[locale.value] : v;
  }
  return v;
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
    attrLabel: (name: string) => {
      void loc.value;
      return attrLabel(name);
    },
    elementLabel: (kind: string) => {
      void loc.value;
      return elementLabel(kind);
    },
    materialLabel: (id: string) => {
      void loc.value;
      return materialLabel(id);
    },
    attrValueLabel: (attr: string, value: string) => {
      void loc.value;
      return attrValueLabel(attr, value);
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

export type {
  Locale,
  TagKey,
  AttrKey,
  ElementKey,
  MaterialKey,
  OrientValueKey,
  CornerValueKey,
};
export {
  TAG_LABELS,
  messages,
  ATTR_LABELS,
  ELEMENT_LABELS,
  MATERIAL_LABELS,
  ORIENT_VALUE_LABELS,
  CORNER_VALUE_LABELS,
};
