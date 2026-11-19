<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EvaluationResult } from "svg3dx-viewer";
import {
  createInteract,
  type InteractViewport,
  type TransformCommitPayload,
  type TransformMode,
} from "@/interact";
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme";
import { readViewportBackground } from "@/utils/viewportTheme";
import {
  TransformMoveIcon,
  TransformRotateIcon,
  TransformScaleIcon,
} from "@/components/icons/lucideIcons";

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
const { locale, t } = useI18n();

const emit = defineEmits<{
  result: [EvaluationResult];
  error: [string];
  ready: [InteractViewport];
  /** Viewport pick → Studio tree path (null = empty click). */
  pick: [path: string | null];
  /** TransformControls drag finished → write `s3dx:transform`. */
  transform: [payload: TransformCommitPayload];
}>();

const host = ref<HTMLElement | null>(null);
const gizmoActive = ref(false);
const transformMode = ref<TransformMode>("translate");
let interact: InteractViewport | null = null;
let loadSeq = 0;
let lastContent = "";
let hasFitted = false;
/** Suppress re-entrant pick→select→highlight loops. */
let applyingHighlight = false;

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
  interact?.setBackground(resolveBackground());
}

function syncGizmoUi(): void {
  gizmoActive.value = Boolean(interact?.hasTransformGizmo());
  if (interact) transformMode.value = interact.getTransformMode();
}

function onTransformModeChange(mode: TransformMode): void {
  transformMode.value = mode;
  interact?.setTransformMode(mode);
}

function onTransformModeRadio(value: string | number | boolean): void {
  const mode = String(value);
  if (mode === "translate" || mode === "rotate" || mode === "scale") {
    onTransformModeChange(mode);
  }
}

async function ensureInteract(): Promise<InteractViewport | null> {
  if (interact) return interact;
  if (!host.value) return null;
  interact = await createInteract(host.value, {
    paramsEl: props.paramsEl ?? undefined,
    background: resolveBackground(),
    model: props.model,
    locale: locale.value,
    onResult: (r) => emit("result", r),
    onWarnings: (w) => w.forEach((m) => console.warn("[svg3dx]", m)),
    onPick: (path) => {
      if (applyingHighlight) return;
      emit("pick", path);
      syncGizmoUi();
    },
    onTransformCommit: (payload) => emit("transform", payload),
  });
  emit("ready", interact);
  syncGizmoUi();
  return interact;
}

async function loadContent(
  text: string,
  options: { soft?: boolean; skip?: boolean } = {}
): Promise<void> {
  const seq = ++loadSeq;
  try {
    const v = await ensureInteract();
    if (!v || seq !== loadSeq) return;
    if (!text.trim()) return;
    if (options.skip) {
      lastContent = text;
      return;
    }
    // Only treat as fitted when the scene actually has content. An empty
    // model (e.g. uses with cleared href) must not lock hasFitted — otherwise
    // the next load with geometry skips fitCamera and OrbitControls stays
    // singular (camera/target both at origin).
    const fit = !hasFitted;
    if (options.soft) {
      await v.applySvg(text, { fitCamera: fit });
    } else {
      await v.loadSvg(text, { fitCamera: fit });
    }
    if (fit && v.viewer.viewer.root.children.length > 0) {
      hasFitted = true;
    }
    lastContent = text;
    syncGizmoUi();
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
    if (!interact) return;
    void interact.setModel(model || undefined, { fitCamera: true }).then(() => {
      syncGizmoUi();
    });
  }
);

watch(
  [colorScheme, () => props.background],
  () => {
    syncBackground();
  }
);

watch(locale, (loc) => {
  interact?.viewer.setLocale(loc);
});

onBeforeUnmount(() => {
  interact?.dispose();
  interact = null;
});

defineExpose({
  async reload() {
    if (interact && props.content) {
      hasFitted = false;
      await interact.loadSvg(props.content, { fitCamera: true });
      if (interact.viewer.viewer.root.children.length > 0) {
        hasFitted = true;
      }
      lastContent = props.content;
      syncGizmoUi();
    }
  },
  getResult(): EvaluationResult | null {
    return interact?.getResult() ?? null;
  },
  getInteract(): InteractViewport | null {
    return interact;
  },
  setHighlight(path: string | null | undefined) {
    if (!interact) return;
    applyingHighlight = true;
    try {
      interact.setHighlight(path);
    } finally {
      applyingHighlight = false;
    }
    syncGizmoUi();
  },
});
</script>

<template>
  <div class="interact-host">
    <div ref="host" class="interact-canvas" />
    <t-radio-group
      v-if="gizmoActive"
      class="xform-toolbar"
      role="toolbar"
      :aria-label="t('app.transform')"
      :value="transformMode"
      variant="default-filled"
      size="large"
      @change="onTransformModeRadio"
    >
      <t-radio-button
        value="translate"
        :title="`${t('app.transformTranslate')} (${t('app.transformTranslateHint')})`"
      >
        <TransformMoveIcon />
      </t-radio-button>
      <t-radio-button
        value="rotate"
        :title="`${t('app.transformRotate')} (${t('app.transformRotateHint')})`"
      >
        <TransformRotateIcon />
      </t-radio-button>
      <t-radio-button
        value="scale"
        :title="`${t('app.transformScale')} (${t('app.transformScaleHint')})`"
      >
        <TransformScaleIcon />
      </t-radio-button>
    </t-radio-group>
  </div>
</template>

<style scoped>
.interact-host {
  width: 100%;
  height: 100%;
  min-height: 240px;
  position: relative;
  overflow: hidden;
}

.interact-canvas {
  width: 100%;
  height: 100%;
}

.xform-toolbar {
  position: absolute;
  left: 12px;
  bottom: 12px;
  z-index: 2;
}

/* Icon-only: square-ish large slots; 1em is too small to notice size=large. */
.xform-toolbar :deep(.t-radio-button) {
  justify-content: center;
  min-width: var(--td-comp-size-xl);
  padding-left: var(--td-comp-paddingLR-s);
  padding-right: var(--td-comp-paddingLR-s);
}

.xform-toolbar :deep(.t-radio-button svg) {
  display: block;
  width: 20px;
  height: 20px;
}

/* Hide filled-segment dividers between icon-only buttons. */
.xform-toolbar :deep(.t-radio-button::before) {
  display: none;
}
</style>
