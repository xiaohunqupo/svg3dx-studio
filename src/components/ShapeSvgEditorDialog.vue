<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import SvgCanvas from "@svgedit/svgcanvas";
import { useI18n } from "@/i18n";
import {
  canvasDimensions,
  extractShapeAttrUpdates,
  wrapShapeInSvg,
} from "@/utils/shapeSvgEditor";

const props = defineProps<{
  visible: boolean;
  /** Raw XML of the shape element (`<path …/>` etc.). */
  elementXml: string;
  /** Local tag name currently selected (`path`, `circle`, …). */
  shapeKind: string;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  confirm: [updates: Record<string, string>];
}>();

const { t } = useI18n();
const hostRef = ref<HTMLElement | null>(null);
const textRef = ref<HTMLInputElement | null>(null);
const mode = ref("select");
const error = ref("");
const ready = ref(false);

let canvas: InstanceType<typeof SvgCanvas> | null = null;
const [width, height] = canvasDimensions();

function close(): void {
  emit("update:visible", false);
}

function setMode(next: string): void {
  mode.value = next;
  canvas?.setMode(next);
}

function deleteSelected(): void {
  canvas?.deleteSelectedElements?.();
}

function destroyCanvas(): void {
  canvas = null;
  ready.value = false;
  if (hostRef.value) hostRef.value.innerHTML = "";
}

async function mountCanvas(): Promise<void> {
  destroyCanvas();
  error.value = "";
  await nextTick();
  const host = hostRef.value;
  if (!host || !props.elementXml.trim()) {
    error.value = t("app.shapeEditorLoadFailed");
    return;
  }

  try {
    canvas = new SvgCanvas(host, {
      initFill: { color: "FFFFFF", opacity: 0 },
      initStroke: { color: "000000", opacity: 1, width: 2 },
      initOpacity: 1,
      dimensions: [width, height],
      baseUnit: "px",
    });
    if (textRef.value) {
      canvas.textActions?.setInputElem?.(textRef.value);
    }
    const svg = wrapShapeInSvg(props.elementXml);
    const ok = canvas.setSvgString(svg, true);
    if (!ok) {
      error.value = t("app.shapeEditorLoadFailed");
      destroyCanvas();
      return;
    }
    const withUpdate = canvas as InstanceType<typeof SvgCanvas> & {
      updateCanvas?: (w: number, h: number) => void;
    };
    withUpdate.updateCanvas?.(width, height);
    canvas.setMode("select");
    mode.value = "select";
    ready.value = true;
  } catch (e) {
    console.error(e);
    error.value = t("app.shapeEditorLoadFailed");
    destroyCanvas();
  }
}

function onConfirm(): void {
  if (!canvas) return;
  const updates = extractShapeAttrUpdates(
    canvas.getSvgString(),
    props.shapeKind
  );
  if (!updates) {
    error.value = t("app.shapeEditorSaveFailed");
    return;
  }
  emit("confirm", updates);
  close();
}

watch(
  () => props.visible,
  async (open) => {
    if (open) await mountCanvas();
    else destroyCanvas();
  }
);

onBeforeUnmount(() => destroyCanvas());
</script>

<template>
  <t-dialog
    :visible="visible"
    :header="t('app.shapeEditorTitle')"
    :width="720"
    :footer="false"
    destroy-on-close
    @update:visible="emit('update:visible', $event)"
  >
    <div class="shape-editor">
      <div class="toolbar">
        <t-button
          size="small"
          :variant="mode === 'select' ? 'base' : 'outline'"
          @click="setMode('select')"
          >{{ t("app.shapeEditorSelect") }}</t-button
        >
        <!-- Only expose draw tools that match the selected node kind — save
             still writes attrs back onto that same tag. -->
        <t-button
          v-if="shapeKind === 'path' || shapeKind === 'polyline'"
          size="small"
          :variant="mode === 'path' ? 'base' : 'outline'"
          @click="setMode('path')"
          >{{ t("app.shapeEditorPath") }}</t-button
        >
        <t-button
          v-if="shapeKind === 'circle' || shapeKind === 'ellipse'"
          size="small"
          :variant="mode === 'circle' ? 'base' : 'outline'"
          @click="setMode('circle')"
          >{{ t("app.shapeEditorCircle") }}</t-button
        >
        <t-button
          v-if="shapeKind === 'rect'"
          size="small"
          :variant="mode === 'rect' ? 'base' : 'outline'"
          @click="setMode('rect')"
          >{{ t("app.shapeEditorRect") }}</t-button
        >
        <t-button size="small" variant="outline" @click="deleteSelected">{{
          t("app.shapeEditorDelete")
        }}</t-button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <div
        ref="hostRef"
        class="canvas-host"
        :style="{ width: `${width}px`, height: `${height}px` }"
      />
      <!-- SvgCanvas text tool requires a hidden input -->
      <input ref="textRef" class="hidden-text" aria-hidden="true" />

      <div class="actions">
        <t-button variant="outline" @click="close">{{
          t("app.cancel")
        }}</t-button>
        <t-button
          theme="primary"
          :disabled="!!error || !ready"
          @click="onConfirm"
          >{{ t("app.shapeEditorApply") }}</t-button
        >
      </div>
    </div>
  </t-dialog>
</template>

<style scoped>
.shape-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.canvas-host {
  border: 1px solid var(--td-component-border, #3a3a3a);
  background: #f4f4f5;
  overflow: hidden;
  align-self: center;
}
.canvas-host :deep(#svgroot),
.canvas-host :deep(svg) {
  display: block;
}
.hidden-text {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.error {
  margin: 0;
  color: var(--td-error-color, #d54941);
  font-size: 13px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
