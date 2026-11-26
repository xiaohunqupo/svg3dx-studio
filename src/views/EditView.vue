<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MoreIcon } from "tdesign-icons-vue-next";
import { MessagePlugin, type DropdownOption } from "tdesign-vue-next";
import { clearGltfCache, type EvaluationResult } from "svg3dx-viewer";
import AppMenus from "@/components/AppMenus.vue";
import AiChatHeaderButton from "@/components/AiChatHeaderButton.vue";
import ReposMenu from "@/components/ReposMenu.vue";
import SettingsMenu from "@/components/SettingsMenu.vue";
import NodeInspectorPanel from "@/components/NodeInspectorPanel.vue";
import NodeTreePanel, {
  type TreeSelectPayload,
} from "@/components/NodeTreePanel.vue";
import SectionProfileEditorDialog from "@/components/SectionProfileEditorDialog.vue";
import SourceEditorPanel from "@/components/SourceEditorPanel.vue";
import EditPageSkeleton from "@/components/skeletons/EditPageSkeleton.vue";
import PanelSkeleton from "@/components/skeletons/PanelSkeleton.vue";
import ViewportSkeleton from "@/components/skeletons/ViewportSkeleton.vue";
import InteractHost from "@/components/InteractHost.vue";
import AnimationTimelineBar from "@/components/AnimationTimelineBar.vue";
import {
  registerStudioEditBridge,
  type StudioEditToolResult,
} from "@/chat/editBridge";
import { useDocumentAssets } from "@/composables/useDocumentAssets";
import { useStudioAiAssistantEnabled } from "@/composables/useStudioAiAssistant";
import { useStudioNavigation } from "@/composables/useStudioNavigation";
import type { DrillCrumb, InteractViewport } from "@/interact";
import type { EmbedViewer } from "svg3dx-viewer";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/stores/chat";
import { useFilesStore } from "@/stores/files";
import type { AddChildKind } from "@/types/file";
import { downloadBlob, downloadText } from "@/utils/storage";
import {
  bytesToBlob,
  packageDownloadName,
  writeSvg3dxzBytes,
} from "@/utils/svg3dxz";
import {
  gltfSnippet,
  insertChildIntoGroup,
  insertEmptyGroup,
  insertEmptyMaterial,
  insertEmptyModel,
  insertRootAnimate,
  insertUseIntoModel,
  removeGroupById,
  removeModelById,
  snippetForPathInsert,
} from "@/utils/svgEdit";
import { optimizeSvg3dxContent } from "@/utils/optimizeContent";
import {
  insertEmptyStyleCategory,
  removeStyleCategory,
  renameStyleCategory,
  setClassRuleProps,
  setRootRuleProps,
} from "@/utils/styleClasses";
import { rewriteMaterialIdRefs } from "@/utils/documentMaterials";
import {
  formatXml,
  persistSourceFormatMode,
  readSourceFormatMode,
  type FormatXmlMode,
} from "@/utils/formatXml";
import {
  applyAttrsAtPath,
  insertXmlAtPath,
  nodeKindAtPath,
  normalizeXmlNewlines,
  readAttrsAtPath,
  removeElementAtPath,
  replaceChildrenAtPath,
} from "@/utils/nodeXmlEdit";
import {
  isSectionEditable,
  readSectionElementXml,
} from "@/utils/shapeSvgEditor";

const props = withDefaults(
  defineProps<{
    id: string;
    showReposMenu?: boolean;
    showSettingsMenu?: boolean;
    /** Hide built-in AI chrome on this page. Install `showAiAssistant: false` disables globally. */
    showAiAssistant?: boolean;
  }>(),
  {
    showReposMenu: true,
    showSettingsMenu: true,
    showAiAssistant: true,
  }
);

const store = useFilesStore();
const chatStore = useChatStore();
const showAiAssistant = useStudioAiAssistantEnabled(() => props.showAiAssistant);
const nav = useStudioNavigation();
const { t } = useI18n();

const TREE_W_KEY = "svg3dx.studio.treeWidth";
const INSPECTOR_W_KEY = "svg3dx.studio.inspectorWidth";
const SOURCE_W_KEY = "svg3dx.studio.sourceWidth";
const SOURCE_H_KEY = "svg3dx.studio.sourceHeight";
const SHOW_MODEL_KEY = "svg3dx.studio.showModel";
const SHOW_SOURCE_KEY = "svg3dx.studio.showSource";
const SOURCE_DOCK_KEY = "svg3dx.studio.sourceDock";
/** Legacy key — migrated into SOURCE_DOCK_KEY. */
const SOURCE_SIDE_KEY_LEGACY = "svg3dx.studio.sourceSide";
const SHOW_ANIM_TOOLS_KEY = "svg3dx.studio.showAnimTools";
const SHOW_NODE_PARAMS_KEY = "svg3dx.studio.showNodeParams";
const NODE_PARAMS_DOCK_KEY = "svg3dx.studio.nodeParamsDock";
/** Legacy key — migrated into NODE_PARAMS_DOCK_KEY. */
const NODE_PARAMS_SIDE_KEY_LEGACY = "svg3dx.studio.nodeParamsSide";
const TREE_W_MIN = 180;
const TREE_W_MAX = 480;
const INSPECTOR_W_MIN = 220;
const INSPECTOR_W_MAX = 520;
const INSPECTOR_H_KEY = "svg3dx.studio.inspectorHeight";
const INSPECTOR_H_MIN = 140;
const INSPECTOR_H_DEFAULT = 280;
/** Keep at least this much for the tree when inspector docks under it. */
const TREE_H_MIN = 120;
const SOURCE_W_MIN = 240;
const SOURCE_W_MAX = 720;
const SOURCE_H_MIN = 120;
const SOURCE_H_DEFAULT = 280;

type DockEdge = "left" | "right" | "top" | "bottom";

function readStoredDockWithLegacy(
  key: string,
  legacyKey: string,
  fallback: DockEdge
): DockEdge {
  try {
    const raw = localStorage.getItem(key);
    if (
      raw === "left" ||
      raw === "right" ||
      raw === "top" ||
      raw === "bottom"
    ) {
      return raw;
    }
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === "left" || legacy === "right") return legacy;
  } catch {
    /* ignore */
  }
  return fallback;
}
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
const draftContent = ref("");
/** Document-level undo / redo stacks (snapshots of draftContent). */
const undoStack = ref<string[]>([]);
const redoStack = ref<string[]>([]);
const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);
const HISTORY_MAX = 100;
/** Skip recording while applying undo/redo or hydrating from store. */
let applyingHistory = false;
let historyReady = false;
/** Currently displayed `s3dx:model` id. */
const activeModelId = ref("");
const showModel = ref(readStoredBool(SHOW_MODEL_KEY, true));
const showSource = ref(readStoredBool(SHOW_SOURCE_KEY, false));
const sourceDock = ref<DockEdge>(
  readStoredDockWithLegacy(SOURCE_DOCK_KEY, SOURCE_SIDE_KEY_LEGACY, "left")
);
const showAnimTools = ref(readStoredBool(SHOW_ANIM_TOOLS_KEY, true));
const showNodeParams = ref(readStoredBool(SHOW_NODE_PARAMS_KEY, true));
const nodeParamsDock = ref<DockEdge>(
  readStoredDockWithLegacy(
    NODE_PARAMS_DOCK_KEY,
    NODE_PARAMS_SIDE_KEY_LEGACY,
    "right"
  )
);

const nodeParamsMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.dock"),
    value: "dock",
    children: [
      {
        content: t("app.dockLeft"),
        value: "dock-left",
        active: nodeParamsDock.value === "left",
      },
      {
        content: t("app.dockRight"),
        value: "dock-right",
        active: nodeParamsDock.value === "right",
      },
      {
        content: t("app.dockTop"),
        value: "dock-top",
        active: nodeParamsDock.value === "top",
      },
      {
        content: t("app.dockBottom"),
        value: "dock-bottom",
        active: nodeParamsDock.value === "bottom",
      },
    ],
  },
  {
    content: "",
    value: "__divider",
    divider: true,
  },
  {
    content: t("app.hide"),
    value: "hide",
  },
]);

function onNodeParamsMoreClick(item: DropdownOption): void {
  if (item.value === "dock-left") setNodeParamsDock("left");
  else if (item.value === "dock-right") setNodeParamsDock("right");
  else if (item.value === "dock-top") setNodeParamsDock("top");
  else if (item.value === "dock-bottom") setNodeParamsDock("bottom");
  else if (item.value === "hide") setShowNodeParams(false);
}

const treeWidth = ref(readStoredWidth(TREE_W_KEY, TREE_W_DEFAULT, TREE_W_MIN, TREE_W_MAX));
const inspectorWidth = ref(
  readStoredWidth(INSPECTOR_W_KEY, INSPECTOR_W_DEFAULT, INSPECTOR_W_MIN, INSPECTOR_W_MAX)
);
const inspectorHeight = ref(
  readStoredWidth(INSPECTOR_H_KEY, INSPECTOR_H_DEFAULT, INSPECTOR_H_MIN, 800)
);
const sourceWidth = ref(
  readStoredWidth(SOURCE_W_KEY, SOURCE_W_DEFAULT, SOURCE_W_MIN, SOURCE_W_MAX)
);
const sourceHeight = ref(
  readStoredWidth(SOURCE_H_KEY, SOURCE_H_DEFAULT, SOURCE_H_MIN, 800)
);
const resizing = ref<
  "tree" | "inspector" | "inspector-row" | "source" | "ai" | null
>(null);
const aiMountEl = ref<HTMLElement | null>(null);
const midEl = ref<HTMLElement | null>(null);
const leftRailEl = ref<HTMLElement | null>(null);
const inspectorMountLeft = ref<HTMLElement | null>(null);
const inspectorMountRight = ref<HTMLElement | null>(null);

const inspectorOnRight = computed(
  () => showNodeParams.value && nodeParamsDock.value === "right"
);
/** Left-rail docks: left / top / bottom (right is its own column). */
const inspectorOnLeft = computed(
  () => showNodeParams.value && nodeParamsDock.value !== "right"
);
const inspectorAboveTree = computed(() => nodeParamsDock.value === "top");

const inspectorMountEl = computed(() => {
  if (!showNodeParams.value) return null;
  return inspectorOnLeft.value
    ? inspectorMountLeft.value
    : inspectorMountRight.value;
});

const leftRailStyle = computed(() => {
  if (!inspectorOnLeft.value) return undefined;
  if (inspectorAboveTree.value) {
    return {
      gridTemplateRows: `${inspectorHeight.value}px 0px minmax(0, 1fr)`,
      gridTemplateAreas: `"inspector" "handle" "tree"`,
    };
  }
  return {
    gridTemplateRows: `minmax(0, 1fr) 0px ${inspectorHeight.value}px`,
    gridTemplateAreas: `"tree" "handle" "inspector"`,
  };
});

/** Mid pane too narrow → auto-stack when source dock is left/right. */
const midNarrow = ref(false);
const treePanel = ref<{
  syncAfterEdit: (
    parentPath?: string,
    opts?: { select?: "last-child" | "self" }
  ) => void;
  selectPath: (path: string | null | undefined) => void;
  resyncAfterHistory: (path?: string | null) => boolean;
} | null>(null);
const drillMarks = ref<{ path: string; n: number }[]>([]);
const sectionEditorOpen = ref(false);
const sectionEditorPath = ref("");
const sectionEditorXml = ref("");
const interactHost = ref<{
  setHighlight: (path: string | null | undefined) => void;
  exitDrill: (options?: { select?: string | null }) => void;
  getInteract: () => InteractViewport | null;
} | null>(null);

