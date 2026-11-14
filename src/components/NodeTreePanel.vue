<script setup lang="ts">
import { nextTick, ref, watch, type Component } from "vue";
import {
  AddAndSubtractIcon,
  AddIcon,
  AddRectangleIcon,
  BrushIcon,
  Chart3DIcon,
  Chart3DFilledIcon,
  ChartBubbleIcon,
  CircleIcon,
  FolderIcon,
  FrameIcon,
  GitBranchIcon,
  LayersIcon,
  Link1Icon,
  PaletteIcon,
  RootListIcon,
  ViewListIcon,
  WidgetIcon,
} from "tdesign-icons-vue-next";
import {
  type EvaluationResult,
  type GeometryInstruction,
  type Value,
} from "svg3dx-viewer";
import {
  extractClassRules,
  extractClassedGroups,
  extractDefsGroups,
  propsForClasses,
} from "@/utils/styleClasses";
import { locale, useI18n } from "@/i18n";

const IDENTITY_M = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export type TreeSelectPayload =
  | { kind: "geometry"; path: string; node: GeometryInstruction }
  | { kind: "model"; path: string; modelId: string }
  | {
      kind: "style";
      path: string;
      /** CSS class name(s) on the group, space-joined. */
      name: string;
      groupId: string;
      props: Record<string, string>;
      resolved: Record<string, Value>;
    };

const props = defineProps<{
  result: EvaluationResult | null;
  /** Raw SVG text — used to list style classes applied on groups. */
  content?: string;
}>();

const emit = defineEmits<{
  select: [payload: TreeSelectPayload];
  addGroup: [];
}>();

const { t, tagLabel } = useI18n();

type TreeKind = "section" | "model" | "geometry" | "style";

type TreeItem = {
  value: string;
  label: string;
  children?: TreeItem[];
  meta: {
    kind: TreeKind;
    icon: Component;
    node?: GeometryInstruction | null;
    modelId?: string;
    modelMode?: string;
    className?: string;
    styleName?: string;
    styleGroupId?: string;
    styleProps?: Record<string, string>;
    styleResolved?: Record<string, Value>;
    /** Section action: show add button on defs. */
    action?: "add-group";
  };
};

type TreeExpose = {
  appendTo: (value: string | number, newData: TreeItem | TreeItem[]) => void;
  getItem?: (value: string | number) => { data?: TreeItem } | undefined;
};

const treeRef = ref<TreeExpose | null>(null);
const treeData = ref<TreeItem[]>([]);
const actived = ref<string[]>([]);
const expanded = ref<string[]>(["models", "defs", "style"]);

/** Skip one content-driven rebuild after incremental append. */
let skipContentSync = false;

const KNOWN_MODES = new Set(["solid", "wireframe", "lite-solid", "hidden-line"]);

function childrenOf(inst: GeometryInstruction): GeometryInstruction[] {
  if (inst.type === "group") return inst.children;
  if (inst.type === "bool_op") return inst.operands;
  return [];
}

function modelModeIcon(mode: string): Component {
  switch (mode) {
    case "solid":
      return Chart3DIcon;
    case "wireframe":
    case "hidden-line":
      return FrameIcon;
    case "lite-solid":
      return Chart3DFilledIcon;
    default:
      return WidgetIcon;
  }
}

function geometryIcon(inst: GeometryInstruction): Component {
  if (inst.type === "group") return FolderIcon;
  if (inst.type === "bool_op") {
    return inst.op === "subtract" ? AddAndSubtractIcon : GitBranchIcon;
  }
  if (inst.type === "instance") return Link1Icon;
  switch (inst.kind) {
    case "box":
    case "wedge":
    case "prism":
    case "pyramid":
      return AddRectangleIcon;
    case "sphere":
      return ChartBubbleIcon;
    case "cylinder":
    case "cone":
    case "torus":
    case "cutcylinder":
    case "pipe":
      return CircleIcon;
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
      return Chart3DIcon;
    case "mesh":
    case "triangles":
      return LayersIcon;
    default:
      return WidgetIcon;
  }
}

