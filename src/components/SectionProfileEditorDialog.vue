<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, ref, watch } from "vue";
import SvgCanvas from "@svgedit/svgcanvas";
import {
  CursorIcon,
  DeleteIcon,
  LayersIcon,
  MoreIcon,
} from "tdesign-icons-vue-next";
import { type DropdownOption, type TreeNodeModel } from "tdesign-vue-next";
import { useI18n, locale } from "@/i18n";
import ExprAttrInput from "@/components/ExprAttrInput.vue";
import VecRgbInput from "@/components/VecRgbInput.vue";
import { PathIcon } from "@/components/icons/lucideIcons";
import {
  SECTION_SHAPE_MENU,
  SECTION_SHAPE_SNIPPETS,
  type PathInsertMenuItem,
} from "@/utils/svgEdit";
import {
  buildShapeXml,
  extractShapesFromSvg,
  geomAttrsForTag,
  parseElementAttrs,
  parseSectionShapeDrafts,
  serializeSectionShapeDrafts,
  type SectionShapeDraft,
  wrapShapesInSvg,
} from "@/utils/shapeSvgEditor";
import {
  applyPathSegXyPairs,
  parsePathD,
  pathSegXyPairs,
  serializePathD,
  type PathSeg,
} from "@/utils/pathDEdit";
import { DEFAULT_FILL_HEX } from "@/utils/fillColor";

const props = defineProps<{
  visible: boolean;
  /** Full `<s3dx:section>…</s3dx:section>` markup. */
  sectionXml: string;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  confirm: [childrenXml: string];
}>();

const { t, elementLabel } = useI18n();
const hostRef = ref<HTMLElement | null>(null);
const textRef = ref<HTMLInputElement | null>(null);
const mode = ref("select");
const error = ref("");
const ready = ref(false);
const drafts = ref<SectionShapeDraft[]>([]);
const actived = ref<string[]>(["__section__"]);
const selectedId = ref<string>("__section__");
const canvasSize = ref({ w: 640, h: 480 });
/** Skip canvas→draft sync while remounting from property edits. */
let suppressCanvasSync = false;
let shapeSeq = 0;
let resizeObs: ResizeObserver | null = null;

let canvas: InstanceType<typeof SvgCanvas> | null = null;

type TreeRow = {
  value: string;
  label: string;
  children?: TreeRow[];
};

const treeData = computed<TreeRow[]>(() => [
  {
    value: "__section__",
    label: elementLabel("section"),
    children: drafts.value.map((d) => ({
      value: d.id,
      label: d.tag,
    })),
  },
]);

const selectedDraft = computed(
  () => drafts.value.find((d) => d.id === selectedId.value) ?? null
);

/** Local attr draft for the selected shape — commit on blur to remount canvas. */
const attrDraft = ref<Record<string, string>>({});
const pathSegDraft = ref<PathSeg[]>([]);

const simpleAttrNames = computed(() => {
  const d = selectedDraft.value;
  if (!d) return [] as string[];
  if (d.tag === "path") return [] as string[];
  return geomAttrsForTag(d.tag);
});

/** Scalar attrs that are naturally an xy pair (circle cx/cy, rect x/y). */
const xyAttrGroups = computed(() => {
  const d = selectedDraft.value;
  if (!d) return [] as Array<{ key: string; names: [string, string] }>;
  if (d.tag === "circle" || d.tag === "ellipse") {
    return [{ key: "cxy", names: ["cx", "cy"] as [string, string] }];
  }
  if (d.tag === "rect") {
    return [{ key: "xy", names: ["x", "y"] as [string, string] }];
  }
  return [];
});

const scalarAttrNames = computed(() => {
  const paired = new Set(
    xyAttrGroups.value.flatMap((g) => g.names)
  );
  return simpleAttrNames.value.filter((n) => !paired.has(n));
});

function seedAttrDraft(d: SectionShapeDraft | null): void {
  if (!d) {
    attrDraft.value = {};
    pathSegDraft.value = [];
    return;
  }
  attrDraft.value = parseElementAttrs(d.xml);
  pathSegDraft.value =
    d.tag === "path" ? parsePathD(attrDraft.value.d ?? "") : [];
}