function getAnimViewer(): EmbedViewer | null {
  return interactHost.value?.getInteract()?.viewer ?? null;
}
const inspectorPanel = ref<{
  applyTransformPreview: (
    path: string,
    transform: string,
    attrs?: Record<string, string>
  ) => void;
  applyPointPick: (pointId: string) => void;
  clearPointPick: () => void;
} | null>(null);
/** When set, next viewport pick of an `<s3dx:point>` writes `ref(#id)`. */
const pointPickTarget = ref<{ path: string; attr: string } | null>(null);
const sourcePanel = ref<{
  revealPath: (
    path: string | null | undefined,
    options?: { scroll?: boolean }
  ) => void;
  applyFormat: (text: string, mode?: FormatXmlMode) => Promise<string>;
  measureEditorPrintWidth: () => number;
  focus: () => void;
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
const workspaceStyle = computed(() => {
  const cols = [
    `${treeWidth.value}px`,
    "0px",
    "minmax(0, 1fr)",
  ];
  if (inspectorOnRight.value) {
    cols.push("0px", `${inspectorWidth.value}px`);
  }
  return { gridTemplateColumns: cols.join(" ") };
});

const aiDockOpen = computed(
  () => showAiAssistant.value && chatStore.open
);

/** Match Browse: AI column sits under the topbar, not full-page height. */
const editBodyStyle = computed(() => {
  if (!aiDockOpen.value) return undefined;
  return {
    gridTemplateColumns: `minmax(0, 1fr) 0px ${chatStore.width}px`,
  };
});

const editBodyEl = ref<HTMLElement | null>(null);

watch(
  [aiMountEl, aiDockOpen],
  ([el, open]) => {
    chatStore.setMountEl(open && el ? el : null);
  },
  { flush: "post" }
);

const midBoth = computed(() => showSource.value && showModel.value);

/** Explicit top/bottom, or auto-stack when left/right and mid is narrow. */
const midStacked = computed(() => {
  if (!midBoth.value) return false;
  const dock = sourceDock.value;
  if (dock === "top" || dock === "bottom") return true;
  return midNarrow.value;
});

/** Source comes before the model in reading order (left/top). */
const sourceFirst = computed(() => {
  const dock = sourceDock.value;
  if (midStacked.value) {
    return dock === "top" || dock === "left";
  }
  return dock === "left" || dock === "top";
});

const midStyle = computed(() => {
  if (!midBoth.value) return undefined;
  if (midStacked.value) {
    // Cap source row so it cannot shove the viewport (and outer inspector) away.
    return sourceFirst.value
      ? {
          gridTemplateColumns: "minmax(0, 1fr)",
          gridTemplateRows: `minmax(0, ${sourceHeight.value}px) 0px minmax(0, 1fr)`,
          gridTemplateAreas: `"source" "handle" "viewport"`,
        }
      : {
          gridTemplateColumns: "minmax(0, 1fr)",
          gridTemplateRows: `minmax(0, 1fr) 0px minmax(0, ${sourceHeight.value}px)`,
          gridTemplateAreas: `"viewport" "handle" "source"`,
        };
  }
  // minmax(0, Npx): source may shrink — fixed Npx was expanding mid and
  // pushing the inspector off-screen when the window was only moderately wide.
  return sourceFirst.value
    ? {
        gridTemplateColumns: `minmax(0, ${sourceWidth.value}px) 0px minmax(0, 1fr)`,
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: `"source handle viewport"`,
      }
    : {
        gridTemplateColumns: `minmax(0, 1fr) 0px minmax(0, ${sourceWidth.value}px)`,
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: `"viewport handle source"`,
      };
});

function updateMidStack(): void {
  const el = midEl.value;
  if (!el || !midBoth.value) {
    midNarrow.value = false;
    return;
  }
  midNarrow.value = el.clientWidth < MID_STACK_BREAKPOINT;
}

function persistViewFlags(): void {
  try {
    localStorage.setItem(SHOW_MODEL_KEY, showModel.value ? "1" : "0");
    localStorage.setItem(SHOW_SOURCE_KEY, showSource.value ? "1" : "0");
    localStorage.setItem(SOURCE_DOCK_KEY, sourceDock.value);
    localStorage.setItem(SHOW_ANIM_TOOLS_KEY, showAnimTools.value ? "1" : "0");
    localStorage.setItem(SHOW_NODE_PARAMS_KEY, showNodeParams.value ? "1" : "0");
    localStorage.setItem(NODE_PARAMS_DOCK_KEY, nodeParamsDock.value);
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

function setSourceDock(dock: DockEdge): void {
  if (sourceDock.value === dock) return;
  sourceDock.value = dock;
  persistViewFlags();
}

function setShowAnimTools(next: boolean): void {
  showAnimTools.value = next;
  persistViewFlags();
}

function setShowNodeParams(next: boolean): void {
  showNodeParams.value = next;
  persistViewFlags();
}

function setNodeParamsDock(dock: DockEdge): void {
  if (nodeParamsDock.value === dock) return;
  nodeParamsDock.value = dock;
  persistViewFlags();
}

/**
 * Keep source reveal marks in sync with `selected`.
 * Caret-driven updates pass `scroll: false` so the view does not jump.
 */
function revealSelectedInSource(options: { scroll?: boolean } = {}): void {
  if (!showSource.value || !sourcePanel.value) return;
  sourcePanel.value.revealPath(selected.value?.path, options);
}

async function onSourceCursorPath(path: string | null): Promise<void> {
  // Blank / non-node caret → clear selection (same as empty viewport click).
  if (!path) {
    if (!selected.value) {
      revealSelectedInSource({ scroll: false });
      return;
    }
    syncingFromSource = true;
    try {
      selected.value = null;
      treePanel.value?.selectPath(null);
      interactHost.value?.setHighlight(null);
      await nextTick();
    } finally {
      syncingFromSource = false;
    }
    revealSelectedInSource({ scroll: false });
    return;
  }
  if (selected.value?.path === path) {
    interactHost.value?.setHighlight(path);
    revealSelectedInSource({ scroll: false });
    return;
  }
  // selectPath emits select on a nested nextTick — keep the guard until then
  // so watch(selected) does not scroll the source under the caret.
  syncingFromSource = true;
  try {
    treePanel.value?.selectPath(path);
    interactHost.value?.setHighlight(path);
    await nextTick();
    await nextTick();
  } finally {
    syncingFromSource = false;
  }
  revealSelectedInSource({ scroll: false });
}

const bootstrapping = ref(true);

const file = computed(() => store.getById(props.id) ?? null);
const dirty = computed(() => file.value?.dirty || draftContent.value !== (file.value?.content ?? ""));
const pageReady = computed(() => store.ready && !!file.value && !bootstrapping.value);
const activeFileId = computed(() => file.value?.id ?? null);
const {
  documentAssetUrls,
  refreshDocumentAssetUrls,
  pickAndAttachGltf,
  listReferencedAssets,
} = useDocumentAssets(activeFileId);
const documentAssetPaths = computed(() =>
  Object.keys(documentAssetUrls.value).sort((a, b) => a.localeCompare(b))
);
const isPackageDocument = computed(() =>
  /\.svg3dxz$/i.test(file.value?.name ?? "")
);
const contentLoading = computed(
  () =>
    pageReady.value &&
    showModel.value &&
    !!draftContent.value &&
    !result.value
);

function editOk(
  message: string,
  data?: unknown
): StudioEditToolResult {
  return data === undefined ? { ok: true, message } : { ok: true, message, data };
}

function editFail(message: string): StudioEditToolResult {
  return { ok: false, message };
}

function getEditSnapshot() {
  const sel = selected.value;
  return {
    fileId: file.value?.id ?? null,
    fileName: file.value?.name ?? null,
    dirty: dirty.value,
    canUndo: canUndo.value,
    canRedo: canRedo.value,
    selectedPath: sel?.path ?? null,
    selectedKind: sel?.kind ?? null,
    activeModelId: activeModelId.value,
    sourceLength: draftContent.value.length,
    panels: {
      model: showModel.value,
      source: showSource.value,
      animTools: showAnimTools.value,
      nodeParams: showNodeParams.value,
    },
  };
}

async function applyBridgeSource(
  next: string,
  message: string
): Promise<StudioEditToolResult> {
  if (!file.value) return editFail("no active file");
  const normalized = normalizeXmlNewlines(next);
  if (normalized === draftContent.value) return editOk("unchanged");
  draftContent.value = normalized;
  selected.value = null;
  interactHost.value?.setHighlight(null);
  await store.updateContent(file.value.id, normalized, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("models", { select: "self" });
  return editOk(message, { length: normalized.length });
}

onMounted(async () => {
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
  window.addEventListener("keydown", onEditKeydown);
  bootstrapping.value = true;
  if (!store.ready) await store.hydrate();
  syncFromStore();
  await refreshDocumentAssetUrls();
  bootstrapping.value = false;

  registerStudioEditBridge({
    getSnapshot: getEditSnapshot,
    getSource: (opts = {}) => {
      const full = draftContent.value;
      const offset = Math.max(0, Math.floor(opts.offset ?? 0));
      const maxChars = Math.max(1, Math.floor(opts.maxChars ?? 120_000));
      const slice = full.slice(offset, offset + maxChars);
      return {
        content: slice,
        truncated: offset + slice.length < full.length || offset > 0,
        length: full.length,
        offset,
      };
    },
    setSource: (content) => applyBridgeSource(content, "source updated"),
    replaceInSource: async ({ find, replace, all }) => {
      const before = draftContent.value;
      if (!before.includes(find)) return editFail("find string not found");
      const parts = before.split(find);
      const count = all ? parts.length - 1 : 1;
      const next = all ? parts.join(replace) : before.replace(find, replace);
      const result = await applyBridgeSource(next, "source replaced");
      if (!result.ok) return result;
      return editOk(result.message, {
        ...(result.data as object),
        replacements: count,
      });
    },
    save: async () => {
      if (!file.value) return editFail("no active file");
      await onSave();
      return editOk("saved", { id: file.value.id });
    },
    undo: async () => {
      if (!canUndo.value) return editFail("nothing to undo");
      await onUndo();
      return editOk("undone", getEditSnapshot());
    },
    redo: async () => {
      if (!canRedo.value) return editFail("nothing to redo");
      await onRedo();
      return editOk("redone", getEditSnapshot());
    },
    format: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onFormatMenu();
      if (draftContent.value === before) return editOk("format unchanged");
      return editOk("formatted", { length: draftContent.value.length });
    },
    optimize: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onOptimize();
      if (draftContent.value === before) return editOk("optimize unchanged");
      return editOk("optimized", { length: draftContent.value.length });
    },
    exportDocument: async () => {
      if (!file.value) return editFail("no active file");
      onDownload();
      return editOk("exported svg3dx", { name: file.value.name });
    },
    exportPackage: async () => {
      if (!file.value) return editFail("no active file");
      await onDownloadPackage();
      return editOk("exported package", {
        name: packageDownloadName(file.value.name),
      });
    },
    getSelection: () => {
      const sel = selected.value;
      if (!sel) return editOk("no selection", null);
      return editOk("selection", {
        kind: sel.kind,
        path: sel.path,
        ...(sel.kind === "geometry"
          ? { className: sel.className }
          : sel.kind === "model"
            ? { modelId: sel.modelId }
            : sel.kind === "material"
              ? { materialId: sel.materialId }
              : { name: sel.name, groupId: sel.groupId, scope: sel.scope }),
      });
    },
    selectPath: async (path) => {
      if (!path) {
        selected.value = null;
        interactHost.value?.setHighlight(null);
        treePanel.value?.selectPath(null);
        return editOk("cleared selection", null);
      }
      treePanel.value?.selectPath(path);
      await nextTick();
      const sel = selected.value;
      if (!sel || sel.path !== path) {
        interactHost.value?.setHighlight(path);
      }
      return editOk("selected", { path, kind: selected.value?.kind ?? null });
    },
    readNodeAttrs: (path) => {
      const attrs = readAttrsAtPath(draftContent.value, path);
      if (!attrs) return editFail(`path not found: ${path}`);
      const kind = nodeKindAtPath(draftContent.value, path);
      return editOk("attrs", { path, kind, attrs });
    },
    updateNodeAttrs: async (path, updates) => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onNodeAttrsChange({ path, updates });
      if (draftContent.value === before) {
        return editFail("attrs unchanged or path not found");
      }
      return editOk("attrs updated", {
        path,
        attrs: readAttrsAtPath(draftContent.value, path),
      });
    },
    addGroup: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onAddGroup();
      if (draftContent.value === before) return editFail("add group failed");
      return editOk("group added");
    },
    addModel: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onAddModel();
      if (draftContent.value === before) return editFail("add model failed");
      return editOk("model added");
    },
    addMaterial: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onAddMaterial();
      if (draftContent.value === before) return editFail("add material failed");
      return editOk("material added");
    },
    addRootAnimate: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onAddRootAnimate();
      if (draftContent.value === before) return editFail("add animate failed");
      return editOk("root animate added");
    },
    addStyleCategory: async () => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      await onAddStyleCategory();
      if (draftContent.value === before) {
        return editFail("add style category failed");
      }
      return editOk("style category added");
    },
    addChild: async (opts) => {
      if (!file.value) return editFail("no active file");
      if (opts.kind === "gltf" && !opts.href?.trim()) {
        return editFail("gltf add_child requires href");
      }
      const before = draftContent.value;
      await onAddChild(opts);
      if (draftContent.value === before) return editFail("add child failed");
      return editOk("child added", opts);
    },
    addUse: async (opts) => {
      if (!file.value) return editFail("no active file");
      const modelId = opts.modelId || activeModelId.value;
      if (!modelId) return editFail("no active model");
      const before = draftContent.value;
      await onAddUse({
        modelId,
        path: `model:${modelId}`,
        href: opts.href,
      });
      if (draftContent.value === before) return editFail("add use failed");
      return editOk("use added", { modelId, href: opts.href ?? "" });
    },
    insertAtPath: async (opts) => {
      if (!file.value) return editFail("no active file");
      if (opts.kind === "gltf" && !opts.href?.trim()) {
        return editFail("gltf insert_at_path requires href");
      }
      const before = draftContent.value;
      await onInsertChildAtPath(opts);
      if (draftContent.value === before) return editFail("insert failed");
      return editOk("inserted", opts);
    },
    deleteAtPath: async (path) => {
      if (!file.value) return editFail("no active file");
      const before = draftContent.value;
      if (path.startsWith("style:")) {
        const name = path.slice("style:".length).replace(/^\./, "");
        await onDeleteStyleCategory({ path, name });
      } else if (path.startsWith("model:") && !path.includes(".")) {
        await onDeleteModel({
          path,
          modelId: path.slice("model:".length),
        });
      } else if (path.startsWith("material:")) {
        const content = removeElementAtPath(draftContent.value, path);
        if (!content || content === before) {
          return editFail(`delete failed: ${path}`);
        }
        draftContent.value = content;
        if (selected.value?.path === path) {
          selected.value = null;
          interactHost.value?.setHighlight(null);
        }
        await store.updateContent(file.value.id, content, true);
        await nextTick();
        treePanel.value?.syncAfterEdit("materials", { select: "self" });
      } else {
        const info = nodeKindAtPath(draftContent.value, path);
        if (info?.kind === "group" && info.id) {
          await onDeleteNode({ path, groupId: info.id });
        } else {
          await onDeleteUse({ path });
        }
      }
      if (draftContent.value === before) {
        return editFail(`delete failed: ${path}`);
      }
      return editOk("deleted", { path });
    },
    setPanel: (panel, visible) => {
      if (panel === "model") setShowModel(visible);
      else if (panel === "source") setShowSource(visible);
      else if (panel === "animTools") setShowAnimTools(visible);
      else setShowNodeParams(visible);
      const snap = getEditSnapshot();
      if (panel === "model" && snap.panels.model !== visible && !visible) {
        return editFail("cannot hide model while source is hidden");
      }
      if (panel === "source" && snap.panels.source !== visible && !visible) {
        return editFail("cannot hide source while model is hidden");
      }
      return editOk("panel updated", snap.panels);
    },
  });
});

