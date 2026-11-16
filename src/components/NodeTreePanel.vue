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
  FolderIcon,
  FrameIcon,
  GitBranchIcon,
  LayersIcon,
  Link1Icon,
  MoreIcon,
  PaletteIcon,
  RootListIcon,
  ViewListIcon,
  WidgetIcon,
} from "tdesign-icons-vue-next";
import type { DropdownOption } from "tdesign-vue-next";
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
  propsForClasses,
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
}>();

const emit = defineEmits<{
  select: [payload: TreeSelectPayload];
  addGroup: [];
  addChild: [payload: { parentPath: string; parentGroupId: string; kind: AddChildKind }];
  deleteNode: [payload: { path: string; groupId: string }];
}>();

const { t, tagLabel } = useI18n();

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
    /** defs section → empty group; group node → child menu */
    action?: "add-group" | "add-child";
    /** Own `id` on `<s3dx:use>` when present. */
    useId?: string;
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
          label: kind,
          meta: {
            kind: "geometry",
            icon: kindIcon(kind),
            node: syntheticPrimitive(kind, parentPath),
          },
        });
      } else {
        items.push({
          value: path,
          label: local.toLowerCase(),
          meta: {
            kind: "geometry",
            icon: kindIcon(local.toLowerCase()),
            node: null,
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

function menuLabel(zh: string, en: string): string {
  return locale.value === "zh" ? zh : en;
}

function menuOptions(items: AddChildMenuItem[]): DropdownOption[] {
  return items.map((p) => ({
    content: menuLabel(p.labelZh, p.labelEn),
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
      return inst.kind;
    case "group":
      return inst.id ?? tagLabel("group");
    case "bool_op":
      return `bool-${inst.op}`;
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
    const href = attrOf(attrs, "href");
    if (!href) continue;
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
  // Own id → primary label; otherwise show target group id (full text, muted).
  const label = id || (groupId ? `#${groupId}` : "");
  return {
    value: path,
    label,
    meta: {
      kind: "geometry",
      icon: Link1Icon,
      node: syntheticInstance(groupId, path, transformM),
      useId: id,
      useTargetLabel: !id && !!groupId,
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
  return {
    value: path,
    label: labelOf(inst),
    meta: {
      kind: "geometry",
      icon: geometryIcon(inst),
      node: inst,
      className,
      action:
        inst.type === "group" && inst.id ? ("add-child" as const) : undefined,
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

  const docMaterials = (() => {
    const fromXml = extractDocumentMaterials(content);
    if (fromXml.length) return fromXml;
    return (result.materials ?? []).map((m) => ({
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
  })();

  return [
    {
      value: "models",
      label: tagLabel("models"),
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
        children: (() => {
          const fromXml = content ? extractModelUses(content, m.id) : [];
          return m.uses.map((u, i) => {
            const path = `model:${m.id}.${i}`;
            const useId = fromXml[i]?.id ?? null;
            return makeUseTreeItem(path, u.group_id, useId, u.transform?.m);
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
      meta: { kind: "section", icon: ChartBubbleIcon },
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
        },
      })),
    },
    {
      value: "style",
      label: tagLabel("styles"),
      meta: { kind: "section", icon: PaletteIcon },
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
        ...classedGroups.map((g) => {
          const primary = g.classes[0] ?? "";
          const className = g.classes.join(" ");
          const groupNode = findGroupById(result.instructions, g.id);
          return {
            value: `style:${g.id}`,
            label: className,
            meta: {
              kind: "style" as const,
              icon: BrushIcon,
              styleName: className,
              styleGroupId: g.id,
              className,
              styleScope: "class" as const,
              styleProps: classRules[primary]
                ? { ...classRules[primary] }
                : propsForClasses(classRules, g.classes),
              styleResolved: groupNode?.styles ?? {},
            },
          };
        }),
      ],
    },
  ];
}

function styleOnlyKey(svg: string): string {
  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style/>");
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
    if (prev && styleOnlyKey(prev) === styleOnlyKey(content)) return;
    if (prev && defsStructureKey(prev) === defsStructureKey(content)) return;
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
    <div class="panel-head">{{ t("app.nodes") }}</div>
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
          theme="primary"
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
        <t-dropdown
          v-else-if="(node.data as TreeItem | undefined)?.meta?.action === 'add-child'"
          :options="groupMoreOptions"
          :max-column-width="160"
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
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px 10px;
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

:deep(.t-tree__operations .tree-action.t-button),
:deep(.t-tree__operations .tree-action.t-button .t-icon) {
  color: var(--td-brand-color);
}

:deep(.t-tree__operations .tree-action.t-button:hover),
:deep(.t-tree__operations .tree-action.t-button:focus) {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
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