watch(selectedDraft, (d) => seedAttrDraft(d), { immediate: true });

function close(): void {
  emit("update:visible", false);
}

function setMode(next: string): void {
  mode.value = next;
  canvas?.setMode(next);
}

function nextShapeId(): string {
  return `shape-${++shapeSeq}`;
}

function destroyCanvas(): void {
  canvas = null;
  ready.value = false;
  if (hostRef.value) hostRef.value.innerHTML = "";
}

function measureHost(): { w: number; h: number } {
  const host = hostRef.value;
  if (!host) return canvasSize.value;
  const w = Math.max(120, Math.floor(host.clientWidth));
  const h = Math.max(120, Math.floor(host.clientHeight));
  return { w, h };
}

async function mountCanvas(): Promise<void> {
  destroyCanvas();
  error.value = "";
  await nextTick();
  const host = hostRef.value;
  if (!host) {
    error.value = t("app.shapeEditorLoadFailed");
    return;
  }
  const { w, h } = measureHost();
  canvasSize.value = { w, h };
  try {
    // Stroke = default solid fill blue; fill none — profiles are contours.
    const strokeHex = DEFAULT_FILL_HEX.replace(/^#/, "");
    canvas = new SvgCanvas(host, {
      initFill: { color: "FFFFFF", opacity: 0 },
      initStroke: { color: strokeHex, opacity: 1, width: 2 },
      initOpacity: 1,
      dimensions: [w, h],
      baseUnit: "px",
    });
    if (textRef.value) {
      canvas.textActions?.setInputElem?.(textRef.value);
    }
    const svg = wrapShapesInSvg(
      drafts.value.map((d) => d.xml),
      [w, h]
    );
    const ok = canvas.setSvgString(svg, true);
    if (!ok) {
      error.value = t("app.shapeEditorLoadFailed");
      destroyCanvas();
      return;
    }
    const withUpdate = canvas as InstanceType<typeof SvgCanvas> & {
      updateCanvas?: (cw: number, ch: number) => void;
      setBackground?: (color: string, url?: string) => void;
    };
    canvas.setResolution(w, h);
    withUpdate.updateCanvas?.(w, h);
    withUpdate.setBackground?.(themeCanvasBg());
    applyProfilePresentation();
    canvas.setMode(mode.value || "select");
    canvas.bind("changed", onCanvasChanged);
    canvas.bind("selected", onCanvasSelected);
    ready.value = true;
  } catch (e) {
    console.error(e);
    error.value = t("app.shapeEditorLoadFailed");
    destroyCanvas();
  }
}

/** Match Studio / viewer default solid color; no fill (contour only). */
function applyProfilePresentation(): void {
  const root = canvas?.getSvgContent?.();
  if (!root) return;
  const shapes = root.querySelectorAll(
    "path,circle,ellipse,rect,polygon,polyline"
  );
  for (const el of Array.from(shapes)) {
    el.setAttribute("fill", "none");
    el.setAttribute("fill-opacity", "0");
    el.setAttribute("stroke", DEFAULT_FILL_HEX);
    el.setAttribute("stroke-width", "2");
    el.setAttribute("stroke-opacity", "1");
  }
}

function themeCanvasBg(): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--td-bg-color-container")
    .trim();
  return raw || "#ffffff";
}

function onCanvasChanged(): void {
  if (suppressCanvasSync) return;
  applyProfilePresentation();
  syncDraftsFromCanvas();
}

function onCanvasSelected(elems: Element[]): void {
  if (suppressCanvasSync) return;
  const el = elems?.[0] as SVGElement | undefined;
  if (!el) {
    selectedId.value = "__section__";
    actived.value = ["__section__"];
    return;
  }
  const root: Element | null =
    canvas?.getSvgContent?.() ?? el.ownerSVGElement ?? null;
  if (!root) return;
  const all = Array.from(
    root.querySelectorAll("path,circle,ellipse,rect,polygon,polyline")
  ).filter(
    (n) => (n as Element).parentElement?.localName !== "defs"
  ) as Element[];
  const idx = all.indexOf(el);
  const hit = idx >= 0 ? drafts.value[idx] : null;
  if (hit) {
    selectedId.value = hit.id;
    actived.value = [hit.id];
  }
}