// `props.id` is bound from the route (`props: true`); useDocumentAssets
// already clears/refreshes the sidecar map when `activeFileId` changes.
watch(
  () => props.id,
  () => {
    clearGltfCache();
    syncFromStore();
  }
);

watch(selected, () => {
  // Tree / viewport selection: scroll source to the node.
  // Caret→path sets syncingFromSource and reveals itself without scroll.
  if (syncingFromSource) return;
  revealSelectedInSource({ scroll: true });
});

watch(showSource, async (visible) => {
  if (!visible) return;
  await nextTick();
  revealSelectedInSource({ scroll: true });
});

function resetHistory(): void {
  undoStack.value = [];
  redoStack.value = [];
}

function recordHistory(prev: string): void {
  if (!historyReady || applyingHistory) return;
  const last = undoStack.value[undoStack.value.length - 1];
  if (last === prev) return;
  undoStack.value.push(prev);
  if (undoStack.value.length > HISTORY_MAX) undoStack.value.shift();
  redoStack.value = [];
}

watch(draftContent, (next, prev) => {
  if (prev === undefined || next === prev) return;
  recordHistory(prev);
});

async function applyHistoryContent(
  next: string,
  options: { focusSource?: boolean } = {}
): Promise<void> {
  if (!file.value) return;
  const keepPath = selected.value?.path ?? null;
  applyingHistory = true;
  draftContent.value = next;
  await store.updateContent(file.value.id, next, true);
  applyingHistory = false;
  await nextTick();
  // syncAfterEdit() defaults to defs/last-child — that hijacks selection and
  // scrolls the source reveal to the wrong node after undo/redo.
  const restored = treePanel.value?.resyncAfterHistory(keepPath) ?? false;
  if (keepPath && !restored) {
    selected.value = null;
    interactHost.value?.setHighlight(null);
  }
  await nextTick();
  revealSelectedInSource();
  if (options.focusSource && showSource.value) {
    sourcePanel.value?.focus();
  }
}

