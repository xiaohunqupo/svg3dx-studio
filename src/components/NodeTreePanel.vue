<script setup lang="ts">
import { computed, h, nextTick, ref, watch, type Component } from "vue";
import {
  AddAndSubtractIcon,
  AddIcon,
  AddRectangleIcon,
  BrushIcon,
  Chart3DIcon,
  Chart3DFilledIcon,
  ChartBubbleIcon,
  CircleIcon,
  DeleteIcon,
  FilterClearIcon,
  FolderIcon,
  FrameIcon,
  GitBranchIcon,
  LayersIcon,
  JumpIcon,
  Link1Icon,
  MoreIcon,
  PaletteIcon,
  RootListIcon,
  ViewListIcon,
  WidgetIcon,
} from "tdesign-icons-vue-next";
import { DialogPlugin, MessagePlugin, type DropdownOption } from "tdesign-vue-next";
import {
  type EvaluationResult,
  type GeometryInstruction,
  type Value,
} from "svg3dx-viewer";
import {
  extractClassRules,
  extractClassedGroups,
  extractDefsGroups,
  extractRootProps,
  firstGroupIdForClass,
  listStyleCategories,
} from "@/utils/styleClasses";
import PanelSkeleton from "@/components/skeletons/PanelSkeleton.vue";
import { locale, useI18n } from "@/i18n";
import type { AddChildKind, GeometryKind } from "@/types/file";
import { extractDocumentMaterials } from "@/utils/documentMaterials";
import {
  ADD_CHILD_MENU,
  BOOL_MENU,
  CURVE_MENU,
  LOGIC_MENU,
  LOOP_MENU,
  MODELING_MENU,
  PRIMITIVE_MENU,
  SOLID_MENU,
  type AddChildMenuItem,
} from "@/utils/svgEdit";

const IDENTITY_M = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export type TreeSelectPayload =
  | {
      kind: "geometry";
      path: string;
      node: GeometryInstruction;
      /** Class attribute from the element / ancestor group when known. */
      className?: string;
    }
  | { kind: "model"; path: string; modelId: string }
  | {
      kind: "material";
      path: string;
      materialId: string;
      color?: string;
      metalness?: string;
      roughness?: string;
    }
  | {
      kind: "style";
      path: string;
      /** CSS class name(s) on the group, space-joined — or `:root`. */
      name: string;
      groupId: string;
      props: Record<string, string>;
      resolved: Record<string, Value>;
      /** Global `:root` rule vs class rule attached to a group. */
      scope?: "root" | "class";
    };

const props = defineProps<{
  result: EvaluationResult | null;
  /** Raw SVG text — used to list style classes applied on groups. */
  content?: string;
  /** Show panel skeleton while document is evaluating. */
  loading?: boolean;
  /** Current document file name shown in the panel head. */
  fileName?: string;
  /** Whether the document has unsaved changes. */
  dirty?: boolean;
}>();

const emit = defineEmits<{
  select: [payload: TreeSelectPayload];
  addGroup: [];
  addModel: [];
  addMaterial: [];
  addStyleCategory: [];
  addUse: [payload: { modelId?: string; path: string; href?: string }];
  addChild: [payload: { parentPath: string; parentGroupId: string; kind: AddChildKind }];
  deleteNode: [payload: { path: string; groupId: string }];
  deleteModel: [payload: { path: string; modelId: string }];
  deleteUse: [payload: { path: string }];
  /** Delete any geometry element by tree path (primitive / bool / nested, etc.). */
  deleteElement: [payload: { path: string }];
  deleteStyleCategory: [payload: { path: string; name: string }];
  optimize: [];
}>();

const { t, tagLabel, elementLabel } = useI18n();

type TreeKind = "section" | "model" | "geometry" | "style" | "material";

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
    styleScope?: "root" | "class";
    materialId?: string;
    materialColor?: string;
    materialMetalness?: string;
    materialRoughness?: string;
    /** Tree trailing action button(s). */
    action?:
      | "add-group"
      | "add-child"
      | "add-model"
      | "add-material"
      | "add-style"
      | "model-more"
      | "use-more"
      /** Geometry leaf / non-group: more menu with delete. */
      | "geom-more"
      /** Material row: more menu with delete. */
      | "material-more"
      /** Style category row: more menu with delete. */
      | "style-more";
    /** Own `id` on `<s3dx:use>` when present. */
    useId?: string;
    /** Bare href target group id (no `#`); empty when unset. */
    hrefGroupId?: string;
    /** Label is only the href target (no own id) — render muted. */
    useTargetLabel?: boolean;
  };
};

const treeData = ref<TreeItem[]>([]);
const actived = ref<string[]>([]);
const expanded = ref<string[]>(["models", "defs", "materials", "style"]);

const PRIMITIVE_KIND_SET = new Set<string>(PRIMITIVE_MENU.map((p) => p.kind));

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