function syncDraftsFromCanvas(): void {
  if (!canvas) return;
  const next = extractShapesFromSvg(canvas.getSvgString());
  const prev = drafts.value;
  drafts.value = next.map((s, i) => ({
    ...s,
    id: prev[i]?.id ?? nextShapeId(),
  }));
  if (
    selectedId.value !== "__section__" &&
    !drafts.value.some((d) => d.id === selectedId.value)
  ) {
    selectedId.value = "__section__";
    actived.value = ["__section__"];
  }
}

async function remountFromDrafts(): Promise<void> {
  suppressCanvasSync = true;
  await mountCanvas();
  suppressCanvasSync = false;
}

function onTreeActive(vals: Array<string | number | bigint>): void {
  const id = String(vals[0] ?? "__section__");
  selectedId.value = id;
  actived.value = [id];
}

function addShape(kind: string): void {
  const snippet =
    SECTION_SHAPE_SNIPPETS[kind as keyof typeof SECTION_SHAPE_SNIPPETS];
  if (!snippet) return;
  const tag = kind.replace(/^svg-/, "");
  const id = nextShapeId();
  drafts.value = [...drafts.value, { id, tag, xml: snippet.trim() }];
  selectedId.value = id;
  actived.value = [id];
  void remountFromDrafts();
}

function removeShape(id: string): void {
  drafts.value = drafts.value.filter((d) => d.id !== id);
  selectedId.value = "__section__";
  actived.value = ["__section__"];
  void remountFromDrafts();
}

function pathInsertMenuOptions(items: PathInsertMenuItem[]): DropdownOption[] {
  return items.map((p) => ({
    content: locale.value === "zh" ? p.labelZh : p.labelEn,
    value: p.kind,
    prefixIcon: () => h(PathIcon),
  }));
}

const DRAW_MODE_VALUES = new Set(["select", "path", "circle", "rect"]);

const sectionRootMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.shapeEditorSelect"),
    value: "select",
    prefixIcon: () => h(CursorIcon),
  },
  {
    content: t("app.shapeEditorPath"),
    value: "path",
    prefixIcon: () => h(PathIcon),
  },
  {
    content: t("app.shapeEditorCircle"),
    value: "circle",
    prefixIcon: () => h(PathIcon),
  },
  {
    content: t("app.shapeEditorRect"),
    value: "rect",
    prefixIcon: () => h(PathIcon),
  },
  {
    content: "",
    value: "__divider",
    divider: true,
  },
  {
    content: t("app.addSectionShape"),
    value: "__add-section-shape",
    prefixIcon: () => h(PathIcon),
    children: pathInsertMenuOptions(SECTION_SHAPE_MENU),
  },
]);

const shapeMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.deleteNode"),
    value: "delete",
    theme: "error",
    prefixIcon: () => h(DeleteIcon),
  },
]);

function onRootMoreClick(item: { value?: string | number | object }): void {
  const value = item?.value;
  if (typeof value !== "string") return;
  if (value === "__add-section-shape" || value === "__divider") return;
  if (DRAW_MODE_VALUES.has(value)) {
    setMode(value);
    return;
  }
  if (value.startsWith("svg-")) addShape(value);
}

function onShapeMoreClick(
  shapeId: string,
  item: { value?: string | number | object }
): void {
  if (item?.value === "delete") removeShape(shapeId);
}

function commitSelectedAttrs(): void {
  const d = selectedDraft.value;
  if (!d) return;
  const attrs = { ...attrDraft.value };
  if (d.tag === "path") {
    attrs.d = serializePathD(pathSegDraft.value);
  }
  const xml = buildShapeXml(d.tag, attrs);
  if (xml === d.xml) return;
  drafts.value = drafts.value.map((row) =>
    row.id === d.id ? { ...row, xml } : row
  );
  void remountFromDrafts();
}

function setAttrDraft(name: string, value: string): void {
  attrDraft.value = { ...attrDraft.value, [name]: value };
}

function xyAttrValue(names: [string, string]): string {
  const x = attrDraft.value[names[0]] ?? "";
  const y = attrDraft.value[names[1]] ?? "";
  return `${x} ${y}`.trim();
}

