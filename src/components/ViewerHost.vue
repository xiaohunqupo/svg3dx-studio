<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createViewer,
  type EmbedViewer,
  type EvaluationResult,
} from "svg3dx-viewer";
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme";
import { readViewportBackground } from "@/utils/viewportTheme";

const props = withDefaults(
  defineProps<{
    content: string;
    /** Prefer this `s3dx:model` id when evaluating / displaying. */
    model?: string;
    paramsEl?: HTMLElement | null;
    /** Override scene background; default follows TDesign `--td-bg-color-page`. */
    background?: number | string;
  }>(),
  {
    model: undefined,
    paramsEl: null,
    background: undefined,
  }
);

const { colorScheme } = useTheme();
const { locale } = useI18n();

const emit = defineEmits<{
  result: [EvaluationResult];
  error: [string];
  ready: [EmbedViewer];
}>();

const host = ref<HTMLElement | null>(null);
let embed: EmbedViewer | null = null;
let loadSeq = 0;
let lastContent = "";
let hasFitted = false;

/** Ignore style-block text when deciding if the document structure changed. */
function structureKey(svg: string): string {
  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style/>");
}

/**
 * Drop empty groups + normalize newlines so adding an unused `<g>` to defs
 * does not force a viewer rebuild (those groups never affect evaluation).
 * Keep `<style>` text — `:root` / class custom properties drive evaluation.
 */
function evalAffectingKey(svg: string): string {
  return svg
    .replace(/<g\b[^>]*>\s*<\/g>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    // Removing an empty <g> often leaves a blank line; collapse so compare is stable.
    .replace(/\n[ \t]*\n+/g, "\n");
}

function isStyleOnlyChange(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  return structureKey(prev) === structureKey(next);
}

function isEvalNoopChange(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  // Style-only edits (params) must re-evaluate — never treat as noop.
  if (isStyleOnlyChange(prev, next) && prev !== next) return false;
  return evalAffectingKey(prev) === evalAffectingKey(next);
}

function resolveBackground(): number | string {
  return props.background ?? readViewportBackground();
}

function syncBackground(): void {
  embed?.setBackground(resolveBackground());
}

async function ensureViewer(): Promise<EmbedViewer | null> {
  if (embed) return embed;
  if (!host.value) return null;
  embed = await createViewer(host.value, {
    paramsEl: props.paramsEl ?? undefined,
    background: resolveBackground(),
    model: props.model,
    locale: locale.value,
    onResult: (r) => emit("result", r),
    onWarnings: (w) => w.forEach((m) => console.warn("[svg3dx]", m)),
  });
  emit("ready", embed);
  return embed;
}

async function loadContent(
  text: string,
  options: { soft?: boolean; skip?: boolean } = {}
): Promise<void> {
  const seq = ++loadSeq;
  try {
    const v = await ensureViewer();
    if (!v || seq !== loadSeq) return;
    if (!text.trim()) return;
    if (options.skip) {
      lastContent = text;
      return;
    }
    // Only mark fitted when the scene has content (see InteractHost).
    const fit = !hasFitted;
    if (options.soft) {
      await v.applySvg(text, { fitCamera: fit });
    } else {
      await v.loadSvg(text, { fitCamera: fit });
    }
    if (fit && v.viewer.root.children.length > 0) {
      hasFitted = true;
    }
    lastContent = text;
  } catch (e) {
    emit("error", e instanceof Error ? e.message : String(e));
  }
}

onMounted(() => {
  void loadContent(props.content);
});

watch(
  () => props.content,
  (text, prev) => {
    const from = typeof prev === "string" ? prev : lastContent;
    if (text === from) return;
    if (isEvalNoopChange(from, text)) {
      void loadContent(text, { skip: true });
      return;
    }
    void loadContent(text, { soft: isStyleOnlyChange(from, text) });
  }
);

watch(
  () => props.model,
  (model) => {
    if (!embed) return;
    void embed.setModel(model || undefined, { fitCamera: true });
  }
);

watch(
  [colorScheme, () => props.background],
  () => {
    syncBackground();
  }
);

watch(locale, (loc) => {
  embed?.setLocale(loc);
});

onBeforeUnmount(() => {
  embed?.dispose();
  embed = null;
});

defineExpose({
  async reload() {
    if (embed && props.content) {
      hasFitted = false;
      await embed.loadSvg(props.content, { fitCamera: true });
      if (embed.viewer.root.children.length > 0) {
        hasFitted = true;
      }
      lastContent = props.content;
    }
  },
  getResult(): EvaluationResult | null {
    return embed?.getResult() ?? null;
  },
  getViewer(): EmbedViewer | null {
    return embed;
  },
});
</script>

<template>
  <div ref="host" class="viewer-host" />
</template>

<style scoped>
.viewer-host {
  width: 100%;
  height: 100%;
  min-height: 240px;
  position: relative;
  overflow: hidden;
}
</style>
