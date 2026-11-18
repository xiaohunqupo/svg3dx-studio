<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ChevronLeftIcon,
  DownloadIcon,
  SaveIcon,
  ViewListIcon,
} from "tdesign-icons-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import type { EvaluationResult } from "svg3dx-viewer";
import SettingsMenu from "@/components/SettingsMenu.vue";
import NodeInspectorPanel from "@/components/NodeInspectorPanel.vue";
import NodeTreePanel, {
  type TreeSelectPayload,
} from "@/components/NodeTreePanel.vue";
import SourceEditorPanel from "@/components/SourceEditorPanel.vue";
import EditPageSkeleton from "@/components/skeletons/EditPageSkeleton.vue";
import PanelSkeleton from "@/components/skeletons/PanelSkeleton.vue";
import ViewportSkeleton from "@/components/skeletons/ViewportSkeleton.vue";
import InteractHost from "@/components/InteractHost.vue";
import { useI18n } from "@/i18n";
import { useFilesStore } from "@/stores/files";
import type { AddChildKind } from "@/types/file";
import { downloadText } from "@/utils/storage";
import {
  insertChildIntoGroup,
  insertEmptyGroup,
  insertEmptyMaterial,
  insertEmptyModel,
  insertUseIntoModel,
  removeGroupById,
  removeModelById,
} from "@/utils/svgEdit";
import { optimizeSvg3dxContent } from "@/utils/optimizeContent";
import { setClassRuleProps, setRootRuleProps } from "@/utils/styleClasses";
import { rewriteMaterialIdRefs } from "@/utils/documentMaterials";
import {
  formatXml,
  persistSourceFormatMode,
  readSourceFormatMode,
  type FormatXmlMode,
} from "@/utils/formatXml";
import {
  applyAttrsAtPath,
  normalizeXmlNewlines,
  removeElementAtPath,
} from "@/utils/nodeXmlEdit";

const props = defineProps<{ id: string }>();

const store = useFilesStore();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const TREE_W_KEY = "svg3dx.studio.treeWidth";
const INSPECTOR_W_KEY = "svg3dx.studio.inspectorWidth";
const SOURCE_W_KEY = "svg3dx.studio.sourceWidth";
const SOURCE_H_KEY = "svg3dx.studio.sourceHeight";
const SHOW_MODEL_KEY = "svg3dx.studio.showModel";
const SHOW_SOURCE_KEY = "svg3dx.studio.showSource";
const TREE_W_MIN = 180;
const TREE_W_MAX = 480;
const INSPECTOR_W_MIN = 220;
const INSPECTOR_W_MAX = 520;
const SOURCE_W_MIN = 240;
const SOURCE_W_MAX = 720;
const SOURCE_H_MIN = 120;
const SOURCE_H_DEFAULT = 280;
/** Mid pane (source+viewport) narrower than this → stack vertically. */
const MID_STACK_BREAKPOINT = 680;
const TREE_W_DEFAULT = 260;
const INSPECTOR_W_DEFAULT = 280;
const SOURCE_W_DEFAULT = 360;

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const n = Number(localStorage.getItem(key));
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  } catch {
    /* ignore */
  }
  return fallback;
}

function readStoredBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