function setXyAttrValue(names: [string, string], raw: string): void {
  const parts = raw.trim().split(/[\s,]+/);
  setAttrDraft(names[0], parts[0] ?? "");
  setAttrDraft(names[1], parts[1] ?? "");
}

function pathPairValue(segIndex: number, pairIndex: number): string {
  const seg = pathSegDraft.value[segIndex];
  if (!seg) return "";
  const { pairs } = pathSegXyPairs(seg);
  const pair = pairs[pairIndex];
  if (!pair) return "";
  return `${pair[0]} ${pair[1]}`.trim();
}

function setPathPairValue(
  segIndex: number,
  pairIndex: number,
  raw: string
): void {
  const segs = pathSegDraft.value.map((s) => ({
    cmd: s.cmd,
    values: [...s.values],
  }));
  const seg = segs[segIndex];
  if (!seg) return;
  const grouped = pathSegXyPairs(seg);
  const parts = raw.trim().split(/[\s,]+/);
  grouped.pairs[pairIndex] = [parts[0] ?? "", parts[1] ?? ""];
  segs[segIndex] = applyPathSegXyPairs(seg, grouped.pairs, grouped.scalars);
  pathSegDraft.value = segs;
}

function pathScalarValue(segIndex: number, scalarIndex: number): string {
  const seg = pathSegDraft.value[segIndex];
  if (!seg) return "";
  return pathSegXyPairs(seg).scalars[scalarIndex] ?? "";
}

function setPathScalarValue(
  segIndex: number,
  scalarIndex: number,
  value: string
): void {
  const segs = pathSegDraft.value.map((s) => ({
    cmd: s.cmd,
    values: [...s.values],
  }));
  const seg = segs[segIndex];
  if (!seg) return;
  const grouped = pathSegXyPairs(seg);
  const scalars = [...grouped.scalars];
  scalars[scalarIndex] = value;
  segs[segIndex] = applyPathSegXyPairs(seg, grouped.pairs, scalars);
  pathSegDraft.value = segs;
}

function pathArcScalarLabel(index: number): string {
  return ["rot", "large", "sweep"][index] ?? String(index);
}

function onConfirm(): void {
  if (canvas) {
    suppressCanvasSync = true;
    syncDraftsFromCanvas();
    suppressCanvasSync = false;
  }
  if (!drafts.value.length) {
    error.value = t("app.sectionProfileEmpty");
    return;
  }
  emit("confirm", serializeSectionShapeDrafts(drafts.value));
  close();
}

function loadFromProps(): void {
  const parsed = parseSectionShapeDrafts(props.sectionXml);
  shapeSeq = 0;
  drafts.value = parsed.map((p) => ({
    ...p,
    id: nextShapeId(),
  }));
  selectedId.value = "__section__";
  actived.value = ["__section__"];
  mode.value = "select";
}

function bindResizeObserver(): void {
  resizeObs?.disconnect();
  resizeObs = null;
  const host = hostRef.value;
  if (!host || typeof ResizeObserver === "undefined") return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  resizeObs = new ResizeObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!props.visible || !canvas) return;
      const { w, h } = measureHost();
      if (w === canvasSize.value.w && h === canvasSize.value.h) return;
      canvasSize.value = { w, h };
      void remountFromDrafts();
    }, 80);
  });
  resizeObs.observe(host);
}

watch(
  () => props.visible,
  async (open) => {
    if (open) {
      loadFromProps();
      await remountFromDrafts();
      bindResizeObserver();
    } else {
      resizeObs?.disconnect();
      resizeObs = null;
      destroyCanvas();
      drafts.value = [];
      error.value = "";
    }
  }
);

onBeforeUnmount(() => {
  resizeObs?.disconnect();
  destroyCanvas();
});
</script>