/** Inner XML of `<g id="…">…</g>` (first match), or null. */
function groupInnerXml(svg: string, groupId: string): string | null {
  const openRe = /<g\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    const attrs = m[1] ?? "";
    if (attrOf(attrs, "id") !== groupId) continue;
    const full = m[0];
    if (/\/\s*>$/.test(full)) return "";
    const start = m.index + full.length;
    let depth = 1;
    const tokenRe = /<\/?g\b[^>]*\/?>/gi;
    tokenRe.lastIndex = start;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(svg))) {
      const tok = tm[0];
      if (/^<\//.test(tok)) {
        depth -= 1;
        if (depth === 0) return svg.slice(start, tm.index);
      } else if (!/\/\s*>$/.test(tok)) {
        depth += 1;
      }
    }
    return null;
  }
  return null;
}

/**
 * Build tree children from a group's markup when evaluation has no group
 * (unused / not yet referenced defs). Paths match mapGeometry: parent.0, …
 */
function childrenFromGroupMarkup(
  content: string,
  groupId: string,
  parentPath: string,
  classById: Map<string, string>
): TreeItem[] {
  const inner = groupInnerXml(content, groupId);
  if (!inner) return [];
  const items: TreeItem[] = [];
  let depth = 0;
  const re = /<\/?([A-Za-z_][\w:.-]*)\b([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner))) {
    const full = m[0];
    const rawName = m[1];
    const attrs = m[2] ?? "";
    const selfClosing = /\/\s*>$/.test(full);
    const isClose = /^<\//.test(full);
    if (isClose) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const local = rawName.includes(":")
        ? rawName.slice(rawName.lastIndexOf(":") + 1)
        : rawName;
      const idx = items.length;
      const path = `${parentPath}.${idx}`;
      if (local.toLowerCase() === "g") {
        const id = attrOf(attrs, "id") ?? `g-${idx}`;
        const classAttr = attrOf(attrs, "class");
        items.push({
          value: path,
          label: id,
          children: childrenFromGroupMarkup(content, id, path, classById),
          meta: {
            kind: "geometry",
            icon: FolderIcon,
            node: syntheticGroup(id),
            className:
              classAttr?.split(/\s+/).filter(Boolean).join(" ") ||
              classById.get(id),
            action: "add-child",
          },
        });
      } else if (local.toLowerCase() === "use") {
        const href = attrOf(attrs, "href") ?? "";
        const groupId = href.replace(/^#/, "");
        items.push(
          makeUseTreeItem(path, groupId, attrOf(attrs, "id"))
        );
      } else if (PRIMITIVE_KIND_SET.has(local.toLowerCase())) {
        const kind = local.toLowerCase() as GeometryKind;
        items.push({
          value: path,
          label: elementLabel(kind),
          meta: {
            kind: "geometry",
            icon: kindIcon(kind),
            node: syntheticPrimitive(kind, parentPath),
            action: "geom-more",
          },
        });
      } else {
        const kind = local.toLowerCase();
        items.push({
          value: path,
          label: elementLabel(kind),
          meta: {
            kind: "geometry",
            icon: kindIcon(kind),
            node: null,
            action: "geom-more",
          },
        });
      }
    }
    if (!selfClosing) depth += 1;
  }
  return items;
}

function ensureExpanded(paths: string[]): void {
  const next = new Set(expanded.value);
  for (const p of paths) {
    if (p) next.add(p);
  }
  expanded.value = [...next];
}

function ancestorPaths(path: string): string[] {
  if (path.startsWith("model:")) {
    const parts = ["models"];
    const m = /^model:([^.]+)(.*)$/.exec(path);
    if (!m) return parts;
    parts.push(`model:${m[1]}`);
    const rest = m[2];
    if (!rest) return parts;
    const segs = rest.replace(/^\./, "").split(".").filter(Boolean);
    let cur = `model:${m[1]}`;
    for (let i = 0; i < segs.length - 1; i++) {
      cur = `${cur}.${segs[i]}`;
      parts.push(cur);
    }
    return parts;
  }
  if (path.startsWith("style:")) return ["style"];
  if (path.startsWith("material:")) return ["materials"];
  const parts: string[] = ["defs"];
  const m = /^(defs:[^.]+|i\d+)(.*)$/.exec(path);
  if (!m) return path.includes(":") ? [path.split(".")[0]!] : parts;
  const root = m[1]!;
  parts.push(root);
  const rest = m[2];
  if (!rest) return parts;
  const segs = rest.replace(/^\./, "").split(".").filter(Boolean);
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = `${cur}.${segs[i]}`;
    parts.push(cur);
  }
  return parts;
}

function activatePath(path: string): void {
  onActive([path]);
}

/**
 * Programmatic selection (e.g. viewport pick → tree).
 * Expands ancestors and emits the same `select` payload as a user click.
 */
function selectPath(path: string | null | undefined): void {
  if (!path) {
    actived.value = [];
    return;
  }
  ensureExpanded(ancestorPaths(path));
  void nextTick(() => {
    onActive([path]);
  });
}

