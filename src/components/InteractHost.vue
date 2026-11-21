<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EvaluationResult } from "svg3dx-viewer";
import {
  createInteract,
  type DrillCrumb,
  type InteractViewport,
  type TransformCommitPayload,
  type TransformMode,
} from "@/interact";
import { elementLabel, useI18n } from "@/i18n";
import { nodeKindAtPath } from "@/utils/nodeXmlEdit";
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
    /** Base URL for relative `s3dx:gltf` hrefs. */
    documentBaseUrl?: string;
    /** Local sidecar map: relative href → blob URL. */
    documentAssetUrls?: Record<string, string>;
  }>(),
  {
    model: undefined,
    paramsEl: null,
    background: undefined,
    documentBaseUrl: undefined,
    documentAssetUrls: undefined,
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
  /** Selection breadcrumb. Empty when nothing is selected and not drilled in. */
  drill: [crumbs: DrillCrumb[]];
}>();

const host = ref<HTMLElement | null>(null);
const gizmoActive = ref(false);
const transformMode = ref<TransformMode>("translate");
const drillCrumbs = ref<{ path: string; label: string; pending?: boolean }[]>([]);
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

function crumbLabel(path: string): string {
  const info = nodeKindAtPath(props.content, path);
  if (!info) return path;
  if (info.id) return info.id;
  return elementLabel(info.kind);
}

function onDrillCrumb(path: string): void {
  interact?.focusDrill(path);
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
    onDrillChange: (crumbs: DrillCrumb[]) => {
      drillCrumbs.value = crumbs.map((c) => ({
        path: c.path,
        label: c.pending ? "?" : crumbLabel(c.nodePath),
        pending: c.pending,
      }));
      emit("drill", crumbs);
    },
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
    v.setDocument(text);
    if (options.skip) {
      lastContent = text;
      return;
    }
    // Only treat as fitted when the scene actually has content. An empty
    // model (e.g. uses with cleared href) must not lock hasFitted — otherwise
    // the next load with geometry skips fitCamera and OrbitControls stays
    // singular (camera/target both at origin).
    const fit = !hasFitted;
    const loadOpts = {
      fitCamera: fit,
      documentBaseUrl: props.documentBaseUrl,
      documentAssetUrls: props.documentAssetUrls,
    };
    if (options.soft) {
      await v.applySvg(text, loadOpts);
    } else {
      await v.loadSvg(text, loadOpts);
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
  () => props.documentAssetUrls,
  () => {
    if (!interact || !props.content) return;
    void loadContent(props.content, { soft: true });
  },
  { deep: true }
);

watch(
  () => props.documentBaseUrl,
  () => {
    if (!interact || !props.content) return;
    void loadContent(props.content, { soft: true });
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
      await interact.loadSvg(props.content, {
        fitCamera: true,
        documentBaseUrl: props.documentBaseUrl,
        documentAssetUrls: props.documentAssetUrls,
      });
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
  exitDrill(options?: { select?: string | null }) {
    interact?.exitDrill(options);
    syncGizmoUi();
  },
});
</script>

<template>
  <div class="interact-host">
    <div ref="host" class="interact-canvas" />
    <nav
      v-if="drillCrumbs.length"
      class="drill-crumbs"
      :aria-label="t('app.drillPath')"
      :title="t('app.drillExitHint')"
    >
      <template v-for="(crumb, index) in drillCrumbs" :key="`${index}:${crumb.path}`">
        <span v-if="index > 0" class="drill-sep" aria-hidden="true">/</span>
        <span
          v-if="crumb.pending"
          class="drill-crumb current pending"
          aria-current="page"
          :title="t('app.drillNoSelection')"
        >
          <span class="drill-crumb-label">{{ crumb.label }}</span>
        </span>
        <button
          v-else
          type="button"
          class="drill-crumb"
          :class="{ current: index === drillCrumbs.length - 1 }"
          :aria-current="index === drillCrumbs.length - 1 ? 'page' : undefined"
          @click="onDrillCrumb(crumb.path)"
        >
          <span class="drill-crumb-label">{{ crumb.label }}</span>
          <span class="drill-crumb-index">{{ index + 1 }}</span>
        </button>
      </template>
    </nav>
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

.drill-crumbs {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: min(42rem, calc(100% - 22rem));
  overflow-x: auto;
  margin: 0;
  padding: 4px 10px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default);
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
  transform: translateX(-50%);
  pointer-events: auto;
}

.drill-sep {
  color: var(--td-text-color-placeholder);
}

.drill-crumb {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin: 0;
  padding: 0 2px;
  border: none;
  background: none;
  color: var(--td-brand-color);
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}

.drill-crumb-label {
  line-height: 1.2;
}

.drill-crumb-index {
  font-size: 10px;
  line-height: 1.2;
  color: var(--td-text-color-placeholder);
}

.drill-crumb.current .drill-crumb-index {
  color: var(--td-text-color-secondary);
}

.drill-crumb.current {
  color: var(--td-text-color-primary);
  cursor: default;
}

.drill-crumb.pending {
  cursor: default;
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