<template>
  <t-dialog
    :visible="visible"
    :header="t('app.sectionProfileTitle')"
    :width="1080"
    :footer="false"
    destroy-on-close
    placement="center"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="section-profile">
      <aside class="panel panel--tree">
        <t-tree
          :data="treeData"
          :actived="actived"
          activable
          hover
          expand-all
          :transition="false"
          line
          @active="onTreeActive"
        >
          <template #label="{ node }">
            <div class="tree-label">
              <span class="tree-label__icon">
                <LayersIcon
                  v-if="(node as TreeNodeModel).value === '__section__'"
                  size="14px"
                />
                <PathIcon v-else :size="14" :stroke-width="1.75" />
              </span>
              <span class="tree-label__text">{{
                (node as TreeNodeModel).label
              }}</span>
              <t-dropdown
                v-if="(node as TreeNodeModel).value === '__section__'"
                :options="sectionRootMoreOptions"
                :max-column-width="200"
                :min-column-width="120"
                :max-height="420"
                trigger="click"
                placement="bottom-right"
                @click="onRootMoreClick"
              >
                <t-button
                  class="tree-action"
                  theme="default"
                  shape="square"
                  variant="text"
                  size="small"
                  :title="t('app.moreActions')"
                  @mousedown.stop
                  @click.stop
                >
                  <template #icon><MoreIcon /></template>
                </t-button>
              </t-dropdown>
              <t-dropdown
                v-else
                :options="shapeMoreOptions"
                trigger="click"
                placement="bottom-right"
                @click="
                  (item) =>
                    onShapeMoreClick(
                      String((node as TreeNodeModel).value),
                      item
                    )
                "
              >
                <t-button
                  class="tree-action"
                  theme="default"
                  shape="square"
                  variant="text"
                  size="small"
                  :title="t('app.moreActions')"
                  @mousedown.stop
                  @click.stop
                >
                  <template #icon><MoreIcon /></template>
                </t-button>
              </t-dropdown>
            </div>
          </template>
        </t-tree>
      </aside>

      <section class="panel panel--canvas">
        <p v-if="error" class="error">{{ error }}</p>
        <div ref="hostRef" class="canvas-host" />
        <input ref="textRef" class="hidden-text" aria-hidden="true" />
      </section>

      <aside class="panel panel--props">
        <div class="props-header">{{ t("app.attributes") }}</div>
        <template v-if="selectedDraft">
          <div class="param-list">
            <template v-if="selectedDraft.tag === 'path'">
              <div
                v-for="(seg, si) in pathSegDraft"
                :key="`seg-${si}`"
                class="param-row"
              >
                <span class="name" :title="seg.cmd">{{ seg.cmd }}</span>
                <div class="value-cell">
                  <template v-if="seg.cmd.toUpperCase() === 'Z'">
                    <span class="muted-value">Z</span>
                  </template>
                  <template v-else-if="seg.cmd.toUpperCase() === 'A'">
                    <VecRgbInput
                      :model-value="pathPairValue(si, 0)"
                      :max-components="2"
                      class="value-input"
                      placeholder="rx ry"
                      @update:model-value="setPathPairValue(si, 0, $event)"
                      @blur="commitSelectedAttrs"
                      @enter="commitSelectedAttrs"
                    />
                    <div
                      v-for="(_, sci) in 3"
                      :key="`arc-s-${si}-${sci}`"
                      class="arc-scalar"
                    >
                      <span class="arc-scalar__label">{{
                        pathArcScalarLabel(sci)
                      }}</span>
                      <ExprAttrInput
                        :model-value="pathScalarValue(si, sci)"
                        class="value-input"
                        :show-result="false"
                        @update:model-value="
                          setPathScalarValue(si, sci, $event)
                        "
                        @blur="commitSelectedAttrs"
                        @enter="commitSelectedAttrs"
                      />
                    </div>
                    <VecRgbInput
                      :model-value="pathPairValue(si, 1)"
                      :max-components="2"
                      class="value-input"
                      placeholder="x y"
                      @update:model-value="setPathPairValue(si, 1, $event)"
                      @blur="commitSelectedAttrs"
                      @enter="commitSelectedAttrs"
                    />
                  </template>
                  <template
                    v-else-if="
                      seg.cmd.toUpperCase() === 'H' ||
                      seg.cmd.toUpperCase() === 'V'
                    "
                  >
                    <ExprAttrInput
                      v-for="(_, sci) in pathSegXyPairs(seg).scalars"
                      :key="`sc-${si}-${sci}`"
                      :model-value="pathScalarValue(si, sci)"
                      class="value-input"
                      :show-result="false"
                      @update:model-value="setPathScalarValue(si, sci, $event)"
                      @blur="commitSelectedAttrs"
                      @enter="commitSelectedAttrs"
                    />
                  </template>
                  <template v-else>
                    <VecRgbInput
                      v-for="(_, pi) in pathSegXyPairs(seg).pairs"
                      :key="`pair-${si}-${pi}`"
                      :model-value="pathPairValue(si, pi)"
                      :max-components="2"
                      class="value-input"
                      placeholder="x y"
                      @update:model-value="setPathPairValue(si, pi, $event)"
                      @blur="commitSelectedAttrs"
                      @enter="commitSelectedAttrs"
                    />
                  </template>
                </div>
              </div>
              <p v-if="!pathSegDraft.length" class="props-empty">
                {{ t("app.unsetHint") }}
              </p>
            </template>
            <template v-else>
              <div
                v-for="group in xyAttrGroups"
                :key="group.key"
                class="param-row"
              >
                <span class="name">{{ group.names.join(",") }}</span>
                <div class="value-cell">
                  <VecRgbInput
                    :model-value="xyAttrValue(group.names)"
                    :max-components="2"
                    class="value-input"
                    :placeholder="`${group.names[0]} ${group.names[1]}`"
                    @update:model-value="setXyAttrValue(group.names, $event)"
                    @blur="commitSelectedAttrs"
                    @enter="commitSelectedAttrs"
                  />
                </div>
              </div>
              <div
                v-for="name in scalarAttrNames"
                :key="name"
                class="param-row"
              >
                <span class="name">{{ name }}</span>
                <div class="value-cell">
                  <ExprAttrInput
                    :model-value="attrDraft[name] ?? ''"
                    class="value-input"
                    :show-result="false"
                    :placeholder="t('app.unsetHint')"
                    @update:model-value="setAttrDraft(name, $event)"
                    @blur="commitSelectedAttrs"
                    @enter="commitSelectedAttrs"
                  />
                </div>
              </div>
            </template>
          </div>
        </template>
        <p v-else class="props-empty">{{ t("app.sectionProfilePickShape") }}</p>
      </aside>
    </div>

    <div class="actions">
      <t-button variant="outline" @click="close">{{ t("app.cancel") }}</t-button>
      <t-button
        theme="primary"
        :disabled="!!error || !ready"
        @click="onConfirm"
        >{{ t("app.shapeEditorApply") }}</t-button
      >
    </div>
  </t-dialog>