function shortId(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

function labelOf(inst: GeometryInstruction): string {
  switch (inst.type) {
    case "primitive":
      return inst.kind;
    case "group":
      return inst.id ?? tagLabel("group");
    case "bool_op":
      return `bool-${inst.op}`;
    case "instance":
      return tagLabel("use");
    default:
      return "?";
  }
}

function findGroupById(
  roots: GeometryInstruction[],
  id: string
): GeometryInstruction | null {
  for (const inst of roots) {
    if (inst.type === "group" && (inst.id === id || inst.node_id === id)) {
      return inst;
    }
    const hit = findGroupById(childrenOf(inst), id);
    if (hit) return hit;
  }
  return null;
}

function mapGeometry(
  inst: GeometryInstruction,
  path: string,
  classById: Map<string, string>
): TreeItem {
  const className =
    inst.type === "group" && inst.id ? classById.get(inst.id) : undefined;
  return {
    value: path,
    label: labelOf(inst),
    meta: {
      kind: "geometry",
      icon: geometryIcon(inst),
      node: inst,
      className,
    },
    children: childrenOf(inst).map((c, i) =>
      mapGeometry(c, `${path}.${i}`, classById)
    ),
  };
}

function syntheticGroup(id: string): GeometryInstruction {
  return {
    type: "group",
    node_id: id,
    id,
    styles: {},
    children: [],
    transform: { m: [...IDENTITY_M] },
  };
}

function makeDefsGroupItem(
  id: string,
  className: string | undefined,
  evaluated: GeometryInstruction | undefined,
  classById: Map<string, string>
): TreeItem {
  if (evaluated) {
    const item = mapGeometry(evaluated, `defs:${id}`, classById);
    if (className) item.meta.className = className;
    return item;
  }
  return {
    value: `defs:${id}`,
    label: id,
    meta: {
      kind: "geometry",
      icon: FolderIcon,
      node: syntheticGroup(id),
      className,
    },
  };
}

function buildDefsChildren(
  result: EvaluationResult,
  content: string,
  classById: Map<string, string>
): TreeItem[] {
  const defsGroups = extractDefsGroups(content);
  const evalById = new Map<string, GeometryInstruction>();
  for (const inst of result.instructions) {
    if (inst.type === "group" && inst.id) evalById.set(inst.id, inst);
    else if (inst.type === "group" && inst.node_id) {
      evalById.set(inst.node_id, inst);
    }
  }

  const children: TreeItem[] = [];
  const seen = new Set<string>();

  for (const g of defsGroups) {
    seen.add(g.id);
    const className = g.classes.join(" ") || classById.get(g.id) || undefined;
    children.push(
      makeDefsGroupItem(g.id, className, evalById.get(g.id), classById)
    );
  }

  result.instructions.forEach((inst, i) => {
    const key =
      inst.type === "group" ? inst.id ?? inst.node_id : inst.node_id;
    if (key && seen.has(key)) return;
    children.push(mapGeometry(inst, `i${i}`, classById));
  });

  return children;
}

function buildTree(
  result: EvaluationResult,
  content: string
): TreeItem[] {
  const classedGroups = extractClassedGroups(content);
  const classById = new Map(
    classedGroups.map((g) => [g.id, g.classes.join(" ")] as const)
  );
  const classRules = extractClassRules(content);

  return [
    {
      value: "models",
      label: tagLabel("model"),
      meta: { kind: "section", icon: ViewListIcon },
      children: result.models.map((m) => ({
        value: `model:${m.id}`,
        label: m.id,
        meta: {
          kind: "model",
          icon: modelModeIcon(m.mode),
          modelId: m.id,
          modelMode: m.mode,
        },
      })),
    },
    {
      value: "defs",
      label: tagLabel("defs"),
      meta: { kind: "section", icon: LayersIcon, action: "add-group" },
      children: buildDefsChildren(result, content, classById),
    },
    {
      value: "style",
      label: tagLabel("style"),
      meta: { kind: "section", icon: PaletteIcon },
      children: classedGroups.map((g) => {
        const primary = g.classes[0] ?? "";
        const className = g.classes.join(" ");
        const groupNode = findGroupById(result.instructions, g.id);
        return {
          value: `style:${g.id}`,
          label: className,
          meta: {
            kind: "style",
            icon: BrushIcon,
            styleName: className,
            styleGroupId: g.id,
            className,
            styleProps: classRules[primary]
              ? { ...classRules[primary] }
              : propsForClasses(classRules, g.classes),
            styleResolved: groupNode?.styles ?? {},
          },
        };
      }),
    },
  ];
}

function defsChildIds(items: TreeItem[]): string[] {
  const defs = items.find((n) => n.value === "defs");
  return (defs?.children ?? [])
    .map((c) => c.value.replace(/^defs:/, ""))
    .filter(Boolean);
}

function rebuildTree(): void {
  if (!props.result) {
    treeData.value = [];
    return;
  }
  treeData.value = buildTree(props.result, props.content ?? "");
}

/**
 * Incrementally append a defs group via TDesign `appendTo` — avoids replacing
 * the whole tree data (which remounts every node under defs).
 */
function appendDefsGroup(id: string): void {
  if (!id) return;
  const value = `defs:${id}`;
  if (findItem(treeData.value, value)) return;

  const item = makeDefsGroupItem(id, undefined, undefined, new Map());

  const defs = treeData.value.find((n) => n.value === "defs");
  if (defs) {
    if (!defs.children) defs.children = [];
    defs.children.push(item);
  }

  skipContentSync = true;
  if (!expanded.value.includes("defs")) {
    expanded.value = [...expanded.value, "defs"];
  }

  void nextTick(() => {
    try {
      treeRef.value?.appendTo("defs", item);
    } catch {
      // If appendTo fails (tree not ready), fall back to a full rebuild once.
      rebuildTree();
    }
    actived.value = [value];
    emit("select", {
      kind: "geometry",
      path: value,
      node: item.meta.node as GeometryInstruction,
    });
  });
}

function resultStructureKey(r: EvaluationResult): string {
  const walk = (inst: GeometryInstruction): string => {
    const kids = childrenOf(inst).map(walk).join(",");
    return `${inst.node_id}(${kids})`;
  };
  return [
    r.models.map((m) => `${m.id}:${m.mode}:${m.active}`).join("|"),
    r.instructions.map(walk).join("|"),
  ].join("||");
}

watch(
  () => props.result,
  (r, prev) => {
    if (!r) {
      treeData.value = [];
      return;
    }
    if (r && !prev) {
      rebuildTree();
      expanded.value = ["models", "defs", "style"];
      return;
    }
    // Same evaluated structure (e.g. empty defs group add) — keep tree nodes.
    if (prev && resultStructureKey(prev) === resultStructureKey(r) && treeData.value.length) {
      return;
    }
    rebuildTree();
  }
);

watch(
  () => props.content,
  (content, prev) => {
    if (skipContentSync) {
      skipContentSync = false;
      return;
    }
    if (!props.result || !content) return;
    if (content === prev) return;

    // Only rebuild when defs group set actually changes in a non-append way.
    // Pure append of one trailing group is handled by appendDefsGroup.
    const nextIds = extractDefsGroups(content).map((g) => g.id);
    const curIds = defsChildIds(treeData.value);
    const isSingleAppend =
      nextIds.length === curIds.length + 1 &&
      curIds.every((id, i) => id === nextIds[i]);
    if (isSingleAppend) {
      const newId = nextIds[nextIds.length - 1];
      if (newId && !findItem(treeData.value, `defs:${newId}`)) {
        appendDefsGroup(newId);
      }
      return;
    }
    if (nextIds.join("\0") === curIds.join("\0")) {
      // Same defs set (e.g. style param edit) — keep tree nodes stable.
      return;
    }
    rebuildTree();
  }
);

watch(locale, () => {
  if (props.result) rebuildTree();
});

function findItem(items: TreeItem[], value: string): TreeItem | null {
  for (const it of items) {
    if (it.value === value) return it;
    if (it.children) {
      const hit = findItem(it.children, value);
      if (hit) return hit;
    }
  }
  return null;
}

function onActive(values: Array<string | number>): void {
  const path = String(values[0] ?? "");
  actived.value = path ? [path] : [];
  if (!path || path === "models" || path === "defs" || path === "style") {
    return;
  }
  const item = findItem(treeData.value, path);
  if (!item) return;
  const { meta } = item;
  if (meta.kind === "geometry" && meta.node) {
    emit("select", { kind: "geometry", path, node: meta.node });
  } else if (meta.kind === "model" && meta.modelId) {
    emit("select", { kind: "model", path, modelId: meta.modelId });
  } else if (meta.kind === "style" && meta.styleName !== undefined) {
    emit("select", {
      kind: "style",
      path,
      name: meta.styleName,
      groupId: meta.styleGroupId ?? "",
      props: meta.styleProps ?? {},
      resolved: meta.styleResolved ?? {},
    });
  }
}

function labelHint(item: TreeItem | undefined): string {
  const meta = item?.meta;
  if (!meta) return "";
  if (meta.kind === "style") return meta.styleGroupId ?? "";
  if (meta.className) return meta.className;
  if (meta.kind === "model" && meta.modelMode) {
    return KNOWN_MODES.has(meta.modelMode)
      ? t(`mode.${meta.modelMode}`, meta.modelMode)
      : meta.modelMode;
  }
  if (meta.kind === "geometry" && meta.node) {
    const n = meta.node;
    if (n.type === "instance") return `#${n.group_id}`;
    if (n.type === "group" && n.id) return "";
    return shortId(n.node_id);
  }
  return "";
}

function onAddGroup(ev: Event): void {
  ev.preventDefault();
  ev.stopPropagation();
  emit("addGroup");
}

function onExpand(values: Array<string | number | bigint>): void {
  expanded.value = values.map(String);
}

function onActiveSafe(
  values: Array<string | number | bigint>,
  _ctx?: unknown
): void {
  onActive(values.map(String));
}

defineExpose({ appendDefsGroup });
</script>

<template>
  <aside class="node-tree-panel">
    <div class="panel-head">{{ t("app.nodes") }}</div>
    <div v-if="!result" class="empty">{{ t("app.notLoaded") }}</div>
    <t-tree
      v-else
      ref="treeRef"
      :data="treeData"
      hover
      activable
      transition
      :label="true"
      :actived="actived"
      :expanded="expanded"
      :keys="{ value: 'value', label: 'label', children: 'children' }"
      @active="onActiveSafe"
      @expand="onExpand"
    >
      <template #label="{ node }">
        <span class="tree-label">
          <component
            :is="(node.data as TreeItem | undefined)?.meta?.icon ?? RootListIcon"
            class="tree-type-icon"
            size="16px"
          />
          <span class="tree-label-text">{{ node.label }}</span>
          <span
            v-if="labelHint(node.data as TreeItem | undefined)"
            class="tree-label-hint"
          >{{ labelHint(node.data as TreeItem | undefined) }}</span>
          <button
            v-if="(node.data as TreeItem | undefined)?.meta?.action === 'add-group'"
            type="button"
            class="tree-action"
            :title="t('app.addGroup')"
            :aria-label="t('app.addGroup')"
            @click="onAddGroup"
            @mousedown.stop
          >
            <AddIcon size="14px" />
          </button>
        </span>
      </template>
    </t-tree>
  </aside>
</template>

<style scoped>
.node-tree-panel {
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 10px 8px 16px;
  background: var(--studio-panel);
  border-right: 1px solid var(--studio-line);
}

.panel-head {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px 10px;
}

.empty {
  color: var(--studio-muted);
  font-size: 13px;
  padding: 8px;
}

:deep(.tree-type-icon) {
  color: var(--studio-muted);
  flex-shrink: 0;
}

:deep(.tree-label) {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding-right: 2px;
}

:deep(.tree-label-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  min-width: 0;
}

:deep(.tree-label-hint) {
  flex-shrink: 0;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--studio-muted);
  opacity: 0.85;
}

:deep(.tree-action) {
  flex-shrink: 0;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--studio-muted);
  cursor: pointer;
}

:deep(.tree-action:hover) {
  background: rgba(0, 0, 0, 0.06);
  color: var(--studio-text, #333);
}

:deep(.t-tree__item) {
  position: relative;
}

:deep(.t-tree__label) {
  display: flex !important;
  align-items: center;
  overflow: visible;
  width: 100%;
  flex: 1;
  min-width: 0;
}
</style>
