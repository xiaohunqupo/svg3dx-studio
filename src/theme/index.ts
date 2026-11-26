import { computed, ref } from "vue";

export type ColorScheme = "light" | "dark";

const STORAGE_KEY = "svg3dx-studio-color-scheme";

/** OS / browser color preference when the user has not chosen yet. */
function detectBrowserScheme(): ColorScheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

/**
 * Resolve color scheme:
 * 1. User setting in localStorage (if present)
 * 2. Otherwise browser / OS preference
 */
function resolveScheme(): ColorScheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return detectBrowserScheme();
}

function applyScheme(scheme: ColorScheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", scheme);
  root.setAttribute("theme-mode", scheme);
  root.style.colorScheme = scheme;
  // CopilotKit v2 (and Tailwind `dark:`) key off a `.dark` ancestor.
  root.classList.toggle("dark", scheme === "dark");
}

export const colorScheme = ref<ColorScheme>(resolveScheme());

/** Persist only after an explicit user choice. */
export function setColorScheme(next: ColorScheme): void {
  colorScheme.value = next;
  applyScheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}

/** Apply persisted / detected scheme once at startup. */
export function initTheme(): void {
  applyScheme(colorScheme.value);
}

export function useTheme() {
  const scheme = colorScheme;
  return {
    colorScheme: scheme,
    setColorScheme,
    isDark: computed(() => scheme.value === "dark"),
  };
}