/** Select last child under parent, or the path itself. */
function focusAfterEdit(
  parentPath: string,
  mode: "last-child" | "self" = "last-child"
): void {
  ensureExpanded([
    "models",
    "defs",
    "materials",
    "style",
    ...ancestorPaths(parentPath),
    parentPath,
  ]);
  if (mode === "self") {
    if (findItem(treeData.value, parentPath)) activatePath(parentPath);
    else actived.value = [parentPath];
    return;
  }
  const parent = findItem(treeData.value, parentPath);
  const last = parent?.children?.[parent.children.length - 1];
  if (last) activatePath(last.value);
  else if (parent?.meta.node) activatePath(parentPath);
}

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

function kindIcon(kind: string): Component {
  switch (kind) {
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
    case "sector-cylinder":
    case "pipe":
      return CircleIcon;
    case "line":
    case "arc":
    case "path":
      return Chart3DIcon;
    case "extrude":
    case "revolve":
    case "loft":
    case "sweep":
      return Chart3DIcon;
    case "mesh":
    case "triangles":
      return LayersIcon;
    case "group":
      return FolderIcon;
    case "bool-union":
    case "bool-intersect":
      return GitBranchIcon;
    case "bool-subtract":
      return AddAndSubtractIcon;
    case "if":
    case "if-not":
      return GitBranchIcon;
    case "loop-points":
    case "loop-range":
      return ViewListIcon;
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
  return kindIcon(inst.kind);
}

function menuOptions(items: AddChildMenuItem[]): DropdownOption[] {
  return items.map((p) => ({
    content: elementLabel(p.kind),
    value: p.kind,
    prefixIcon: () => h(kindIcon(p.kind)),
  }));
}

function categoryOption(
  labelKey: string,
  value: string,
  icon: Component,
  children: AddChildMenuItem[]
): DropdownOption {
  return {
    content: t(labelKey),
    value,
    prefixIcon: () => h(icon),
    children: menuOptions(children),
  };
}

/** Panel header “more” menu (document-level actions). */
const panelMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.optimize"),
    value: "optimize",
    prefixIcon: () => h(FilterClearIcon),
  },
]);

/** Destructive confirm: red confirm, cancel as safer default. */
function openDangerConfirm(options: {
  header: string;
  body: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
}): void {
  const dialog = DialogPlugin.confirm({
    header: options.header,
    body: options.body,
    theme: "danger",
    confirmBtn: { content: options.confirmText, theme: "danger" },
    cancelBtn: { content: t("app.cancel"), theme: "default" },
    confirmOnEnter: false,
    onOpened: () => {
      const root = document.querySelector(
        ".t-dialog__ctx--active .t-dialog__footer"
      );
      const cancel = root?.querySelector<HTMLButtonElement>(
        ".t-button:not(.t-button--theme-danger)"
      );
      cancel?.focus();
    },
    onConfirm: async () => {
      dialog.hide();
      try {
        await options.onConfirm();
      } finally {
        dialog.destroy();
      }
    },
  });
}

function onPanelMoreClick(item: DropdownOption): void {
  if (item.value !== "optimize") return;
  openDangerConfirm({
    header: t("app.optimizeHeader"),
    body: t("app.optimizeBody"),
    confirmText: t("app.optimizeConfirm"),
    onConfirm: () => emit("optimize"),
  });
}

/** Group row “more” menu: nested group / categorized children / delete. */
const groupMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.addGroup"),
    value: "group",
    prefixIcon: () => h(FolderIcon),
  },
  categoryOption("app.addCurve", "__add-curve", Chart3DIcon, CURVE_MENU),
  categoryOption("app.addSolid", "__add-solid", AddRectangleIcon, SOLID_MENU),
  categoryOption("app.addModeling", "__add-modeling", Chart3DFilledIcon, MODELING_MENU),
  categoryOption("app.addBool", "__add-bool", AddAndSubtractIcon, BOOL_MENU),
  categoryOption("app.addLogic", "__add-logic", GitBranchIcon, LOGIC_MENU),
  categoryOption("app.addLoop", "__add-loop", ViewListIcon, LOOP_MENU),
  {
    content: "",
    value: "__divider",
    divider: true,
  },
  {
    content: t("app.addUseToCurrentModel"),
    value: "use-in-model",
    prefixIcon: () => h(Link1Icon),
  },
  {
    content: t("app.deleteNode"),
    value: "delete",
    theme: "error",
    prefixIcon: () => h(DeleteIcon),
  },
]);

/** Model row “more” menu: add use / delete. */
const modelMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.addUse"),
    value: "add-use",
    prefixIcon: () => h(AddIcon),
  },
  {
    content: t("app.deleteNode"),
    value: "delete",
    theme: "error",
    prefixIcon: () => h(DeleteIcon),
  },
]);

/** Use / reference row “more” menu: jump (when href set) / delete. */
function useMoreOptions(item: TreeItem): DropdownOption[] {
  return [
    {
      content: t("app.jumpToHref"),
      value: "jump",
      disabled: !item.meta.hrefGroupId,
      prefixIcon: () => h(JumpIcon),
    },
    {
      content: t("app.deleteNode"),
      value: "delete",
      theme: "error",
      prefixIcon: () => h(DeleteIcon),
    },
  ];
}