</template>

<style scoped>
.section-profile {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) 260px;
  gap: 12px;
  height: min(70vh, 640px);
  min-height: 480px;
}
.panel {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
  min-height: 0;
  overflow: auto;
}
.panel--tree {
  padding: 8px 4px;
}
.panel--canvas {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  background: var(--td-bg-color-container);
}
.panel--props {
  padding: 8px 10px;
}
.tree-label {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.tree-label__icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}
.tree-label__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tree-action {
  flex-shrink: 0;
  margin-left: auto;
}
.canvas-host {
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  background: var(--td-bg-color-container);
  overflow: hidden;
}
.canvas-host :deep(#svgroot),
.canvas-host :deep(svg) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
/* SvgCanvas paints a white #canvasBackground rect — keep it on theme. */
.canvas-host :deep(#canvasBackground > rect) {
  fill: var(--td-bg-color-container) !important;
}
.canvas-host :deep(#canvasBackground) {
  fill: var(--td-bg-color-container);
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
  padding: 8px;
  color: var(--td-error-color);
  font-size: 13px;
}
.props-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  margin-bottom: 8px;
}
.props-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}
.param-list {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
  background: var(--td-bg-color-container);
}
.param-row {
  display: grid;
  grid-template-columns: minmax(0, 3.5rem) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  width: 100%;
  font-size: 13px;
  box-sizing: border-box;
  padding: 8px 10px;
  border-bottom: 1px solid var(--td-component-border);
}
.param-row:last-child {
  border-bottom: none;
}
.name {
  color: var(--td-text-color-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  line-height: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.value-input {
  min-width: 0;
}
.muted-value {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
  line-height: 28px;
}
.arc-scalar {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: 6px;
  align-items: center;
}
.arc-scalar__label {
  font-size: 11px;
  color: var(--td-text-color-placeholder);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