const result = ref<EvaluationResult | null>(null);
const selected = ref<TreeSelectPayload | null>(null);
const status = ref("");
const draftContent = ref("");
/** Currently displayed `s3dx:model` id. */
const activeModelId = ref("");
const showModel = ref(readStoredBool(SHOW_MODEL_KEY, true));
const showSource = ref(readStoredBool(SHOW_SOURCE_KEY, false));
const treeWidth = ref(readStoredWidth(TREE_W_KEY, TREE_W_DEFAULT, TREE_W_MIN, TREE_W_MAX));
const inspectorWidth = ref(
  readStoredWidth(INSPECTOR_W_KEY, INSPECTOR_W_DEFAULT, INSPECTOR_W_MIN, INSPECTOR_W_MAX)
);
const sourceWidth = ref(
  readStoredWidth(SOURCE_W_KEY, SOURCE_W_DEFAULT, SOURCE_W_MIN, SOURCE_W_MAX)
);
const sourceHeight = ref(
  readStoredWidth(SOURCE_H_KEY, SOURCE_H_DEFAULT, SOURCE_H_MIN, 800)
);
const resizing = ref<"tree" | "inspector" | "source" | null>(null);
const midEl = ref<HTMLElement | null>(null);
/** Source + model both on; mid pane too narrow → stack source above viewport. */
const midStacked = ref(false);
const treePanel = ref<{
  syncAfterEdit: (
    parentPath?: string,
    opts?: { select?: "last-child" | "self" }
  ) => void;
  selectPath: (path: string | null | undefined) => void;
} | null>(null);
const interactHost = ref<{
  setHighlight: (path: string | null | undefined) => void;
} | null>(null);
const sourcePanel = ref<{
  revealPath: (path: string | null | undefined) => void;
  applyFormat: (text: string, mode?: FormatXmlMode) => Promise<string>;
  measureEditorPrintWidth: () => number;
} | null>(null);
/** Active source format style (pretty | compact). */
const sourceFormatMode = ref<FormatXmlMode>(readSourceFormatMode());
/** True while applying a caret→tree selection (skip source re-reveal scroll). */
let syncingFromSource = false;

function onSourceFormatModeChange(mode: FormatXmlMode): void {
  sourceFormatMode.value = mode;
  persistSourceFormatMode(mode);
}

/** Reformat XML using the active source format mode (for inspector edits). */
async function formatDraftContent(content: string): Promise<string> {
  if (sourcePanel.value) {
    return sourcePanel.value.applyFormat(content, sourceFormatMode.value);
  }
  const printWidth =
    sourceFormatMode.value === "pretty"
      ? Math.max(40, Math.floor((sourceWidth.value - 48) / 8))
      : undefined;
  const result = await formatXml(content, {
    mode: sourceFormatMode.value,
    printWidth,
  });
  return result.ok ? result.content : content;
}

const workspaceEl = ref<HTMLElement | null>(null);
const workspaceStyle = computed(() => ({
  gridTemplateColumns: [
    `${treeWidth.value}px`,
    "0px",
    "minmax(0, 1fr)",
    "0px",
    `${inspectorWidth.value}px`,
  ].join(" "),
}));

const midBoth = computed(() => showSource.value && showModel.value);

const midStyle = computed(() => {
  if (!midBoth.value) return undefined;
  if (midStacked.value) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      // Cap source row so it cannot shove the viewport (and outer inspector) away.
      gridTemplateRows: `minmax(0, ${sourceHeight.value}px) 0px minmax(0, 1fr)`,
    };
  }
  // minmax(0, Npx): source may shrink — fixed Npx was expanding mid and
  // pushing the inspector off-screen when the window was only moderately wide.
  return {
    gridTemplateColumns: `minmax(0, ${sourceWidth.value}px) 0px minmax(0, 1fr)`,
    gridTemplateRows: "minmax(0, 1fr)",
  };
});

function updateMidStack(): void {
  const el = midEl.value;
  if (!el || !midBoth.value) {
    midStacked.value = false;
    return;
  }
  midStacked.value = el.clientWidth < MID_STACK_BREAKPOINT;
}