async function onUndo(options: { focusSource?: boolean } = {}): Promise<void> {
  if (!undoStack.value.length || !file.value) return;
  const prev = undoStack.value.pop()!;
  redoStack.value.push(draftContent.value);
  await applyHistoryContent(prev, options);
}

async function onRedo(options: { focusSource?: boolean } = {}): Promise<void> {
  if (!redoStack.value.length || !file.value) return;
  const next = redoStack.value.pop()!;
  undoStack.value.push(draftContent.value);
  await applyHistoryContent(next, options);
}

async function onFormatMenu(): Promise<void> {
  if (!file.value) return;
  const formatted = await formatDraftContent(draftContent.value);
  if (formatted === draftContent.value) {
    MessagePlugin.info(t("app.formatCodeNoChange"));
    return;
  }
  draftContent.value = formatted;
  await store.updateContent(file.value.id, formatted, true);
  MessagePlugin.success(t("app.formatCodeDone"));
}

function onEditKeydown(e: KeyboardEvent): void {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const target = e.target as HTMLElement | null;
  // Let CodeMirror keep its own undo/redo while the source editor is focused.
  if (target?.closest?.(".cm-editor")) return;
  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    void onUndo();
  } else if (key === "y" || (key === "z" && e.shiftKey)) {
    e.preventDefault();
    void onRedo();
  }
}

function syncFromStore(): void {
  const f = store.getById(props.id);
  if (!f) {
    MessagePlugin.warning(t("app.fileMissing"));
    nav.goBrowse();
    return;
  }
  store.select(f.id);
  historyReady = false;
  applyingHistory = true;
  // Keep LF so source offsets match CodeMirror (which always normalizes CRLF).
  draftContent.value = normalizeXmlNewlines(f.content);
  applyingHistory = false;
  resetHistory();
  selected.value = null;
  result.value = null;
  activeModelId.value = "";
  interactHost.value?.exitDrill({ select: null });
  void nextTick(() => {
    historyReady = true;
  });
}

function goBrowse(): void {
  nav.goBrowse();
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
  MessagePlugin.success(`${t("app.addedGroup")} ${id}`);
}

async function onAddModel(): Promise<void> {
  if (!file.value) return;
  const { content, id } = insertEmptyModel(draftContent.value);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("models");
  MessagePlugin.success(`${t("app.addedModel")} ${id}`);
}

async function onAddMaterial(): Promise<void> {
  if (!file.value) return;
  const { content, id } = insertEmptyMaterial(draftContent.value);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("materials");
  MessagePlugin.success(`${t("app.addedMaterial")} ${id}`);
}

async function onAddRootAnimate(): Promise<void> {
  if (!file.value) return;
  const { content, attributeName } = insertRootAnimate(draftContent.value);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("animations");
  MessagePlugin.success(
    `${t("app.addedRootAnimate")} ${attributeName}`
  );
}