/** Primitive / bool / other geometry “more” menu: delete. */
const geomMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.deleteNode"),
    value: "delete",
    theme: "error",
    prefixIcon: () => h(DeleteIcon),
  },
]);

/** Material row “more” menu: delete. */
const materialMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.deleteNode"),
    value: "delete",
    theme: "error",
    prefixIcon: () => h(DeleteIcon),
  },
]);

/** Style category row “more” menu: delete. */
const styleMoreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.deleteNode"),
    value: "delete",
    theme: "error",
    prefixIcon: () => h(DeleteIcon),
  },
]);

function shortId(id: string | undefined | null): string {
  if (!id) return "";
  const parts = id.split("/");
  return parts[parts.length - 1] || id;
}

function labelOf(inst: GeometryInstruction, useId?: string): string {
  switch (inst.type) {
    case "primitive":
      return elementLabel(inst.kind);
    case "group":
      return inst.id ?? tagLabel("group");
    case "bool_op":
      return elementLabel(`bool-${inst.op}`);
    case "instance":
      return useId?.trim() || (inst.group_id ? `#${inst.group_id}` : "");
    default:
      return "?";
  }
}

/** Parse `<s3dx:use>` children of a model from raw SVG (keeps optional use `id`). */
function extractModelUses(
  svg: string,
  modelId: string
): { id: string | null; groupId: string }[] {
  const openRe = /<s3dx:model\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  let openEnd = -1;
  while ((m = openRe.exec(svg))) {
    if (attrOf(m[1] ?? "", "id") !== modelId) continue;
    openEnd = m.index + m[0].length;
    break;
  }
  if (openEnd < 0) return [];

  const closeRe = /<\/s3dx:model\s*>/gi;
  closeRe.lastIndex = openEnd;
  const close = closeRe.exec(svg);
  if (!close) return [];
  const body = svg.slice(openEnd, close.index);
  const out: { id: string | null; groupId: string }[] = [];
  const useRe = /<s3dx:use\b([^>]*)\/?>/gi;
  let um: RegExpExecArray | null;
  while ((um = useRe.exec(body))) {
    const attrs = um[1] ?? "";
    // Keep empty href so the tree still shows unset references.
    const href = attrOf(attrs, "href") ?? "";
    out.push({
      id: attrOf(attrs, "id"),
      groupId: href.replace(/^#/, ""),
    });
  }
  return out;
}

function makeUseTreeItem(
  path: string,
  groupId: string,
  useId: string | null | undefined,
  transformM?: number[]
): TreeItem {
  const id = useId?.trim() || undefined;
  const hrefGroupId = groupId.trim() || undefined;
  // Own id → primary label; otherwise show target group id (full text, muted).
  // Unset href → localized placeholder (still a visible tree node).
  const label =
    id || (hrefGroupId ? `#${hrefGroupId}` : t("app.unsetHref"));
  return {
    value: path,
    label,
    meta: {
      kind: "geometry",
      icon: Link1Icon,
      node: syntheticInstance(hrefGroupId ?? "", path, transformM),
      useId: id,
      hrefGroupId,
      useTargetLabel: !id,
      action: "use-more",
    },
  };
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
  const hrefGroupId =
    inst.type === "instance" && inst.group_id?.trim()
      ? inst.group_id.trim()
      : undefined;
  return {
    value: path,
    label: labelOf(inst),
    meta: {
      kind: "geometry",
      icon: geometryIcon(inst),
      node: inst,
      className,
      hrefGroupId,
      action:
        inst.type === "instance"
          ? ("use-more" as const)
          : inst.type === "group" && inst.id
            ? ("add-child" as const)
            : ("geom-more" as const),
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

/** Prefer eval when in sync with markup; otherwise build from document. */
function makeDefsGroupItem(
  id: string,
  className: string | undefined,
  evaluated: GeometryInstruction | undefined,
  classById: Map<string, string>,
  content?: string
): TreeItem {
  const path = `defs:${id}`;
  const contentKids = content
    ? childrenFromGroupMarkup(content, id, path, classById)
    : [];

  if (
    evaluated &&
    (contentKids.length === 0 ||
      childrenOf(evaluated).length === contentKids.length)
  ) {
    const item = mapGeometry(evaluated, path, classById);
    if (className) item.meta.className = className;
    item.meta.action = "add-child";
    return item;
  }

  return {
    value: path,
    label: id,
    children: contentKids,
    meta: {
      kind: "geometry",
      icon: FolderIcon,
      node: evaluated ?? syntheticGroup(id),
      className,
      action: "add-child",
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
      makeDefsGroupItem(g.id, className, evalById.get(g.id), classById, content)
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

  // XML is source of truth. Do not fall back to eval materials when XML is
  // empty — that resurrects deleted material nodes in the tree.
  const docMaterials = content
    ? extractDocumentMaterials(content)
    : (result.materials ?? []).map((m) => ({
        id: m.id,
        color: Array.isArray(m.color) ? m.color.join(" ") : undefined,
        metalness:
          m.metalness !== undefined && m.metalness !== null
            ? String(m.metalness)
            : undefined,
        roughness:
          m.roughness !== undefined && m.roughness !== null
            ? String(m.roughness)
            : undefined,
      }));

  return [
    {
      value: "models",
      label: tagLabel("models"),
      meta: { kind: "section", icon: ViewListIcon, action: "add-model" },
      children: result.models.map((m) => ({
        value: `model:${m.id}`,
        label: m.id,
        meta: {
          kind: "model",
          icon: modelModeIcon(m.mode),
          modelId: m.id,
          modelMode: m.mode,
          action: "model-more" as const,
        },
        children: (() => {
          // Prefer XML order so empty/invalid href uses remain visible in the tree.
          const fromXml = content ? extractModelUses(content, m.id) : [];
          const rows =
            fromXml.length > 0
              ? fromXml
              : m.uses.map((u) => ({
                  id: null as string | null,
                  groupId: u.group_id,
                }));
          return rows.map((u, i) => {
            const path = `model:${m.id}.${i}`;
            const transformM = u.groupId
              ? m.uses.find((eu) => eu.group_id === u.groupId)?.transform?.m
              : undefined;
            return makeUseTreeItem(path, u.groupId, u.id, transformM);
          });
        })(),
      })),
    },
    {
      value: "defs",
      label: tagLabel("defs"),
      meta: { kind: "section", icon: LayersIcon, action: "add-group" },
      children: buildDefsChildren(result, content, classById),
    },
    {
      value: "materials",
      label: tagLabel("materials"),
      meta: { kind: "section", icon: ChartBubbleIcon, action: "add-material" },
      children: docMaterials.map((m) => ({
        value: `material:${m.id}`,
        label: m.id,
        meta: {
          kind: "material" as const,
          icon: ChartBubbleIcon,
          materialId: m.id,
          materialColor: m.color,
          materialMetalness: m.metalness,
          materialRoughness: m.roughness,
          action: "material-more" as const,
        },
      })),
    },
    {
      value: "style",
      label: tagLabel("styles"),
      meta: { kind: "section", icon: PaletteIcon, action: "add-style" },
      children: [
        {
          value: "style::root",
          label: tagLabel("root"),
          meta: {
            kind: "style" as const,
            icon: RootListIcon,
            styleName: ":root",
            styleGroupId: "",
            styleScope: "root" as const,
            styleProps: extractRootProps(content),
            styleResolved: {},
          },
        },
        // Categories from `<style>` rules ∪ class attrs on defs/groups.
        ...listStyleCategories(content).map((className) => {
          const groupId = firstGroupIdForClass(content, className);
          const groupNode = groupId
            ? findGroupById(result.instructions, groupId)
            : null;
          return {
            value: `style:.${className}`,
            label: className,
            meta: {
              kind: "style" as const,
              icon: BrushIcon,
              styleName: className,
              styleGroupId: groupId,
              className,
              styleScope: "class" as const,
              styleProps: { ...(classRules[className] ?? {}) },
              styleResolved: groupNode?.styles ?? {},
              action: "style-more" as const,
            },
          };
        }),
      ],
    },
  ];
}

/** Rebuild style tree when categories appear/disappear (not on prop edits). */
function styleCategoriesKey(svg: string): string {
  return listStyleCategories(svg).join("\n");
}

/** Rebuild when group↔class attachments change (参数定义组 hints). */
function styleAttachmentKey(svg: string): string {
  return extractClassedGroups(svg)
    .map((g) => `${g.id}:${g.classes.join(" ")}`)
    .join("\n");
}

function defsStructureKey(content: string): string {
  return extractDefsGroups(content)
    .map((g) => {
      const inner = (groupInnerXml(content, g.id) ?? "")
        .replace(/\s+/g, " ")
        .trim();
      return `${g.id}#${inner}`;
    })
    .join("\n");
}

/** Official TDesign pattern: replace `:data`; tree watches and rebuilds. */
function rebuildTree(): void {
  if (!props.result) {
    treeData.value = [];
    return;
  }
  treeData.value = buildTree(props.result, props.content ?? "");
}

/**
 * After document edit: refresh `:data` from content+result, then focus.
 */
function syncAfterEdit(
  parentPath?: string,
  opts?: { select?: "last-child" | "self" }
): void {
  const parent = parentPath ?? "defs";
  rebuildTree();
  void nextTick(() => {
    focusAfterEdit(parent, opts?.select ?? "last-child");
  });
}

function materialsStructureKey(content: string): string {
  return extractDocumentMaterials(content)
    .map((m) => m.id)
    .join("\n");
}

function resultStructureKey(r: EvaluationResult): string {
  const walk = (inst: GeometryInstruction): string => {
    const kids = childrenOf(inst).map(walk).join(",");
    return `${inst.node_id}(${kids})`;
  };
  return [
    r.models
      .map(
        (m) =>
          `${m.id}:${m.mode}:${m.active}:${m.uses.map((u) => u.group_id).join(",")}`
      )
      .join("|"),
    r.instructions.map(walk).join("|"),
    (r.materials ?? []).map((m) => m.id).join(","),
  ].join("||");
}

watch(
  () => props.result,
  (r, prev) => {
    if (!r) {
      treeData.value = [];
      return;
    }
    if (!prev) {
      rebuildTree();
      expanded.value = [
        "models",
        "defs",
        "materials",
        "style",
        ...r.models.map((m) => `model:${m.id}`),
      ];
      return;
    }
    if (resultStructureKey(prev) === resultStructureKey(r) && treeData.value.length) {
      return;
    }
    rebuildTree();
  }
);

watch(
  () => props.content,
  (content, prev) => {
    if (!props.result || !content || content === prev) return;
    if (
      prev &&
      styleCategoriesKey(prev) === styleCategoriesKey(content) &&
      styleAttachmentKey(prev) === styleAttachmentKey(content) &&
      defsStructureKey(prev) === defsStructureKey(content) &&
      materialsStructureKey(prev) === materialsStructureKey(content)
    ) {
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
  if (
    !path ||
    path === "models" ||
    path === "defs" ||
    path === "materials" ||
    path === "style"
  ) {
    return;
  }
  const item = findItem(treeData.value, path);
  if (!item) return;
  const { meta } = item;
  if (meta.kind === "geometry" && meta.node) {
    emit("select", {
      kind: "geometry",
      path,
      node: meta.node,
      className: meta.className,
    });
  } else if (meta.kind === "model" && meta.modelId) {
    emit("select", { kind: "model", path, modelId: meta.modelId });
  } else if (meta.kind === "material" && meta.materialId) {
    emit("select", {
      kind: "material",
      path,
      materialId: meta.materialId,
      color: meta.materialColor,
      metalness: meta.materialMetalness,
      roughness: meta.materialRoughness,
    });
  } else if (meta.kind === "style" && meta.styleName !== undefined) {
    const scope = meta.styleScope ?? "class";
    const liveProps =
      scope === "root"
        ? extractRootProps(props.content ?? "")
        : (meta.styleProps ?? {});
    emit("select", {
      kind: "style",
      path,
      name: meta.styleName,
      groupId: meta.styleGroupId ?? "",
      props: liveProps,
      resolved: meta.styleResolved ?? {},
      scope,
    });
  }
}

function labelHint(item: TreeItem | undefined): string {
  const meta = item?.meta;
  if (!meta) return "";
  if (meta.kind === "style") {
    if (meta.styleScope === "root") return ":root";
    return meta.styleGroupId ?? "";
  }
  if (meta.className) return meta.className;
  if (meta.kind === "model" && meta.modelMode) {
    return KNOWN_MODES.has(meta.modelMode)
      ? t(`mode.${meta.modelMode}`, meta.modelMode)
      : meta.modelMode;
  }
  if (meta.kind === "geometry" && meta.node) {
    const n = meta.node;
    if (n.type === "instance") {
      // Target already in label when no own id; with own id, hint shows target.
      if (meta.useId && n.group_id) return `#${n.group_id}`;
      return "";
    }
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

function onAddModel(ev: Event): void {
  ev.preventDefault();
  ev.stopPropagation();
  emit("addModel");
}

function onAddMaterial(ev: Event): void {
  ev.preventDefault();
  ev.stopPropagation();
  emit("addMaterial");
}

function onAddStyleCategory(ev: Event): void {
  ev.preventDefault();
  ev.stopPropagation();
  emit("addStyleCategory");
}

function onModelMoreClick(
  model: TreeItem,
  item: { value?: string | number | object }
): void {
  const value = item?.value;
  const modelId = model.meta.modelId;
  if (!modelId) return;
  if (value === "add-use") {
    emit("addUse", { modelId, path: model.value });
    return;
  }
  if (value === "delete") {
    emit("deleteModel", { path: model.value, modelId });
  }
}

function onUseMoreClick(
  useItem: TreeItem,
  item: { value?: string | number | object }
): void {
  const value = item?.value;
  if (value === "jump") {
    const groupId = useItem.meta.hrefGroupId;
    if (!groupId) return;
    const target = `defs:${groupId}`;
    if (!findItem(treeData.value, target)) {
      MessagePlugin.warning(t("app.jumpTargetMissing"));
      return;
    }
    selectPath(target);
    return;
  }
  if (value === "delete") {
    emit("deleteUse", { path: useItem.value });
  }
}

function onGeomMoreClick(
  geom: TreeItem,
  item: { value?: string | number | object }
): void {
  if (item?.value === "delete") {
    emit("deleteElement", { path: geom.value });
  }
}

function onMaterialMoreClick(
  material: TreeItem,
  item: { value?: string | number | object }
): void {
  if (item?.value === "delete") {
    emit("deleteElement", { path: material.value });
  }
}

function onStyleMoreClick(
  styleItem: TreeItem,
  item: { value?: string | number | object }
): void {
  if (item?.value !== "delete") return;
  const name = styleItem.meta.styleName?.trim() ?? "";
  if (!name || name === ":root") return;
  emit("deleteStyleCategory", { path: styleItem.value, name });
}

function isAddChildKind(v: unknown): v is AddChildKind {
  if (v === "group") return true;
  return ADD_CHILD_MENU.some((p) => p.kind === v);
}

function groupIdOf(item: TreeItem): string | undefined {
  if (item.meta.node?.type === "group") {
    return item.meta.node.id ?? item.meta.node.node_id;
  }
  return undefined;
}

const MENU_CATEGORY_VALUES = new Set([
  "__add-curve",
  "__add-solid",
  "__add-modeling",
  "__add-bool",
  "__add-logic",
  "__add-loop",
  "__divider",
]);

function onGroupMoreClick(
  parent: TreeItem,
  item: { value?: string | number | object }
): void {
  const value = item?.value;
  if (typeof value === "string" && MENU_CATEGORY_VALUES.has(value)) return;

  const groupId = groupIdOf(parent);
  if (!groupId) return;

  if (value === "delete") {
    emit("deleteNode", { path: parent.value, groupId });
    return;
  }
  if (value === "use-in-model") {
    emit("addUse", { path: parent.value, href: groupId });
    return;
  }
  if (!isAddChildKind(value)) return;
  emit("addChild", {
    parentPath: parent.value,
    parentGroupId: groupId,
    kind: value,
  });
}

function syntheticPrimitive(kind: GeometryKind, parentPath: string): GeometryInstruction {
  return {
    type: "primitive",
    node_id: `${parentPath}/${kind}:new`,
    kind,
    params: {},
    styles: {},
    transform: { m: [...IDENTITY_M] },
  };
}

function syntheticInstance(
  groupId: string,
  path: string,
  transformM?: number[]
): GeometryInstruction {
  return {
    type: "instance",
    node_id: `${path}/use`,
    group_id: groupId,
    styles: {},
    transform: {
      m: transformM?.length ? [...transformM] : [...IDENTITY_M],
    },
  };
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

defineExpose({ syncAfterEdit, selectPath });
</script>

<template>
  <aside class="node-tree-panel">
    <div class="panel-head">
      <div class="file-name" :title="fileName || undefined">
        <span class="file-name-text">{{ fileName }}</span>
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
      <t-dropdown
        :options="panelMoreOptions"
        :max-column-width="160"
        :min-column-width="120"
        trigger="click"
        placement="bottom-right"
        @click="onPanelMoreClick"
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
    <PanelSkeleton v-if="loading && !treeData.length" :rows="8" />
    <t-tree
      v-else
      :data="treeData"
      hover
      activable
      line
      :transition="false"
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
            :is="(node.data as TreeItem | undefined)?.meta?.icon || RootListIcon"
            class="tree-type-icon"
            size="16px"
          />
          <span
            v-if="node.label"
            class="tree-label-text"
            :class="{
              'is-use-target': (node.data as TreeItem | undefined)?.meta?.useTargetLabel,
            }"
          >{{ node.label }}</span>
          <span
            v-if="labelHint(node.data as TreeItem | undefined)"
            class="tree-label-hint"
          >{{ labelHint(node.data as TreeItem | undefined) }}</span>
        </span>
      </template>
      <template #operations="{ node }">
        <t-button
          v-if="(node.data as TreeItem | undefined)?.meta?.action === 'add-group'"
          class="tree-action"
          theme="default"
          shape="square"
          variant="text"
          size="small"
          :title="t('app.addGroup')"
          :aria-label="t('app.addGroup')"
          @click="onAddGroup"
          @mousedown.stop
        >
          <template #icon><AddIcon /></template>
        </t-button>
        <t-button
          v-else-if="
            (node.data as TreeItem | undefined)?.meta?.action === 'add-model'
          "
          class="tree-action"
          theme="default"
          shape="square"
          variant="text"
          size="small"
          :title="t('app.addModel')"
          :aria-label="t('app.addModel')"
          @click="onAddModel"
          @mousedown.stop
        >
          <template #icon><AddIcon /></template>
        </t-button>
        <t-button
          v-else-if="
            (node.data as TreeItem | undefined)?.meta?.action === 'add-material'
          "
          class="tree-action"
          theme="default"
          shape="square"
          variant="text"
          size="small"
          :title="t('app.addMaterial')"
          :aria-label="t('app.addMaterial')"
          @click="onAddMaterial"
          @mousedown.stop
        >
          <template #icon><AddIcon /></template>
        </t-button>
        <t-button
          v-else-if="
            (node.data as TreeItem | undefined)?.meta?.action === 'add-style'
          "
          class="tree-action"
          theme="default"
          shape="square"
          variant="text"
          size="small"
          :title="t('app.addStyleCategory')"
          :aria-label="t('app.addStyleCategory')"
          @click="onAddStyleCategory"
          @mousedown.stop
        >
          <template #icon><AddIcon /></template>
        </t-button>
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'model-more'"
          :options="modelMoreOptions"
          :max-column-width="160"
          :min-column-width="120"
          trigger="click"
          placement="bottom-right"
          @click="(item) => onModelMoreClick(node.data as TreeItem, item)"
        >
          <t-button
            class="tree-action"
            theme="default"
            shape="square"
            variant="text"
            size="small"
            :title="t('app.moreActions')"
            :aria-label="t('app.moreActions')"
            @mousedown.stop
            @click.stop
          >
            <template #icon><MoreIcon /></template>
          </t-button>
        </t-dropdown>
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'use-more'"
          :options="useMoreOptions(node.data as TreeItem)"
          :max-column-width="160"
          :min-column-width="120"
          trigger="click"
          placement="bottom-right"
          @click="(item) => onUseMoreClick(node.data as TreeItem, item)"
        >
          <t-button
            class="tree-action"
            theme="default"
            shape="square"
            variant="text"
            size="small"
            :title="t('app.moreActions')"
            :aria-label="t('app.moreActions')"
            @mousedown.stop
            @click.stop
          >
            <template #icon><MoreIcon /></template>
          </t-button>
        </t-dropdown>
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'add-child'"
          :options="groupMoreOptions"
          :max-column-width="200"
          :min-column-width="120"
          :max-height="420"
          trigger="click"
          placement="bottom-right"
          @click="(item) => onGroupMoreClick(node.data as TreeItem, item)"
        >
          <t-button
            class="tree-action"
            theme="default"
            shape="square"
            variant="text"
            size="small"
            :title="t('app.moreActions')"
            :aria-label="t('app.moreActions')"
            @mousedown.stop
            @click.stop
          >
            <template #icon><MoreIcon /></template>
          </t-button>
        </t-dropdown>
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'geom-more'"
          :options="geomMoreOptions"
          :max-column-width="160"
          :min-column-width="120"
          trigger="click"
          placement="bottom-right"
          @click="(item) => onGeomMoreClick(node.data as TreeItem, item)"
        >
          <t-button
            class="tree-action"
            theme="default"
            shape="square"
            variant="text"
            size="small"
            :title="t('app.moreActions')"
            :aria-label="t('app.moreActions')"
            @mousedown.stop
            @click.stop
          >
            <template #icon><MoreIcon /></template>
          </t-button>
        </t-dropdown>
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'material-more'"
          :options="materialMoreOptions"
          :max-column-width="160"
          :min-column-width="120"
          trigger="click"
          placement="bottom-right"
          @click="(item) => onMaterialMoreClick(node.data as TreeItem, item)"
        >
          <t-button
            class="tree-action"
            theme="default"
            shape="square"
            variant="text"
            size="small"
            :title="t('app.moreActions')"
            :aria-label="t('app.moreActions')"
            @mousedown.stop
            @click.stop
          >
            <template #icon><MoreIcon /></template>
          </t-button>
        </t-dropdown>
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'style-more'"
          :options="styleMoreOptions"
          :max-column-width="160"
          :min-column-width="120"
          trigger="click"
          placement="bottom-right"
          @click="(item) => onStyleMoreClick(node.data as TreeItem, item)"
        >
          <t-button
            class="tree-action"
            theme="default"
            shape="square"
            variant="text"
            size="small"
            :title="t('app.moreActions')"
            :aria-label="t('app.moreActions')"
            @mousedown.stop
            @click.stop
          >
            <template #icon><MoreIcon /></template>
          </t-button>
        </t-dropdown>
        <span v-else class="tree-action-spacer" aria-hidden="true" />
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
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  padding: 4px 0 10px 8px;
}

.file-name {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  font-size: 14px;
  font-weight: 600;
}

.file-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-tag {
  flex-shrink: 0;
}

.panel-more {
  flex-shrink: 0;
}

.empty {
  color: var(--td-text-color-secondary);
  font-size: 13px;
  padding: 8px;
}

:deep(.tree-type-icon) {
  color: var(--td-text-color-secondary);
  flex-shrink: 0;
}

:deep(.tree-label) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

:deep(.tree-label-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  min-width: 0;
}

:deep(.tree-label-text.is-use-target) {
  font-size: 12px;
  font-weight: 400;
  color: var(--td-text-color-secondary);
}

:deep(.tree-label-hint) {
  flex-shrink: 0;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--td-text-color-secondary);
  opacity: 0.85;
}

/* Keep row actions from inheriting `.t-tree__item--open .t-icon` brand color. */
:deep(.t-tree__operations .tree-action.t-button .t-icon) {
  color: inherit;
}

:deep(.t-tree__operations .t-dropdown),
:deep(.t-tree__operations .t-popup__reference) {
  display: inline-flex;
  align-items: center;
}

:deep(.t-tree__label) {
  display: flex;
  align-items: center;
  min-width: 0;
}

:deep(.t-tree__operations) {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}

:deep(.t-tree__operations:empty) {
  display: none;
}

.tree-action-spacer {
  display: inline-block;
  width: 0;
  height: 0;
  overflow: hidden;
}
</style>