function persistViewFlags(): void {
  try {
    localStorage.setItem(SHOW_MODEL_KEY, showModel.value ? "1" : "0");
    localStorage.setItem(SHOW_SOURCE_KEY, showSource.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function setShowModel(next: boolean): void {
  if (!next && !showSource.value) return;
  showModel.value = next;
  persistViewFlags();
}

function setShowSource(next: boolean): void {
  if (!next && !showModel.value) return;
  showSource.value = next;
  persistViewFlags();
}

function onViewModelChange(value: boolean | string | number): void {
  setShowModel(Boolean(value));
}

function onViewSourceChange(value: boolean | string | number): void {
  setShowSource(Boolean(value));
}

function revealSelectedInSource(): void {
  if (syncingFromSource) return;
  if (!showSource.value || !sourcePanel.value) return;
  sourcePanel.value.revealPath(selected.value?.path);
}

async function onSourceCursorPath(path: string | null): Promise<void> {
  if (!path) return;
  if (selected.value?.path === path) {
    interactHost.value?.setHighlight(path);
    return;
  }
  // selectPath emits select on a nested nextTick — keep the guard until then
  // so watch(selected) does not scroll/re-reveal the source caret.
  syncingFromSource = true;
  try {
    treePanel.value?.selectPath(path);
    interactHost.value?.setHighlight(path);
    await nextTick();
    await nextTick();
  } finally {
    syncingFromSource = false;
  }
}

const bootstrapping = ref(true);

const file = computed(() => store.getById(props.id) ?? null);
const dirty = computed(() => file.value?.dirty || draftContent.value !== (file.value?.content ?? ""));
const pageReady = computed(() => store.ready && !!file.value && !bootstrapping.value);
const contentLoading = computed(
  () =>
    pageReady.value &&
    showModel.value &&
    !!draftContent.value &&
    !result.value
);

onMounted(async () => {
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
  bootstrapping.value = true;
  if (!store.ready) await store.hydrate();
  syncFromStore();
  bootstrapping.value = false;
});

watch(
  () => props.id,
  () => syncFromStore()
);

watch(
  () => route.params.id,
  () => syncFromStore()
);

watch(selected, () => {
  revealSelectedInSource();
});

watch(showSource, async (visible) => {
  if (!visible) return;
  await nextTick();
  revealSelectedInSource();
});

function syncFromStore(): void {
  const f = store.getById(props.id);
  if (!f) {
    MessagePlugin.warning(t("app.fileMissing"));
    router.replace({ name: "browse" });
    return;
  }
  store.select(f.id);
  // Keep LF so source offsets match CodeMirror (which always normalizes CRLF).
  draftContent.value = normalizeXmlNewlines(f.content);
  selected.value = null;
  result.value = null;
  activeModelId.value = "";
}

function goBrowse(): void {
  router.push({ name: "browse" });
}

function syncActiveModelFromResult(r: EvaluationResult | null): void {
  if (!r?.models?.length) {
    activeModelId.value = "";
    return;
  }
  const ids = new Set(r.models.map((m) => m.id));
  // Prefer evaluator active model so viewport Model bar stays the source of truth.
  if (r.active_model && ids.has(r.active_model)) {
    activeModelId.value = r.active_model;
    return;
  }
  if (activeModelId.value && ids.has(activeModelId.value)) return;
  activeModelId.value =
    r.models.find((m) => m.active)?.id ?? r.models[0]!.id;
}

function onResult(r: EvaluationResult): void {
  result.value = r;
  syncActiveModelFromResult(r);
}

async function onAddGroup(): Promise<void> {
  if (!file.value) return;
  const { content, id } = insertEmptyGroup(draftContent.value);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("defs");
  status.value = `${t("app.addedGroup")} ${id}`;
  MessagePlugin.success(`${t("app.addedGroup")} ${id}`);
}

async function onAddModel(): Promise<void> {
  if (!file.value) return;
  const { content, id } = insertEmptyModel(draftContent.value);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("models");
  status.value = `${t("app.addedModel")} ${id}`;
  MessagePlugin.success(`${t("app.addedModel")} ${id}`);
}

async function onAddMaterial(): Promise<void> {
  if (!file.value) return;
  const { content, id } = insertEmptyMaterial(draftContent.value);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("materials");
  status.value = `${t("app.addedMaterial")} ${id}`;
  MessagePlugin.success(`${t("app.addedMaterial")} ${id}`);
}

async function onAddUse(payload: {
  modelId?: string;
  path: string;
  href?: string;
}): Promise<void> {
  if (!file.value) return;
  const modelId = payload.modelId || activeModelId.value;
  if (!modelId) {
    MessagePlugin.warning(t("app.noActiveModel"));
    return;
  }
  const modelPath = `model:${modelId}`;
  const { content } = insertUseIntoModel(
    draftContent.value,
    modelId,
    payload.href ?? ""
  );
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(modelPath);
  status.value = t("app.addedUse");
  MessagePlugin.success(t("app.addedUse"));
}

async function onAddChild(payload: {
  parentPath: string;
  parentGroupId: string;
  kind: AddChildKind;
}): Promise<void> {
  if (!file.value) return;
  const { content, childId, kind } = insertChildIntoGroup(
    draftContent.value,
    payload.parentGroupId,
    payload.kind
  );
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(payload.parentPath);
  const name = childId ?? kind;
  status.value = `${t("app.addedChild")} ${name}`;
  MessagePlugin.success(`${t("app.addedChild")} ${name}`);
}

function treeParentPath(path: string): string {
  if (path.includes(".")) return path.replace(/\.[^.]+$/, "");
  if (path.startsWith("defs:")) return "defs";
  return "defs";
}

async function onDeleteNode(payload: {
  path: string;
  groupId: string;
}): Promise<void> {
  if (!file.value) return;
  const content = removeGroupById(draftContent.value, payload.groupId);
  if (content === draftContent.value) return;
  const selectPath = treeParentPath(payload.path);
  draftContent.value = content;
  if (selected.value?.kind === "geometry" && selected.value.path === payload.path) {
    selected.value = null;
    interactHost.value?.setHighlight(null);
  }
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(selectPath, { select: "self" });
  status.value = `${t("app.deletedNode")} ${payload.groupId}`;
  MessagePlugin.success(`${t("app.deletedNode")} ${payload.groupId}`);
}

async function onDeleteModel(payload: {
  path: string;
  modelId: string;
}): Promise<void> {
  if (!file.value) return;
  const content = removeModelById(draftContent.value, payload.modelId);
  if (content === draftContent.value) return;
  draftContent.value = content;
  const sel = selected.value;
  if (
    sel &&
    ((sel.kind === "model" && sel.modelId === payload.modelId) ||
      (sel.kind === "geometry" && sel.path.startsWith(`${payload.path}.`)))
  ) {
    selected.value = null;
    interactHost.value?.setHighlight(null);
  }
  if (activeModelId.value === payload.modelId) {
    activeModelId.value = "";
  }
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("models", { select: "self" });
  status.value = `${t("app.deletedNode")} ${payload.modelId}`;
  MessagePlugin.success(`${t("app.deletedNode")} ${payload.modelId}`);
}

async function onDeleteUse(payload: { path: string }): Promise<void> {
  if (!file.value) return;
  const content = removeElementAtPath(draftContent.value, payload.path);
  if (!content || content === draftContent.value) return;
  const selectPath = treeParentPath(payload.path);
  draftContent.value = content;
  if (selected.value?.kind === "geometry" && selected.value.path === payload.path) {
    selected.value = null;
    interactHost.value?.setHighlight(null);
  }
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(selectPath, { select: "self" });
  status.value = t("app.deletedNode");
  MessagePlugin.success(t("app.deletedNode"));
}

async function onOptimize(): Promise<void> {
  if (!file.value) return;
  const { content, changed, stats } = optimizeSvg3dxContent(draftContent.value);
  if (!changed) {
    MessagePlugin.info(t("app.optimizeNoChange"));
    status.value = t("app.optimizeNoChange");
    return;
  }
  draftContent.value = content;
  selected.value = null;
  interactHost.value?.setHighlight(null);
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("models", { select: "self" });
  const n =
    stats.removedUses +
    stats.removedGroups +
    stats.removedContainers +
    stats.removedMaterials +
    stats.removedParams;
  const msg = t("app.optimizeDone", { n: String(n) });
  status.value = msg;
  MessagePlugin.success(msg);
}

async function onSave(): Promise<void> {
  if (!file.value) return;
  await store.updateContent(file.value.id, draftContent.value, false);
  await store.persist(file.value.id);
  MessagePlugin.success(t("app.saved"));
  status.value = t("app.saved");
}

function onDownload(): void {
  if (!file.value) return;
  downloadText(file.value.name, draftContent.value);
  MessagePlugin.success(t("app.downloaded"));
}

function onSelect(payload: TreeSelectPayload): void {
  selected.value = payload;
  interactHost.value?.setHighlight(payload.path);
}

function onViewportPick(path: string | null): void {
  if (!path) {
    selected.value = null;
    treePanel.value?.selectPath(null);
    interactHost.value?.setHighlight(null);
    return;
  }
  treePanel.value?.selectPath(path);
}

async function onSourceContent(next: string): Promise<void> {
  if (!file.value) return;
  const normalized = normalizeXmlNewlines(next);
  if (normalized === draftContent.value) return;
  draftContent.value = normalized;
  await store.updateContent(file.value.id, normalized, true);
}

async function onStyleParamsChange(propsMap: Record<string, string>): Promise<void> {
  const sel = selected.value;
  if (!sel || sel.kind !== "style" || !file.value) return;

  const isRoot = sel.scope === "root" || sel.name === ":root";
  const className = isRoot
    ? ":root"
    : sel.name.split(/\s+/).filter(Boolean)[0];
  if (!className) return;

  let next = isRoot
    ? setRootRuleProps(draftContent.value, propsMap)
    : setClassRuleProps(draftContent.value, className, propsMap);
  if (next === draftContent.value) {
    selected.value = { ...sel, props: propsMap };
    return;
  }
  next = await formatDraftContent(next);
  draftContent.value = next;
  selected.value = { ...sel, props: propsMap };
  await store.updateContent(file.value.id, next, true);
  status.value = `${t("app.updatedStyle")} ${isRoot ? ":root" : `.${className}`}`;
  await nextTick();
  revealSelectedInSource();
}

async function onNodeAttrsChange(payload: {
  path: string;
  updates: Record<string, string>;
}): Promise<void> {
  if (!file.value) return;
  let next = applyAttrsAtPath(draftContent.value, payload.path, payload.updates);
  if (!next || next === draftContent.value) return;

  const sel = selected.value;
  if (sel?.kind === "material" && payload.path.startsWith("material:")) {
    const oldId = payload.path.slice("material:".length);
    const newId = (payload.updates.id ?? oldId).trim() || oldId;
    if (newId !== oldId) {
      next = rewriteMaterialIdRefs(next, oldId, newId);
    }
    next = await formatDraftContent(next);
    const newPath = `material:${newId}`;
    selected.value = {
      kind: "material",
      path: newPath,
      materialId: newId,
      color:
        payload.updates.color !== undefined
          ? payload.updates.color || undefined
          : sel.color,
      metalness:
        payload.updates.metalness !== undefined
          ? payload.updates.metalness || undefined
          : sel.metalness,
      roughness:
        payload.updates.roughness !== undefined
          ? payload.updates.roughness || undefined
          : sel.roughness,
    };
    draftContent.value = next;
    await store.updateContent(file.value.id, next, true);
    status.value = t("app.updatedNode");
    if (newPath !== payload.path) {
      treePanel.value?.syncAfterEdit("materials");
      await nextTick();
      treePanel.value?.selectPath(newPath);
    } else {
      await nextTick();
      revealSelectedInSource();
    }
    return;
  }

  next = await formatDraftContent(next);
  draftContent.value = next;
  await store.updateContent(file.value.id, next, true);
  status.value = t("app.updatedNode");
  await nextTick();
  revealSelectedInSource();
}

function persistWidths(): void {
  try {
    localStorage.setItem(TREE_W_KEY, String(treeWidth.value));
    localStorage.setItem(INSPECTOR_W_KEY, String(inspectorWidth.value));
    localStorage.setItem(SOURCE_W_KEY, String(sourceWidth.value));
    localStorage.setItem(SOURCE_H_KEY, String(sourceHeight.value));
  } catch {
    /* ignore */
  }
}

function onResizeMove(ev: PointerEvent): void {
  const side = resizing.value;
  const root = workspaceEl.value;
  if (!side || !root) return;
  const rect = root.getBoundingClientRect();
  if (side === "tree") {
    treeWidth.value = Math.min(
      TREE_W_MAX,
      Math.max(TREE_W_MIN, ev.clientX - rect.left)
    );
  } else if (side === "source") {
    const mid = midEl.value;
    if (midStacked.value && mid) {
      const midRect = mid.getBoundingClientRect();
      const maxH = Math.max(SOURCE_H_MIN, midRect.height - SOURCE_H_MIN);
      sourceHeight.value = Math.min(
        maxH,
        Math.max(SOURCE_H_MIN, ev.clientY - midRect.top)
      );
    } else {
      const midLeft = mid?.getBoundingClientRect().left ?? rect.left + treeWidth.value;
      sourceWidth.value = Math.min(
        SOURCE_W_MAX,
        Math.max(SOURCE_W_MIN, ev.clientX - midLeft)
      );
    }
  } else {
    inspectorWidth.value = Math.min(
      INSPECTOR_W_MAX,
      Math.max(INSPECTOR_W_MIN, rect.right - ev.clientX)
    );
  }
}

function startResize(side: "tree" | "inspector" | "source", ev: PointerEvent): void {
  ev.preventDefault();
  resizing.value = side;
  const row = side === "source" && midStacked.value;
  document.body.style.cursor = row ? "row-resize" : "col-resize";
  document.body.style.userSelect = "none";
  workspaceEl.value?.classList.toggle("row-resize", row);
}

function stopResize(): void {
  if (!resizing.value) return;
  resizing.value = null;
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  workspaceEl.value?.classList.remove("row-resize");
  persistWidths();
}

watch(midEl, (el, _prev, onCleanup) => {
  if (!el || typeof ResizeObserver === "undefined") return;
  const ro = new ResizeObserver(() => updateMidStack());
  ro.observe(el);
  updateMidStack();
  onCleanup(() => ro.disconnect());
});

watch(midBoth, async () => {
  await nextTick();
  updateMidStack();
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
  stopResize();
});
</script>

<template>
  <EditPageSkeleton v-if="!pageReady" />

  <div v-else-if="file" class="edit-page">
    <header class="topbar">
      <div class="brand">
        <img class="logo" src="/logo.png" alt="svg3dx studio" width="28" height="28" />
        <span class="product">svg3dx Studio</span>
      </div>
      <div class="actions">
        <SettingsMenu />
        <t-button variant="text" @click="goBrowse">
          <template #icon><ChevronLeftIcon /></template>
          {{ t("app.backBrowse") }}
        </t-button>
      </div>
      <div class="file-name">
        {{ file.name }}
        <t-tag
          v-if="dirty"
          class="dirty-tag"
          size="small"
          theme="warning"
          variant="light"
        >
          {{ t("app.unsaved") }}
        </t-tag>
      </div>
      <div class="view-menu">
        <t-popup
          trigger="click"
          placement="bottom"
          :overlay-inner-style="{ padding: 0 }"
        >
          <t-button variant="text">
            <template #icon><ViewListIcon /></template>
            {{ t("app.view") }}
          </t-button>
          <template #content>
            <t-space
              class="view-menu-panel"
              direction="vertical"
              size="small"
              role="menu"
            >
              <t-checkbox
                :checked="showModel"
                @change="onViewModelChange"
              >
                {{ t("app.viewModel") }}
              </t-checkbox>
              <t-checkbox
                :checked="showSource"
                @change="onViewSourceChange"
              >
                {{ t("app.viewSource") }}
              </t-checkbox>
            </t-space>
          </template>
        </t-popup>
      </div>
      <div class="right">
        <span class="status">{{ status }}</span>
        <t-button variant="outline" @click="onDownload">
          <template #icon><DownloadIcon /></template>
          {{ t("app.export") }}
        </t-button>
        <t-button theme="primary" @click="onSave">
          <template #icon><SaveIcon /></template>
          {{ t("app.save") }}
        </t-button>
      </div>
    </header>

    <div
      ref="workspaceEl"
      class="workspace"
      :class="{ resizing: !!resizing }"
      :style="workspaceStyle"
    >
      <NodeTreePanel
        ref="treePanel"
        class="tree"
        :result="result"
        :content="draftContent"
        :loading="contentLoading"
        @select="onSelect"
        @add-group="onAddGroup"
        @add-model="onAddModel"
        @add-material="onAddMaterial"
        @add-use="onAddUse"
        @add-child="onAddChild"
        @delete-node="onDeleteNode"
        @delete-model="onDeleteModel"
        @delete-use="onDeleteUse"
        @optimize="onOptimize"
      />
      <div
        class="resize-handle resize-handle--tree"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="treeWidth"
        :title="t('app.resizePanel')"
        @pointerdown="(e) => startResize('tree', e)"
      />

      <div
        ref="midEl"
        class="mid"
        :class="{
          'mid--both': midBoth,
          'mid--stacked': midBoth && midStacked,
          'mid--source-only': showSource && !showModel,
          'mid--model-only': showModel && !showSource,
        }"
        :style="midStyle"
      >
        <SourceEditorPanel
          v-if="showSource"
          ref="sourcePanel"
          class="source"
          :heading="t('app.sourceCode')"
          :model-value="draftContent"
          :format-mode="sourceFormatMode"
          @update:model-value="onSourceContent"
          @update:format-mode="onSourceFormatModeChange"
          @cursor-path="onSourceCursorPath"
        />
        <div
          v-if="midBoth"
          class="resize-handle"
          :class="
            midStacked
              ? 'resize-handle--source-row'
              : 'resize-handle--source'
          "
          role="separator"
          :aria-orientation="midStacked ? 'horizontal' : 'vertical'"
          :aria-valuenow="midStacked ? sourceHeight : sourceWidth"
          :title="t('app.resizePanel')"
          @pointerdown="(e) => startResize('source', e)"
        />
        <main v-if="showModel" class="viewport">
          <ViewportSkeleton v-if="contentLoading" />
          <InteractHost
            ref="interactHost"
            :key="file.id"
            :content="draftContent"
            :model="activeModelId || undefined"
            @result="onResult"
            @error="(m) => (status = m)"
            @pick="onViewportPick"
          />
        </main>
      </div>

      <div
        class="resize-handle resize-handle--inspector"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="inspectorWidth"
        :title="t('app.resizePanel')"
        @pointerdown="(e) => startResize('inspector', e)"
      />
      <aside class="inspector">
        <div class="panel-head">
          {{ selected?.kind === "style" ? t("app.styleParams") : t("app.nodeParams") }}
        </div>
        <PanelSkeleton v-if="contentLoading && !selected" :rows="5" />
        <NodeInspectorPanel
          v-else
          :selected="selected"
          :content="draftContent"
          @style-params-change="onStyleParamsChange"
          @node-attrs-change="onNodeAttrsChange"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.edit-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.topbar {
  position: relative;
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.logo {
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 4px;
}

.product {
  font-weight: 600;
  font-size: 15px;
}

.actions,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.file-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.dirty-tag {
  flex-shrink: 0;
}

.view-menu {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1;
}

.view-menu-panel {
  min-width: 140px;
  padding: 10px 12px;
}

.right {
  margin-left: auto;
}

.status {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 260px 0px minmax(0, 1fr) 0px 280px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.workspace.resizing {
  cursor: col-resize;
}

.workspace.resizing:has(.resize-handle--source-row:hover),
.workspace.resizing.row-resize {
  cursor: row-resize;
}

.mid {
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.mid--source-only,
.mid--model-only {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.tree,
.source,
.inspector {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.source {
  overflow: hidden;
}

.viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--td-bg-color-page);
}

.resize-handle {
  position: relative;
  width: 0;
  margin: 0 -3px;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
}

.resize-handle--source-row {
  width: auto;
  height: 0;
  margin: -3px 0;
  cursor: row-resize;
}

.resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 6px;
  background: transparent;
  transition: background 0.12s ease;
}

.resize-handle--source-row::after {
  top: -3px;
  bottom: auto;
  left: 0;
  right: 0;
  width: auto;
  height: 6px;
}

.resize-handle:hover::after,
.workspace.resizing .resize-handle::after {
  background: var(--td-brand-color-light);
}

.inspector {
  background: var(--td-bg-color-container);
  border-left: 1px solid var(--td-component-border);
  padding: 10px 12px;
  overflow: auto;
}

.panel-head {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--td-text-color-secondary);
  margin-bottom: 8px;
}

/* Keep inspector visible; narrow mid panes stack via midStacked instead.
 * Old max-width:960 rule hid the inspector and left users thinking it was
 * “pushed off screen”. */
@media (max-width: 720px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .tree,
  .resize-handle--tree,
  .resize-handle--inspector,
  .inspector {
    display: none;
  }
}
</style>