async function onAddStyleCategory(): Promise<void> {
  if (!file.value) return;
  const { content, name } = insertEmptyStyleCategory(draftContent.value);
  const next = await formatDraftContent(content);
  draftContent.value = next;
  await store.updateContent(file.value.id, next, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(`style:.${name}`, { select: "self" });
  MessagePlugin.success(`${t("app.addedStyleCategory")} ${name}`);
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
  MessagePlugin.success(t("app.addedUse"));
}

async function onAddChild(payload: {
  parentPath: string;
  parentGroupId: string;
  kind: AddChildKind;
  /** When set (e.g. AI tools), skip the file picker for gltf. */
  href?: string;
}): Promise<void> {
  if (!file.value) return;
  let snippet: string | undefined;
  if (payload.kind === "gltf") {
    const href = payload.href?.trim() || (await pickAndAttachGltf());
    if (!href) return;
    snippet = gltfSnippet(href);
  }
  const { content, childId, kind } = insertChildIntoGroup(
    draftContent.value,
    payload.parentGroupId,
    payload.kind,
    snippet ? { snippet } : undefined
  );
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(payload.parentPath);
  const name = childId ?? kind;
  MessagePlugin.success(`${t("app.addedChild")} ${name}`);
}

async function onInsertChildAtPath(payload: {
  parentPath: string;
  kind: string;
  href?: string;
}): Promise<void> {
  if (!file.value) return;
  const parentKind = nodeKindAtPath(draftContent.value, payload.parentPath)?.kind;
  let snippet = snippetForPathInsert(payload.kind, parentKind);
  if (payload.kind === "gltf") {
    const href = payload.href?.trim() || (await pickAndAttachGltf());
    if (!href) return;
    snippet = gltfSnippet(href);
  }
  if (!snippet) return;
  const content = insertXmlAtPath(
    draftContent.value,
    payload.parentPath,
    `      ${snippet}`
  );
  if (!content) {
    MessagePlugin.warning(t("app.fileMissing"));
    return;
  }
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(payload.parentPath);
  MessagePlugin.success(`${t("app.addedChild")} ${payload.kind}`);
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
  MessagePlugin.success(`${t("app.deletedNode")} ${payload.modelId}`);
}

async function onDeleteUse(payload: { path: string }): Promise<void> {
  if (!file.value) return;
  const content = removeElementAtPath(draftContent.value, payload.path);
  if (!content || content === draftContent.value) return;
  const selectPath = payload.path.startsWith("material:")
    ? "materials"
    : treeParentPath(payload.path);
  draftContent.value = content;
  if (
    (selected.value?.kind === "geometry" ||
      selected.value?.kind === "material") &&
    selected.value.path === payload.path
  ) {
    selected.value = null;
    interactHost.value?.setHighlight(null);
  }
  await store.updateContent(file.value.id, content, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(selectPath, { select: "self" });
  MessagePlugin.success(t("app.deletedNode"));
}

async function onDeleteStyleCategory(payload: {
  path: string;
  name: string;
}): Promise<void> {
  if (!file.value) return;
  const name = payload.name.trim().replace(/^\./, "");
  if (!name || name === ":root") return;

  let next = removeStyleCategory(draftContent.value, name);
  if (next === draftContent.value) return;
  next = await formatDraftContent(next);
  draftContent.value = next;
  if (selected.value?.kind === "style" && selected.value.path === payload.path) {
    selected.value = null;
    interactHost.value?.setHighlight(null);
  }
  await store.updateContent(file.value.id, next, true);
  await nextTick();
  treePanel.value?.syncAfterEdit("style", { select: "self" });
  MessagePlugin.success(`${t("app.deletedNode")} ${name}`);
}

async function onOptimize(): Promise<void> {
  if (!file.value) return;
  const { content, changed, stats } = optimizeSvg3dxContent(draftContent.value);
  if (!changed) {
    MessagePlugin.info(t("app.optimizeNoChange"));
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
    stats.removedParams +
    stats.removedStyles +
    stats.removedClassAttrs +
    stats.removedFormAttrs;
  const msg = t("app.optimizeDone", { n: String(n) });
  MessagePlugin.success(msg);
}

async function onSave(): Promise<void> {
  if (!file.value) return;
  await store.updateContent(file.value.id, draftContent.value, false);
  await store.persist(file.value.id);
  MessagePlugin.success(t("app.saved"));
}

function onDownload(): void {
  if (!file.value) return;
  downloadText(file.value.name, draftContent.value);
  MessagePlugin.success(t("app.downloaded"));
}

async function onDownloadPackage(): Promise<void> {
  if (!file.value) return;
  try {
    const assets = await listReferencedAssets(draftContent.value);
    const packed = await writeSvg3dxzBytes(
      draftContent.value,
      assets.map((a) => ({ path: a.path, bytes: a.blob }))
    );
    const name = packageDownloadName(file.value.name);
    downloadBlob(name, bytesToBlob(packed, "application/zip"));
    MessagePlugin.success(t("app.downloadedPackage"));
  } catch (e) {
    MessagePlugin.error(e instanceof Error ? e.message : String(e));
  }
}

function onSelect(payload: TreeSelectPayload | null): void {
  selected.value = payload;
  interactHost.value?.setHighlight(payload?.path ?? null);
}

function onAnimTrackSelect(path: string): void {
  treePanel.value?.selectPath(path);
}

function openSectionProfileEditor(path: string): void {
  const xml = readSectionElementXml(draftContent.value, path);
  if (!xml || !isSectionEditable(draftContent.value, path)) {
    MessagePlugin.warning(t("app.shapeEditorLoadFailed"));
    return;
  }
  sectionEditorPath.value = path;
  sectionEditorXml.value = xml;
  sectionEditorOpen.value = true;
}

function onEditSection(payload: { path: string }): void {
  openSectionProfileEditor(payload.path);
}

async function onSectionProfileConfirm(childrenXml: string): Promise<void> {
  if (!file.value || !sectionEditorPath.value) return;
  const next = replaceChildrenAtPath(
    draftContent.value,
    sectionEditorPath.value,
    childrenXml
  );
  if (!next) {
    MessagePlugin.warning(t("app.shapeEditorSaveFailed"));
    return;
  }
  const formatted = await formatDraftContent(next);
  draftContent.value = formatted;
  await store.updateContent(file.value.id, formatted, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(sectionEditorPath.value, { select: "self" });
  MessagePlugin.success(t("app.updatedNode"));
}

function onDrillCrumbs(crumbs: DrillCrumb[]): void {
  drillMarks.value = crumbs
    .filter((c) => c.nodePath)
    .map((c, i) => ({ path: c.nodePath, n: i + 1 }));
}

function onArmPointPick(payload: { path: string; attr: string } | null): void {
  pointPickTarget.value = payload;
  if (payload) {
    MessagePlugin.info(t("app.pickPointArmed"));
  }
}

function onViewportPick(path: string | null): void {
  if (pointPickTarget.value) {
    if (!path) {
      inspectorPanel.value?.clearPointPick();
      pointPickTarget.value = null;
      return;
    }
    const info = nodeKindAtPath(draftContent.value, path);
    if (info?.kind === "point" && info.id) {
      inspectorPanel.value?.applyPointPick(info.id);
      pointPickTarget.value = null;
      return;
    }
    MessagePlugin.warning(t("app.pickPointArmed"));
    return;
  }
  if (!path) {
    // Viewport already cleared the entity pick and kept the drill level.
    selected.value = null;
    treePanel.value?.selectPath(null);
    return;
  }
  treePanel.value?.selectPath(path);
}

/** Live gizmo → inspector only (no document / undo). */
function onViewportTransformPreview(payload: {
  path: string;
  transform: string;
  attrs?: Record<string, string>;
}): void {
  inspectorPanel.value?.applyTransformPreview(
    payload.path,
    payload.transform,
    payload.attrs
  );
}

async function onViewportTransform(payload: {
  path: string;
  transform: string;
  attrs?: Record<string, string>;
}): Promise<void> {
  // Keep inspector in sync if the last preview frame was cancelled on mouseUp.
  inspectorPanel.value?.applyTransformPreview(
    payload.path,
    payload.transform,
    payload.attrs
  );
  await onNodeAttrsChange({
    path: payload.path,
    updates: {
      "s3dx:transform": payload.transform,
      ...(payload.attrs ?? {}),
    },
  });
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
  await nextTick();
  revealSelectedInSource();
}

async function onStyleCategoryRename(payload: {
  from: string;
  to: string;
}): Promise<void> {
  const sel = selected.value;
  if (!sel || sel.kind !== "style" || !file.value) return;
  if (sel.scope === "root") return;

  const from = payload.from.trim();
  const to = payload.to.trim();
  if (!from || !to || from === to) return;

  let next = renameStyleCategory(draftContent.value, from, to);
  if (next === draftContent.value) {
    MessagePlugin.warning(t("app.styleCategoryDuplicate"));
    return;
  }
  next = await formatDraftContent(next);
  const newPath = `style:.${to}`;
  draftContent.value = next;
  selected.value = {
    ...sel,
    path: newPath,
    name: to,
    groupId: sel.groupId,
  };
  await store.updateContent(file.value.id, next, true);
  await nextTick();
  treePanel.value?.syncAfterEdit(newPath, { select: "self" });
  revealSelectedInSource();
}

async function onPickGltfHref(payload: { path: string }): Promise<void> {
  const href = await pickAndAttachGltf();
  if (!href) return;
  await onNodeAttrsChange({ path: payload.path, updates: { href } });
  MessagePlugin.success(t("app.gltfAttached", { name: href }));
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

  if (sel?.kind === "model" && payload.path.startsWith("model:")) {
    const oldId = payload.path.slice("model:".length).split(".")[0]!;
    const newId = (payload.updates.id ?? oldId).trim() || oldId;
    next = await formatDraftContent(next);
    const newPath = `model:${newId}`;
    selected.value = {
      kind: "model",
      path: newPath,
      modelId: newId,
    };
    if (activeModelId.value === oldId) {
      activeModelId.value = newId;
    }
    draftContent.value = next;
    await store.updateContent(file.value.id, next, true);
    if (newPath !== payload.path) {
      treePanel.value?.syncAfterEdit("models");
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
  await nextTick();
  revealSelectedInSource();
}

function persistWidths(): void {
  try {
    localStorage.setItem(TREE_W_KEY, String(treeWidth.value));
    localStorage.setItem(INSPECTOR_W_KEY, String(inspectorWidth.value));
    localStorage.setItem(INSPECTOR_H_KEY, String(inspectorHeight.value));
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
      const nextH = sourceFirst.value
        ? ev.clientY - midRect.top
        : midRect.bottom - ev.clientY;
      sourceHeight.value = Math.min(
        maxH,
        Math.max(SOURCE_H_MIN, nextH)
      );
    } else {
      const midRect = mid?.getBoundingClientRect();
      const midLeft = midRect?.left ?? rect.left + treeWidth.value;
      const midRight = midRect?.right ?? rect.right;
      const nextW = sourceFirst.value
        ? ev.clientX - midLeft
        : midRight - ev.clientX;
      sourceWidth.value = Math.min(
        SOURCE_W_MAX,
        Math.max(SOURCE_W_MIN, nextW)
      );
    }
  } else if (side === "inspector-row") {
    const rail = leftRailEl.value;
    if (!rail) return;
    const railRect = rail.getBoundingClientRect();
    const maxH = Math.max(INSPECTOR_H_MIN, railRect.height - TREE_H_MIN);
    const nextH = inspectorAboveTree.value
      ? ev.clientY - railRect.top
      : railRect.bottom - ev.clientY;
    inspectorHeight.value = Math.min(
      maxH,
      Math.max(INSPECTOR_H_MIN, nextH)
    );
  } else if (side === "ai") {
    const body = editBodyEl.value?.getBoundingClientRect();
    if (!body) return;
    chatStore.setWidth(body.right - ev.clientX);
  } else {
    inspectorWidth.value = Math.min(
      INSPECTOR_W_MAX,
      Math.max(INSPECTOR_W_MIN, rect.right - ev.clientX)
    );
  }
}

function startResize(
  side: "tree" | "inspector" | "inspector-row" | "source" | "ai",
  ev: PointerEvent
): void {
  ev.preventDefault();
  resizing.value = side;
  const row =
    side === "inspector-row" || (side === "source" && midStacked.value);
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
  registerStudioEditBridge(null);
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
  window.removeEventListener("keydown", onEditKeydown);
  stopResize();
  chatStore.setMountEl(null);
  clearGltfCache();
});
</script>

<template>
  <div class="edit-page">
    <header class="topbar">
      <slot name="topbar-start">
        <div class="brand">
          <img class="logo" src="/logo.png" alt="svg3dx studio" width="22" height="22" />
          <span class="product">svg3dx Studio</span>
        </div>
      </slot>
      <AppMenus
        v-if="pageReady && file"
        :show-model="showModel"
        :show-source="showSource"
        :show-anim-tools="showAnimTools"
        :show-node-params="showNodeParams"
        :can-undo="canUndo"
        :can-redo="canRedo"
        @save="onSave"
        @export="onDownload"
        @export-package="onDownloadPackage"
        @back="goBrowse"
        @undo="() => onUndo({ focusSource: true })"
        @redo="() => onRedo({ focusSource: true })"
        @format="onFormatMenu"
        @optimize="onOptimize"
        @toggle-model="setShowModel(!showModel)"
        @toggle-source="setShowSource(!showSource)"
        @toggle-anim-tools="setShowAnimTools(!showAnimTools)"
        @toggle-node-params="setShowNodeParams(!showNodeParams)"
      />
      <slot name="toolbar-extra" />
      <div class="right">
        <slot name="topbar-end">
          <AiChatHeaderButton v-if="showAiAssistant" />
          <ReposMenu v-if="showReposMenu" />
          <SettingsMenu v-if="showSettingsMenu" />
        </slot>
      </div>
    </header>

    <div
      ref="editBodyEl"
      class="edit-body"
      :class="{ resizing: resizing === 'ai' }"
      :style="editBodyStyle"
    >
      <div class="edit-main">
        <EditPageSkeleton v-if="!pageReady" :show-topbar="false" />

        <template v-else-if="file">
          <div
            ref="workspaceEl"
            class="workspace"
            :class="{ resizing: !!resizing && resizing !== 'ai' }"
            :style="workspaceStyle"
          >
      <div
        ref="leftRailEl"
        class="left-rail"
        :class="{ 'left-rail--with-inspector': inspectorOnLeft }"
        :style="leftRailStyle"
      >
        <div class="left-rail-tree">
          <slot name="tree">
            <NodeTreePanel
              ref="treePanel"
              class="tree"
              :result="result"
              :content="draftContent"
              :loading="contentLoading"
              :file-name="file.name"
              :dirty="dirty"
              :drill-marks="drillMarks"
              :asset-paths="documentAssetPaths"
              :is-package="isPackageDocument"
              @select="onSelect"
              @add-group="onAddGroup"
              @add-model="onAddModel"
              @add-material="onAddMaterial"
              @add-root-animate="onAddRootAnimate"
              @add-style-category="onAddStyleCategory"
              @add-use="onAddUse"
              @add-child="onAddChild"
              @insert-child-at-path="onInsertChildAtPath"
              @edit-section="onEditSection"
              @delete-node="onDeleteNode"
              @delete-model="onDeleteModel"
              @delete-use="onDeleteUse"
              @delete-element="onDeleteUse"
              @delete-style-category="onDeleteStyleCategory"
              @optimize="onOptimize"
            />
          </slot>
        </div>
        <template v-if="inspectorOnLeft">
          <div
            class="resize-handle resize-handle--inspector-row"
            role="separator"
            aria-orientation="horizontal"
            :aria-valuenow="inspectorHeight"
            :title="t('app.resizePanel')"
            @pointerdown="(e) => startResize('inspector-row', e)"
          />
          <div ref="inspectorMountLeft" class="inspector-mount" />
        </template>
      </div>
      <div
        class="resize-handle resize-handle--tree"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="treeWidth"
        :title="t('app.resizePanel')"
        @pointerdown="(e) => startResize('tree', e)"
      />

      <div class="mid">
        <div
          ref="midEl"
          class="mid-panes"
          :class="{
            'mid-panes--both': midBoth,
            'mid-panes--stacked': midBoth && midStacked,
            'mid-panes--source-after': midBoth && !sourceFirst,
            'mid-panes--source-only': showSource && !showModel,
            'mid-panes--model-only': showModel && !showSource,
          }"
          :style="midStyle"
        >
          <slot name="source">
            <SourceEditorPanel
              v-if="showSource"
              ref="sourcePanel"
              class="source"
              :heading="t('app.sourceCode')"
              :model-value="draftContent"
              :format-mode="sourceFormatMode"
              :dock="sourceDock"
              :loading="contentLoading"
              @update:model-value="onSourceContent"
              @update:format-mode="onSourceFormatModeChange"
              @update:dock="setSourceDock"
              @cursor-path="onSourceCursorPath"
              @hide="setShowSource(false)"
            />
          </slot>
          <div
            v-if="midBoth"
            class="resize-handle resize-handle--mid"
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
            <slot name="viewport-chrome">
              <ViewportSkeleton v-if="contentLoading" />
              <InteractHost
                ref="interactHost"
                :key="file.id"
                :content="draftContent"
                :model="activeModelId || undefined"
                :document-base-url="file.documentBaseUrl"
                :document-asset-urls="documentAssetUrls"
                @result="onResult"
                @error="(m) => MessagePlugin.error(m)"
                @pick="onViewportPick"
                @transform-preview="onViewportTransformPreview"
                @transform="onViewportTransform"
                @drill="onDrillCrumbs"
              />
            </slot>
          </main>
        </div>
        <AnimationTimelineBar
          v-if="showAnimTools"
          class="anim-dock"
          :get-viewer="getAnimViewer"
          :content="draftContent"
          :selected-path="selected?.path ?? null"
          @hide="setShowAnimTools(false)"
          @select-path="onAnimTrackSelect"
          @node-attrs-change="onNodeAttrsChange"
        />
      </div>

      <template v-if="inspectorOnRight">
        <div
          class="resize-handle resize-handle--inspector"
          role="separator"
          aria-orientation="vertical"
          :aria-valuenow="inspectorWidth"
          :title="t('app.resizePanel')"
          @pointerdown="(e) => startResize('inspector', e)"
        />
        <div ref="inspectorMountRight" class="inspector-mount inspector-mount--right" />
      </template>
        </div>

        <Teleport v-if="inspectorMountEl" :to="inspectorMountEl">
          <aside
            class="inspector"
            :class="{
              'inspector--left': inspectorOnLeft,
              'inspector--left-top': inspectorOnLeft && inspectorAboveTree,
            }"
          >
            <slot name="inspector">
              <div class="panel-head">
                <span class="panel-head-title">
                  {{
                    selected?.kind === "style"
                      ? t("app.styleParams")
                      : t("app.nodeParams")
                  }}
                </span>
                <t-dropdown
                  :options="nodeParamsMoreOptions"
                  :max-column-width="200"
                  :min-column-width="140"
                  trigger="click"
                  placement="bottom-right"
                  @click="onNodeParamsMoreClick"
                >
                  <t-button
                    class="panel-more"
                    theme="default"
                    shape="square"
                    variant="text"
                    size="small"
                    :title="t('app.moreActions')"
                    :aria-label="t('app.moreActions')"
                  >
                    <template #icon><MoreIcon /></template>
                  </t-button>
                </t-dropdown>
              </div>
              <PanelSkeleton v-if="contentLoading && !selected" :rows="5" />
              <NodeInspectorPanel
                v-else
                ref="inspectorPanel"
                :selected="selected"
                :content="draftContent"
                @style-params-change="onStyleParamsChange"
                @style-category-rename="onStyleCategoryRename"
                @node-attrs-change="onNodeAttrsChange"
                @edit-section="onEditSection"
                @pick-gltf-href="onPickGltfHref"
                @arm-point-pick="onArmPointPick"
              />
            </slot>
          </aside>
        </Teleport>

          <SectionProfileEditorDialog
            v-model:visible="sectionEditorOpen"
            :section-xml="sectionEditorXml"
            @confirm="onSectionProfileConfirm"
          />
        </template>
      </div>

      <template v-if="aiDockOpen">
        <div
          class="resize-handle resize-handle--ai"
          role="separator"
          aria-orientation="vertical"
          :aria-valuenow="chatStore.width"
          :title="t('app.resizePanel')"
          @pointerdown="(e) => startResize('ai', e)"
        />
        <div ref="aiMountEl" class="ai-mount" />
      </template>
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

.edit-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.edit-body.resizing {
  cursor: col-resize;
}

.edit-main {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.topbar {
  position: relative;
  height: var(--svg3dx-studio-topbar-height, 40px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.logo {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.product {
  font-weight: 600;
  font-size: 13px;
}

.right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
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
.workspace.resizing:has(.resize-handle--inspector-row:hover),
.workspace.resizing.row-resize {
  cursor: row-resize;
}

.left-rail {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.left-rail--with-inspector > .left-rail-tree {
  grid-area: tree;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.left-rail--with-inspector > .resize-handle--inspector-row {
  grid-area: handle;
}

.left-rail--with-inspector > .inspector-mount {
  grid-area: inspector;
}

.left-rail-tree {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  height: 100%;
}

.left-rail-tree > .tree {
  height: 100%;
}

.mid {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.mid-panes {
  flex: 1;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.mid-panes--source-only,
.mid-panes--model-only {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.mid-panes--both > .source {
  grid-area: source;
}

.mid-panes--both > .resize-handle--mid {
  grid-area: handle;
}

.mid-panes--both > .viewport {
  grid-area: viewport;
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

.mid-panes--stacked > .source {
  border-left: none;
  border-right: none;
}

.mid-panes--stacked:not(.mid-panes--source-after) > .source {
  border-bottom: 1px solid var(--td-component-border);
}

.mid-panes--stacked.mid-panes--source-after > .source {
  border-top: 1px solid var(--td-component-border);
}

.viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--td-bg-color-page);
}

/** Editor-shell animation dock (not viewer chrome). */
.anim-dock {
  flex-shrink: 0;
  z-index: 4;
}
.anim-dock :deep(.anim-editor) {
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-bottom: none;
  border-top: 1px solid var(--td-component-border);
  box-shadow: none;
}

.resize-handle {
  position: relative;
  width: 0;
  margin: 0 -3px;
  z-index: 2;
  cursor: col-resize;
  touch-action: none;
}

.resize-handle--source-row,
.resize-handle--inspector-row {
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

.resize-handle--source-row::after,
.resize-handle--inspector-row::after {
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

.inspector-mount {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.inspector-mount--right {
  height: 100%;
}

.ai-mount {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.edit-body.resizing .resize-handle--ai::after {
  background: var(--td-brand-color-light);
}

.inspector {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--td-bg-color-container);
  border-left: 1px solid var(--td-component-border);
  overflow: hidden;
}

.inspector--left {
  border-left: none;
  border-top: 1px solid var(--td-component-border);
}

.inspector--left-top {
  border-top: none;
  border-bottom: 1px solid var(--td-component-border);
}

.inspector :deep(.node-inspector),
.inspector > :not(.panel-head) {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
}

.panel-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--td-component-border);
}

.panel-head-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--td-text-color-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-more {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

/* Keep inspector visible; narrow mid panes stack via midStacked instead.
 * Old max-width:960 rule hid the inspector and left users thinking it was
 * “pushed off screen”. */
@media (max-width: 720px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr) !important;
  }
  .left-rail,
  .resize-handle--tree,
  .resize-handle--inspector,
  .inspector-mount {
    display: none;
  }
}
</style>
