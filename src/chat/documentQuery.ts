/**
 * Structured document queries for the AI tools.
 * Tree handles (`defs:group.0`, `model:id.0`, `material:id`) are the values
 * read/write tools accept. An XML `id` is not a handle unless it is a `<g>`.
 * Index handles expire after a structural edit; `validateDocument` is the
 * document check that preview must not replace with evaluator warnings.
 */

import { extractDocumentMaterials } from "@/utils/documentMaterials";
import {
  applyAttrsAtPath,
  listChildOpensAtPath,
  listRootAnimOpens,
  nodeKindAtPath,
  readAttrsAtPath,
} from "@/utils/nodeXmlEdit";
import { extractClassRules, extractDefsGroups, extractRootProps } from "@/utils/styleClasses";
import {
  allocateElementId,
  collectElementIds,
  snippetForPathInsert,
} from "@/utils/svgEdit";

export type NodeRole =
  | "definition"
  | "instance"
  | "model"
  | "material"
  | "animate";

export type ListedNode = {
  handle: string;
  role: NodeRole;
  kind: string;
  id: string | null;
  parent: string | null;
  href?: string;
};

export type InstanceRef = {
  handle: string;
  modelId: string | null;
  href: string;
};

export type FoundNode = ListedNode & {
  /** Model `<s3dx:use>` nodes that show this definition. Empty if it is not instanced. */
  instances: InstanceRef[];
};

export type NodeListScope = "all" | "definitions" | "instances" | "materials";

const META_ATTRS = [
  "id",
  "class",
  "style",
  "fill",
  "material",
  "opacity",
  "s3dx:transform",
  "transform",
];

/** Geometry / container attrs the evaluator knows. Meta attrs are added on top. */
const KIND_ATTRS: Record<string, string[]> = {
  box: ["length", "width", "height", "lengthVec", "widthVec"],
  cylinder: ["diameter", "bottomCenterPt", "topCenterPt"],
  sphere: ["radius", "center"],
  cone: ["bottomDiameter", "topDiameter", "bottomCenterPt", "topCenterPt"],
  torus: ["diameter1", "diameter2", "angle", "torusCenterPt", "normal"],
  wedge: ["length", "width", "height", "lengthVec", "widthVec", "topLength"],
  pyramid: [
    "length",
    "width",
    "height",
    "lengthVec",
    "widthVec",
    "topLength",
    "topWidth",
  ],
  prism: ["points", "height", "normal"],
  "sector-cylinder": ["diameter", "bottomCenterPt", "topCenterPt", "angle"],
  point: ["at"],
  line: ["from", "to"],
  arc: [
    "form",
    "center",
    "normal",
    "radius",
    "xDir",
    "startAngle",
    "angle",
    "from",
    "to",
  ],
  path: ["form", "points", "d"],
  extrude: ["origin", "xDir", "normal", "dir", "length"],
  revolve: ["angle", "solid"],
  loft: ["solid", "blend"],
  sweep: [
    "orient",
    "refDir",
    "solid",
    "outerCorner",
    "innerCorner",
    "outerCornerRadius",
    "innerCornerRadius",
    "miterLimit",
  ],
  pipe: [
    "form",
    "radius",
    "innerRadius",
    "outerCorner",
    "innerCorner",
    "outerCornerRadius",
    "innerCornerRadius",
    "miterLimit",
  ],
  gltf: ["href"],
  group: [],
  use: ["href"],
  model: ["id", "mode", "active"],
  material: ["id", "color", "metalness", "roughness"],
  section: ["origin", "normal"],
  "svg-path": ["d"],
  "svg-circle": ["cx", "cy", "r"],
  circle: ["cx", "cy", "r"],
  "svg-rect": ["x", "y", "width", "height"],
  rect: ["x", "y", "width", "height"],
  "svg-ellipse": ["cx", "cy", "rx", "ry"],
  ellipse: ["cx", "cy", "rx", "ry"],
  "svg-polygon": ["points"],
  polygon: ["points"],
  "bool-union": [],
  "bool-subtract": [],
  "bool-intersect": [],
  if: ["test"],
  "if-not": ["test"],
  "loop-points": ["points"],
  "loop-range": ["start", "end", "step"],
  animate: [
    "attributeName",
    "from",
    "to",
    "dur",
    "repeat",
    "begin",
    "end",
    "calcMode",
    "values",
    "keyTimes",
    "fill",
  ],
  animateTransform: [
    "attributeName",
    "type",
    "from",
    "to",
    "dur",
    "repeat",
    "begin",
    "calcMode",
    "values",
    "keyTimes",
  ],
};

const WORLD =
  "Z-up. XY is the ground plane. XYZ values are space-separated numbers. Angles are degrees. Placement is s3dx:transform on the node or an ancestor <g>.";

const KIND_NOTES: Record<
  string,
  { coords?: string; children?: string; params?: Record<string, string> }
> = {
  box: {
    coords:
      "Centered on the local origin. length is X, width is Y, height is Z. The viewer draws this box axis-aligned; move it with s3dx:transform.",
    params: {
      length: "Size along local X.",
      width: "Size along local Y.",
      height: "Size along local Z.",
      lengthVec: "Accepted; the viewer box is still axis-aligned in local space.",
      widthVec: "Accepted; the viewer box is still axis-aligned in local space.",
    },
  },
  cylinder: {
    coords: "Axis runs from bottomCenterPt to topCenterPt.",
    params: {
      diameter: "Diameter.",
      bottomCenterPt: "XYZ of the bottom center.",
      topCenterPt: "XYZ of the top center.",
    },
  },
  sphere: {
    coords: "center is the sphere center in local space.",
    params: { radius: "Radius.", center: "XYZ center." },
  },
  cone: {
    coords: "Axis runs from bottomCenterPt to topCenterPt. A smaller topDiameter makes a truncated cone.",
    params: {
      bottomDiameter: "Diameter at bottomCenterPt.",
      topDiameter: "Diameter at topCenterPt.",
      bottomCenterPt: "XYZ.",
      topCenterPt: "XYZ.",
    },
  },
  torus: {
    coords: "Ring in the plane whose normal is `normal` (default +Z), centered at torusCenterPt.",
    params: {
      diameter1: "Major diameter (centerline of the tube).",
      diameter2: "Tube diameter.",
      angle: "Sweep of the ring in degrees. 360 is closed.",
      torusCenterPt: "XYZ.",
      normal: "XYZ plane normal.",
    },
  },
  wedge: {
    coords:
      "Corner at the local origin. length along lengthVec (default +X), width along widthVec (default +Y), height along their cross product (default +Z). Thick face at length 0.",
    params: {
      topLength: "Top-face length from the thick end. 0 collapses the top to a ridge.",
    },
  },
  pyramid: {
    coords:
      "Base center at the local origin. Height along lengthVec × widthVec (default +Z).",
    params: {
      topLength: "Top rectangle length. 0 is a point apex.",
      topWidth: "Top rectangle width. Defaults to topLength.",
    },
  },
  prism: {
    coords:
      "points are XYZ triplets of the base polygon (at least 3). height extrudes along normal. If normal is omitted, the polygon's own normal is used — an XY base (z=0) extrudes toward +Z.",
    params: {
      points:
        "XYZ triplets, e.g. \"0 0 0  100 0 0  100 100 0  0 100 0\". Winding of the first three points sets the normal when normal is omitted.",
      height: "Extrusion distance along normal. Omitted height evaluates as 1.",
      normal: "Optional XYZ extrusion direction. Omitted: polygon normal; a degenerate polygon uses +Z.",
    },
  },
  "sector-cylinder": {
    coords: "Axis from bottomCenterPt to topCenterPt. angle is the sector in degrees.",
  },
  point: {
    coords: "Positioning point. Not a solid. Other nodes read it with ref(#id).",
    params: { at: "XYZ position." },
  },
  line: { coords: "Straight segment from `from` to `to` (both XYZ)." },
  arc: {
    coords:
      "form=angles uses center, normal, radius, xDir, startAngle, angle. form=ends uses center, normal, radius, from, to.",
  },
  path: {
    coords:
      "form=segments uses child s3dx:line / s3dx:arc. form=polyline uses points as XYZ triplets. A sweep trajectory is a child path, usually form=polyline.",
    children: "line and arc children when form=segments.",
  },
  extrude: {
    coords:
      "Section is drawn in the plane at origin with normal (default +Z) and xDir (default +X). length extrudes along dir, or along normal when dir is omitted.",
    children: "One s3dx:section containing a 2D path, circle, rect, ellipse, or polygon.",
  },
  revolve: {
    coords:
      "Spins the section around local +Z. The default section transform maps the SVG XY profile onto the XOZ plane.",
    children: "One s3dx:section. Under revolve, pass kind=section so the editor inserts the XOZ orientation.",
    params: { angle: "Sweep in degrees.", solid: "true closes the volume." },
  },
  loft: {
    coords: "Skins ordered section planes. blend=linear between them.",
    children: "Two or more s3dx:section nodes, each with origin and normal.",
  },
  sweep: {
    coords:
      "Section rides the child path. orient=frenet frames the section on the curve tangent.",
    children: "One s3dx:section, then one s3dx:path trajectory.",
  },
  pipe: {
    coords:
      "Tube along the child path. radius is the outer radius; innerRadius makes a hollow pipe.",
    children: "One s3dx:path (form=polyline and points, or segments).",
  },
  gltf: { coords: "External triangle asset. href is a document-relative path such as assets/model.glb." },
  group: {
    coords: "Definition group under defs. A model shows it with s3dx:use href=\"#id\".",
  },
  use: { coords: "Instance of a defs group. href must be #groupId." },
  model: { coords: "A view. Children are s3dx:use instances, not the geometry definitions." },
  material: {
    coords:
      "Document material. color is RGBA in 0..1. Reference it from geometry as material=\"url(#id)\", never as a bare id.",
    params: {
      color: "RGBA floats, e.g. \"0.7 0.2 0.2 1\".",
      metalness: "0..1.",
      roughness: "0..1.",
    },
  },
  section: {
    coords:
      "2D profile. origin/normal place the plane. Under revolve the section also needs the default s3dx:transform that maps XY onto XOZ.",
    children: "A 2D path, circle, rect, ellipse, or polygon.",
  },
  if: { params: { test: "Shown when the expression is true." } },
  "if-not": { params: { test: "Shown when the expression is false." } },
  "loop-points": {
    coords: "Repeats children at each XYZ in points. The loop variable is available to child attributes.",
    params: { points: "XYZ triplets." },
  },
  "loop-range": {
    params: {
      start: "Inclusive start.",
      end: "Exclusive end.",
      step: "Increment.",
    },
  },
};

/**
 * Same built-ins and fallback rules as svg3dx-viewer `materials.ts`.
 * Kept local so tool code does not load the viewer barrel (ViewHelper / fonts).
 */
const BUILTIN_MATERIALS: Record<
  string,
  { color: [number, number, number, number]; metalness: number; roughness: number }
> = {
  default: { color: [1, 1, 1, 1], metalness: 0, roughness: 0.6 },
  steel: { color: [0.56, 0.57, 0.58, 1], metalness: 1, roughness: 0.35 },
  stainless: { color: [0.7, 0.7, 0.72, 1], metalness: 1, roughness: 0.25 },
  aluminum: { color: [0.91, 0.92, 0.92, 1], metalness: 1, roughness: 0.3 },
  copper: { color: [0.95, 0.64, 0.54, 1], metalness: 1, roughness: 0.35 },
  brass: { color: [0.88, 0.78, 0.45, 1], metalness: 1, roughness: 0.3 },
  plastic: { color: [0.85, 0.85, 0.85, 1], metalness: 0, roughness: 0.45 },
  rubber: { color: [0.15, 0.15, 0.15, 1], metalness: 0, roughness: 0.85 },
  concrete: { color: [0.55, 0.55, 0.52, 1], metalness: 0, roughness: 0.9 },
  glass: { color: [0.9, 0.95, 1, 0.25], metalness: 0, roughness: 0.05 },
  wood: { color: [0.55, 0.35, 0.18, 1], metalness: 0, roughness: 0.75 },
};

type MaterialDesc = {
  id: string;
  color: [number, number, number, number] | number[];
  metalness: number;
  roughness: number;
};

function materialLibraryFromResult(
  materials: MaterialDesc[] | undefined | null
): Map<string, MaterialDesc> {
  const map = new Map<string, MaterialDesc>();
  if (!materials) return map;
  for (const m of materials) {
    if (m?.id) map.set(m.id, m);
  }
  return map;
}

function resolveMaterialDesc(
  ref: string,
  library: Map<string, MaterialDesc>,
  warnings?: string[]
): {
  id: string;
  desc: { color: [number, number, number, number]; metalness: number; roughness: number };
} {
  const parsed = parseMaterialRef(ref);
  if (parsed.kind === "id") {
    const custom = library.get(parsed.value);
    if (custom) {
      return {
        id: custom.id,
        desc: {
          color: normalizeColor4(custom.color),
          metalness: custom.metalness,
          roughness: custom.roughness,
        },
      };
    }
    warnings?.push(
      `unknown material url(#${parsed.value}) — falling back to default`
    );
    return { id: "default", desc: { ...BUILTIN_MATERIALS.default! } };
  }
  const builtin = BUILTIN_MATERIALS[parsed.value];
  if (builtin) return { id: parsed.value, desc: { ...builtin } };
  if (library.has(parsed.value)) {
    warnings?.push(
      `material '${parsed.value}' is a document id — use url(#${parsed.value}); falling back to default`
    );
  } else {
    warnings?.push(`unknown material '${parsed.value}' — falling back to default`);
  }
  return { id: "default", desc: { ...BUILTIN_MATERIALS.default! } };
}

function normalizeColor4(
  c: number[] | [number, number, number, number]
): [number, number, number, number] {
  if (c.length >= 4) return [c[0]!, c[1]!, c[2]!, c[3]!];
  if (c.length === 3) return [c[0]!, c[1]!, c[2]!, 1];
  return [1, 1, 1, 1];
}

const BUILTIN_IDS = Object.keys(BUILTIN_MATERIALS);

export function ancestorHandles(handle: string): string[] {
  const parts = handle.split(".");
  const head = parts[0];
  if (!head) return [];
  const out = [head];
  let acc = head;
  for (let i = 1; i < parts.length; i++) {
    acc += `.${parts[i]}`;
    out.push(acc);
  }
  return out;
}

function roleForHandle(handle: string): NodeRole {
  if (handle.startsWith("material:")) return "material";
  if (handle.startsWith("anim:")) return "animate";
  if (handle.startsWith("model:")) {
    return handle.includes(".") ? "instance" : "model";
  }
  return "definition";
}

function modelIdFromHandle(handle: string): string | null {
  if (!handle.startsWith("model:")) return null;
  const id = handle.slice("model:".length).split(".")[0];
  return id || null;
}

function hrefTarget(href: string | undefined): string | null {
  if (!href) return null;
  const m = /#([^\s"'#)]+)/.exec(href.trim());
  return m?.[1] ?? null;
}

function nodeFromHandle(content: string, handle: string): ListedNode | null {
  const info = nodeKindAtPath(content, handle);
  const attrs = readAttrsAtPath(content, handle);
  if (!info || !attrs) return null;
  const ancestors = ancestorHandles(handle);
  const parent = ancestors.length > 1 ? ancestors[ancestors.length - 2]! : null;
  const href = attrs.href?.trim() || undefined;
  return {
    handle,
    role: roleForHandle(handle),
    kind: info.kind,
    id: info.id || null,
    parent,
    ...(href ? { href } : {}),
  };
}

function listModelIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<s3dx:model\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[1] ?? "");
    const value = (id?.[1] ?? id?.[2] ?? "").trim();
    if (value) ids.push(value);
  }
  return ids;
}

function pushWalk(
  content: string,
  handle: string,
  role: NodeRole,
  parent: string | null,
  out: ListedNode[],
  cap: number
): boolean {
  if (out.length >= cap) return false;
  const info = nodeKindAtPath(content, handle);
  const attrs = readAttrsAtPath(content, handle);
  if (!info || !attrs) return true;
  const href = attrs.href?.trim() || undefined;
  out.push({
    handle,
    role,
    kind: info.kind,
    id: info.id || null,
    parent,
    ...(href ? { href } : {}),
  });
  if (role !== "definition" && role !== "instance" && role !== "model") {
    return out.length < cap;
  }
  const childRole: NodeRole = role === "definition" ? "definition" : "instance";
  const kids = listChildOpensAtPath(content, handle);
  for (let i = 0; i < kids.length; i++) {
    if (!pushWalk(content, `${handle}.${i}`, childRole, handle, out, cap)) {
      return false;
    }
  }
  return out.length < cap;
}

function walkAll(content: string, cap: number): { nodes: ListedNode[]; truncated: boolean } {
  const nodes: ListedNode[] = [];
  let complete = true;
  for (const group of extractDefsGroups(content)) {
    if (!pushWalk(content, `defs:${group.id}`, "definition", null, nodes, cap)) {
      complete = false;
      break;
    }
  }
  if (complete) {
    for (const id of listModelIds(content)) {
      if (!pushWalk(content, `model:${id}`, "model", null, nodes, cap)) {
        complete = false;
        break;
      }
    }
  }
  if (complete) {
    for (const mat of extractDocumentMaterials(content)) {
      if (nodes.length >= cap) {
        complete = false;
        break;
      }
      const node = nodeFromHandle(content, `material:${mat.id}`);
      if (node) nodes.push(node);
    }
  }
  if (complete) {
    const rootAnims = listRootAnimOpens(content).length;
    for (let i = 0; i < rootAnims; i++) {
      if (nodes.length >= cap) {
        complete = false;
        break;
      }
      const node = nodeFromHandle(content, `anim:${i}`);
      if (node) nodes.push(node);
    }
  }
  return { nodes, truncated: !complete };
}

function scopeOk(node: ListedNode, scope: NodeListScope): boolean {
  if (scope === "all") return true;
  if (scope === "definitions") return node.role === "definition";
  if (scope === "instances") return node.role === "instance" || node.role === "model";
  return node.role === "material";
}

export function listDocumentNodes(
  content: string,
  opts: { scope?: NodeListScope; kind?: string; limit?: number } = {}
): { nodes: ListedNode[]; total: number; truncated: boolean } {
  const scope = opts.scope ?? "all";
  const limit = Math.max(1, Math.floor(opts.limit ?? 300));
  const walked = walkAll(content, 5000);
  const kind = opts.kind?.trim();
  const filtered = walked.nodes.filter(
    (n) => scopeOk(n, scope) && (!kind || n.kind === kind)
  );
  return {
    nodes: filtered.slice(0, limit),
    total: filtered.length,
    truncated: walked.truncated || filtered.length > limit,
  };
}

function containingGroupIds(content: string, handle: string): string[] {
  const ids: string[] = [];
  for (const h of ancestorHandles(handle)) {
    const info = nodeKindAtPath(content, h);
    if (info?.kind === "group" && info.id) ids.push(info.id);
  }
  return ids;
}

function instanceRefs(all: ListedNode[], content: string, node: ListedNode): InstanceRef[] {
  if (node.role !== "definition") return [];
  const ids = new Set(containingGroupIds(content, node.handle));
  if (node.kind === "group" && node.id) ids.add(node.id);
  const refs: InstanceRef[] = [];
  for (const item of all) {
    if (item.role !== "instance") continue;
    const target = hrefTarget(item.href);
    if (!target || !ids.has(target) || !item.href) continue;
    refs.push({
      handle: item.handle,
      modelId: modelIdFromHandle(item.handle),
      href: item.href,
    });
  }
  return refs;
}

export function findNodeById(content: string, id: string): FoundNode[] {
  const want = id.trim();
  if (!want) return [];
  const all = walkAll(content, 5000).nodes;
  return all
    .filter((n) => n.id === want)
    .map((n) => ({ ...n, instances: instanceRefs(all, content, n) }));
}

export function resolveNodeHandle(
  content: string,
  ref: string
):
  | { ok: true; handle: string; node: FoundNode; resolvedFromId?: string }
  | { ok: false; message: string; candidates?: FoundNode[] } {
  const trimmed = ref.trim();
  if (!trimmed) return { ok: false, message: "missing handle or id" };
  const direct = nodeFromHandle(content, trimmed);
  if (direct) {
    const all = direct.role === "definition" ? walkAll(content, 5000).nodes : [];
    return {
      ok: true,
      handle: trimmed,
      node: { ...direct, instances: instanceRefs(all, content, direct) },
    };
  }

  const ids: string[] = [];
  if (!trimmed.includes(":")) ids.push(trimmed);
  else {
    const tail = trimmed.slice(trimmed.indexOf(":") + 1);
    const last = tail.split(".").pop() ?? "";
    if (last && !/^\d+$/.test(last)) ids.push(last);
  }
  for (const id of ids) {
    const found = findNodeById(content, id);
    const defs = found.filter(
      (n) => n.role === "definition" || n.role === "material" || n.role === "model"
    );
    const pool = defs.length ? defs : found;
    if (pool.length === 1) {
      return {
        ok: true,
        handle: pool[0]!.handle,
        node: pool[0]!,
        resolvedFromId: id,
      };
    }
    if (pool.length > 1) {
      return {
        ok: false,
        message: `id '${id}' matches ${pool.length} nodes; pass a handle from list_nodes`,
        candidates: pool,
      };
    }
  }
  return {
    ok: false,
    message: `node not found: ${trimmed}. Use list_nodes or find_node_by_id. An xml id is not a tree handle unless it is a <g>.`,
  };
}

export function lastChildHandle(content: string, parentPath: string): string | null {
  const kids = listChildOpensAtPath(content, parentPath);
  if (!kids.length) return null;
  return `${parentPath}.${kids.length - 1}`;
}

function parseAttrMap(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) out[m[1]!] = m[2] ?? m[3] ?? "";
  return out;
}

function serializeAttrs(map: Record<string, string>, original: string): string {
  const order: string[] = [];
  const seen = new Set<string>();
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original))) {
    if (!seen.has(m[1]!)) {
      seen.add(m[1]!);
      order.push(m[1]!);
    }
  }
  for (const name of Object.keys(map)) {
    if (!seen.has(name)) order.push(name);
  }
  const parts: string[] = [];
  for (const name of order) {
    const value = map[name];
    if (value === undefined) continue;
    parts.push(
      `${name}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
    );
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** Merge attributes onto the first open tag of a snippet. Empty values remove. */
export function applyAttrsToSnippet(
  snippet: string,
  updates: Record<string, string>
): string {
  if (!Object.keys(updates).length) return snippet;
  const m = /<([A-Za-z_][\w:.-]*)\b([^>]*)>/.exec(snippet);
  if (!m) return snippet;
  const body = m[2] ?? "";
  const self = /\/\s*$/.test(body);
  const attrs = self ? body.replace(/\/\s*$/, "") : body;
  const map = parseAttrMap(attrs);
  for (const [name, raw] of Object.entries(updates)) {
    const value = raw.trim();
    if (!value) delete map[name];
    else map[name] = value;
  }
  const tag = m[1]!;
  const text = serializeAttrs(map, attrs);
  const open = self ? `<${tag}${text}/>` : `<${tag}${text}>`;
  return snippet.slice(0, m.index) + open + snippet.slice(m.index + m[0].length);
}

function allowedNames(kind: string): Set<string> | null {
  const listed = KIND_ATTRS[kind];
  if (!listed) return null;
  return new Set([...listed, ...META_ATTRS]);
}

function xmlNameOk(name: string): boolean {
  return /^[A-Za-z_:][\w:.-]*$/.test(name);
}

function idUsedByOther(content: string, id: string, selfHandle: string): boolean {
  return findNodeById(content, id).some((n) => n.handle !== selfHandle);
}

export function validateNodeAttrs(
  content: string,
  kind: string,
  handle: string | null,
  updates: Record<string, string>,
  opts: { allowIdentityRename?: boolean } = {}
):
  | { ok: true; updates: Record<string, string>; notes: string[] }
  | { ok: false; message: string } {
  const allow = allowedNames(kind);
  const next: Record<string, string> = {};
  const notes: string[] = [];
  const errors: string[] = [];
  for (const [name, raw] of Object.entries(updates)) {
    if (!xmlNameOk(name)) {
      errors.push(`invalid attribute name '${name}'`);
      continue;
    }
    if (allow && !allow.has(name)) {
      errors.push(
        `'${name}' is not an attribute of ${kind}. Allowed: ${[...allow].join(", ")}`
      );
      continue;
    }
    if (name === "material") {
      const canon = canonicalMaterialAttribute(content, raw);
      if (!canon.ok) {
        errors.push(canon.message);
        continue;
      }
      next.material = canon.attribute;
      if (canon.note) notes.push(canon.note);
      continue;
    }
    const value = raw.trim();
    if (name === "id" && value) {
      const taken = handle
        ? idUsedByOther(content, value, handle)
        : findNodeById(content, value).length > 0;
      if (taken) {
        errors.push(`id '${value}' is already used`);
        continue;
      }
    }
    if (
      !opts.allowIdentityRename &&
      (kind === "material" || kind === "model") &&
      name === "id" &&
      value &&
      handle
    ) {
      const current = nodeKindAtPath(content, handle)?.id ?? "";
      if (current && value !== current) {
        errors.push(
          `renaming a ${kind} id is handled by update_node_attrs, not the batch editor`
        );
        continue;
      }
    }
    next[name] = value;
  }
  if (errors.length) return { ok: false, message: errors.join("; ") };
  if (!Object.keys(next).length) return { ok: false, message: "missing updates" };
  return { ok: true, updates: next, notes };
}

export type MaterialWrite =
  | {
      ok: true;
      attribute: string;
      id: string;
      source: "builtin" | "document" | "cleared";
      note?: string;
    }
  | { ok: false; message: string };

/** `url(#id)` → id; otherwise the keyword. Same rule as the viewer. */
function parseMaterialRef(ref: string): { kind: "id" | "keyword"; value: string } {
  const m = /^url\(\s*#([^)\s]+)\s*\)$/i.exec(ref.trim());
  if (m) return { kind: "id", value: m[1]! };
  return { kind: "keyword", value: ref.trim() };
}

function normalizeRefToken(raw: string): string {
  const t = raw.trim();
  const quoted = /^url\(\s*["']#([^"')\s]+)["']\s*\)$/i.exec(t);
  if (quoted) return `url(#${quoted[1]})`;
  if (t.startsWith("#")) return `url(${t})`;
  return t;
}

export function canonicalMaterialAttribute(
  content: string,
  rawInput: string
): MaterialWrite {
  const raw = rawInput.trim();
  if (!raw) {
    return { ok: true, attribute: "", id: "", source: "cleared" };
  }
  const parsed = parseMaterialRef(normalizeRefToken(raw));
  const docIds = new Set(extractDocumentMaterials(content).map((d) => d.id));
  const docList = [...docIds].join(", ") || "(none)";
  const builtinList = BUILTIN_IDS.join(", ");
  if (parsed.kind === "id") {
    if (!docIds.has(parsed.value)) {
      return {
        ok: false,
        message: `no document material '${parsed.value}'. Built-ins: ${builtinList}. Document: ${docList}.`,
      };
    }
    return {
      ok: true,
      attribute: `url(#${parsed.value})`,
      id: parsed.value,
      source: "document",
    };
  }
  const keyword = parsed.value;
  if (Object.prototype.hasOwnProperty.call(BUILTIN_MATERIALS, keyword)) {
    return {
      ok: true,
      attribute: keyword,
      id: keyword,
      source: "builtin",
      ...(docIds.has(keyword)
        ? {
            note: `bare '${keyword}' is the built-in. The document material with the same id is url(#${keyword}).`,
          }
        : {}),
    };
  }
  if (docIds.has(keyword)) {
    return {
      ok: true,
      attribute: `url(#${keyword})`,
      id: keyword,
      source: "document",
      note: `document materials are stored as url(#${keyword}), not the bare id.`,
    };
  }
  return {
    ok: false,
    message: `unknown material '${keyword}'. Built-ins: ${builtinList}. Document: ${docList}.`,
  };
}

function color4(raw: string | undefined): [number, number, number, number] {
  if (!raw) return [1, 1, 1, 1];
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
    const a = parts.length >= 4 && Number.isFinite(parts[3]!) ? parts[3]! : 1;
    return [parts[0]!, parts[1]!, parts[2]!, a];
  }
  return [1, 1, 1, 1];
}

function numOr(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function libraryFromContent(content: string) {
  const docs: MaterialDesc[] = extractDocumentMaterials(content).map((d) => ({
    id: d.id,
    color: color4(d.color),
    metalness: numOr(d.metalness, 0),
    roughness: numOr(d.roughness, 0.5),
  }));
  return materialLibraryFromResult(docs);
}

export type ResolvedMaterial = {
  raw: string | null;
  effectiveId: string;
  source: "builtin" | "document" | "fallback";
  fellBack: boolean;
  reason: string | null;
  color: string;
  metalness: number;
  roughness: number;
};

function describeRef(content: string, ref: string): ResolvedMaterial {
  const warnings: string[] = [];
  const { id, desc } = resolveMaterialDesc(ref, libraryFromContent(content), warnings);
  const parsed = parseMaterialRef(ref);
  const source = warnings.length
    ? "fallback"
    : parsed.kind === "id"
      ? "document"
      : "builtin";
  const color = desc.color ?? [1, 1, 1, 1];
  return {
    raw: ref,
    effectiveId: id,
    source,
    fellBack: warnings.length > 0,
    reason: warnings[0] ?? null,
    color: color.map((n) => Number(n.toFixed(4))).join(" "),
    metalness: desc.metalness,
    roughness: desc.roughness,
  };
}

function inlineDecls(style: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!style) return out;
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i <= 0) continue;
    const name = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (name && value) out[name] = value;
  }
  return out;
}

type MatLayer = {
  ref: string;
  via: "root" | "attribute" | "class" | "inline";
  handle: string | null;
};

export function materialView(content: string, handle: string): {
  handle: string;
  role: NodeRole;
  kind: string;
  ownAttribute: string | null;
  ownResolution: ResolvedMaterial | null;
  effective: ResolvedMaterial;
  via: MatLayer["via"] | "unset";
  viaHandle: string | null;
  inherited: boolean;
  overridden: boolean;
  instances: InstanceRef[];
} | null {
  const node = nodeFromHandle(content, handle);
  if (!node) return null;
  const rules = extractClassRules(content);
  const layers: MatLayer[] = [];
  const root = extractRootProps(content)["--material"]?.trim();
  if (root) layers.push({ ref: root, via: "root", handle: null });
  for (const h of ancestorHandles(handle)) {
    const attrs = readAttrsAtPath(content, h);
    if (!attrs) continue;
    const attr = attrs.material?.trim();
    if (attr) layers.push({ ref: attr, via: "attribute", handle: h });
    for (const className of (attrs.class ?? "").split(/\s+/).filter(Boolean)) {
      const rule = rules[className];
      const ref = (rule?.["--material"] || rule?.material || "").trim();
      if (ref) layers.push({ ref, via: "class", handle: h });
    }
    const inline = inlineDecls(attrs.style)["--material"]?.trim();
    if (inline) layers.push({ ref: inline, via: "inline", handle: h });
  }
  const ownAttribute = readAttrsAtPath(content, handle)?.material?.trim() || null;
  const winner = layers[layers.length - 1];
  const effective = winner
    ? describeRef(content, winner.ref)
    : describeRef(content, "default");
  if (!winner) effective.raw = null;
  const ownResolution = ownAttribute ? describeRef(content, ownAttribute) : null;
  const all = node.role === "definition" ? walkAll(content, 5000).nodes : [];
  return {
    handle,
    role: node.role,
    kind: node.kind,
    ownAttribute,
    ownResolution,
    effective,
    via: winner?.via ?? "unset",
    viaHandle: winner?.handle ?? null,
    inherited: winner ? winner.handle !== handle : false,
    overridden: Boolean(
      ownAttribute &&
        winner &&
        (winner.handle !== handle || winner.via !== "attribute")
    ),
    instances: instanceRefs(all, content, node),
  };
}

export function rootAttrDefaults(kind: string): Record<string, string> {
  const parent = kind === "section" ? "extrude" : undefined;
  const snippet = snippetForPathInsert(kind, parent);
  if (!snippet) return {};
  const m = /<([A-Za-z_][\w:.-]*)\b([^>]*)>/.exec(snippet);
  if (!m) return {};
  const body = m[2] ?? "";
  const attrs = /\/\s*$/.test(body) ? body.replace(/\/\s*$/, "") : body;
  return parseAttrMap(attrs);
}

export type SchemaParam = {
  name: string;
  type: string;
  required: boolean;
  /** Value the editor writes on a new node. This is not the evaluator default. */
  insertDefault: string | null;
  note: string;
  onInvalid: string;
  /** Value the evaluator uses when the attribute is absent. */
  whenOmitted?: string;
  min?: number;
  max?: number;
  minCount?: number;
  values?: string[];
};

const ENUM_VALUES: Record<string, readonly string[]> = {
  "arc.form": ["angles", "ends"],
  "path.form": ["polyline", "segments"],
  "pipe.form": ["inline", "child"],
  "sweep.orient": ["frenet", "fixed", "parallel"],
  "sweep.outerCorner": ["round", "bevel", "miter"],
  "sweep.innerCorner": ["round", "bevel", "miter"],
  "pipe.outerCorner": ["round", "bevel", "miter"],
  "pipe.innerCorner": ["round", "bevel", "miter"],
  "loft.blend": ["linear", "sine", "cosine", "tan", "cotan"],
  "animate.calcMode": ["linear", "sine", "cosine", "tan", "cotan"],
  "animateTransform.calcMode": ["linear", "sine", "cosine", "tan", "cotan"],
  "animate.fill": ["remove", "freeze"],
  "revolve.solid": ["true", "false"],
  "loft.solid": ["true", "false"],
  "sweep.solid": ["true", "false"],
  "model.active": ["true", "false"],
};

const REQUIRED_PARAMS: Record<string, readonly string[]> = {
  prism: ["points"],
  use: ["href"],
  gltf: ["href"],
  material: ["id"],
  line: ["from", "to"],
  point: ["at"],
};

const XYZ_NAMES = new Set([
  "center",
  "bottomCenterPt",
  "topCenterPt",
  "torusCenterPt",
  "normal",
  "lengthVec",
  "widthVec",
  "at",
  "origin",
  "xDir",
  "dir",
  "refDir",
]);

const NUMBER_NAMES = new Set([
  "length",
  "width",
  "height",
  "radius",
  "diameter",
  "diameter1",
  "diameter2",
  "bottomDiameter",
  "topDiameter",
  "topLength",
  "topWidth",
  "metalness",
  "roughness",
  "opacity",
  "outerCornerRadius",
  "innerCornerRadius",
  "miterLimit",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
]);

function schemaParam(
  kind: string,
  name: string,
  fallback: string | null,
  note: string
): SchemaParam {
  const values = ENUM_VALUES[`${kind}.${name}`];
  const anim = kind === "animate" || kind === "animateTransform";
  let type = "string";
  if (values) type = name === "solid" || name === "active" ? "boolean" : "enum";
  else if (name === "material") type = "material";
  else if (name === "color") type = "color";
  else if (
    name === "points" &&
    ["prism", "path", "loop-points", "polygon", "svg-polygon"].includes(kind)
  ) {
    type = "xyz-list";
  } else if (name === "angle" || name === "startAngle") type = "angle";
  else if ((name === "from" || name === "to") && (kind === "line" || kind === "arc")) {
    type = "xyz";
  } else if (XYZ_NAMES.has(name) && !anim) type = "xyz";
  else if (NUMBER_NAMES.has(name) && !anim) type = "number";
  else if (kind === "loop-range" && (name === "start" || name === "end" || name === "step")) {
    type = "number";
  }

  let onInvalid = "The evaluator skips the primitive or ignores the attribute.";
  if (type === "material") {
    onInvalid =
      "A bare document id, an unknown url(#id), or an unknown keyword falls back to the default material. Write document materials as url(#id).";
  } else if (kind === "prism" && name === "points") {
    onInvalid =
      "Fewer than 3 XYZ triplets produces no mesh. When normal is omitted, extrusion follows the cross product of (p1-p0) and (p2-p0). Reversing that winding reverses the normal. A degenerate polygon uses +Z.";
  } else if (kind === "prism" && name === "height") {
    onInvalid =
      "Omitted height evaluates as 1. A non-positive height is clamped to a tiny extrusion along normal.";
  } else if (kind === "prism" && name === "normal") {
    onInvalid =
      "Omit it to use the polygon normal. A zero vector falls back to +Z. Reversing point order reverses the omitted normal.";
  } else if (type === "enum" || type === "boolean") {
    onInvalid = `Use one of: ${values!.join(", ")}.`;
  } else if (type === "xyz") {
    onInvalid = "Need three numbers. A short vector is ignored or the primitive is skipped.";
  } else if (type === "xyz-list") {
    onInvalid = "Values are space-separated XYZ triplets.";
  } else if (type === "number" || type === "angle") {
    onInvalid = "A non-numeric value fails the primitive.";
  } else if (type === "color") {
    onInvalid = "RGBA floats in 0..1, e.g. \"0.7 0.2 0.2 1\".";
  } else if (name === "href" && kind === "use") {
    onInvalid = "href must be #groupId of a <g> under defs. An unknown target draws nothing.";
  } else if (name === "href" && kind === "gltf") {
    onInvalid = "href is a document-relative asset path. A missing file draws nothing.";
  }

  const param: SchemaParam = {
    name,
    type,
    required: (REQUIRED_PARAMS[kind] ?? []).includes(name),
    insertDefault: fallback,
    note,
    onInvalid,
  };
  if (kind === "prism" && name === "points") param.minCount = 3;
  if (kind === "prism" && name === "height") param.whenOmitted = "1";
  if (kind === "prism" && name === "normal") {
    param.whenOmitted = "(p1-p0) × (p2-p0), or +Z when that cross product is degenerate";
  }
  if (name === "metalness" || name === "roughness" || name === "opacity") {
    param.min = 0;
    param.max = 1;
  }
  if (values) param.values = [...values];
  return param;
}

const TRANSFORM_NOTE =
  "Local placement. World = ancestor transforms · this transform · local geometry (column vector, p' = M p). Two syntaxes, not mixed in one value: matrix(a b c d e f g h i tx ty tz) or the same 12 numbers bare — columns are xdir, ydir, zdir, translation; identity is 1 0 0 0 1 0 0 0 1 0 0 0. Or translate(tx ty tz) rotate(rx ry rz) scale(sx sy sz), any subset. Written function order does not change the matrix: M = T · R · S. Inside R, R = Rz · Ry · Rx (fixed-axis X, then Y, then Z; Three.js Euler XYZ), so p' = Rz Ry Rx p. rotate(90 90 0) applies Rx then Ry and equals matrix(0 0 -1 1 0 0 0 -1 0 0 0 0); local +X (1 0 0) lands on (0 0 -1). Empty or identity removes the attribute.";

const WITHOUT_SHARED = new Set(["animate", "animateTransform", "material"]);

function sharedAttrParams(): SchemaParam[] {
  return [
    {
      name: "id",
      type: "id",
      required: false,
      insertDefault: null,
      whenOmitted: "no id; the index handle expires when an earlier sibling changes",
      note: "Document-unique XML id. Stable address for find_node_by_id and edit_document.",
      onInvalid: "A duplicate id is rejected. New nodes receive {kind}-N.",
    },
    {
      name: "class",
      type: "string",
      required: false,
      insertDefault: null,
      note: "Space-separated class names. A class rule may set --material, which overrides the material attribute.",
      onInvalid: "An unknown class name adds no declarations.",
    },
    {
      name: "style",
      type: "style",
      required: false,
      insertDefault: null,
      note: "Inline CSS declarations. --material on this node wins over its material attribute.",
      onInvalid: "An unparsable declaration is ignored.",
    },
    {
      name: "fill",
      type: "color",
      required: false,
      insertDefault: null,
      note: "SVG fill. Used as presentation color when no material resolves.",
      onInvalid: "An unparsable color is ignored.",
    },
    {
      name: "material",
      type: "material",
      required: false,
      insertDefault: null,
      whenOmitted: "inherit from an ancestor, otherwise the built-in default",
      note: "Built-in keyword (steel, plastic, default, …) or url(#documentId). A bare document id falls back to default.",
      onInvalid:
        "A bare document id, an unknown url(#id), or an unknown keyword falls back to the default material. Write document materials as url(#id).",
    },
    {
      name: "opacity",
      type: "number",
      required: false,
      insertDefault: null,
      whenOmitted: "1",
      min: 0,
      max: 1,
      note: "Opacity from 0 to 1.",
      onInvalid: "A non-numeric value is ignored.",
    },
    {
      name: "s3dx:transform",
      type: "transform",
      required: false,
      insertDefault: null,
      whenOmitted: "identity",
      note: TRANSFORM_NOTE,
      onInvalid:
        "A matrix that is not 12 numbers, or a TRS function with a non-numeric argument, is ignored and the transform stays identity. Do not mix matrix() with translate/rotate/scale.",
    },
    {
      name: "transform",
      type: "transform",
      required: false,
      insertDefault: null,
      whenOmitted: "identity",
      note: `Unprefixed alias of s3dx:transform. Prefer s3dx:transform. ${TRANSFORM_NOTE}`,
      onInvalid:
        "Same rules as s3dx:transform. Prefer the prefixed attribute so it is not read as an SVG transform.",
    },
  ];
}

function sharedQuery(name: string): SchemaParam[] | null {
  const key = name.trim().toLowerCase();
  if (key === "shared" || key === "attrs" || key === "attributes") {
    return sharedAttrParams();
  }
  if (key === "transform" || key === "s3dx:transform") {
    return sharedAttrParams().filter((p) => p.name === "s3dx:transform");
  }
  if (key === "material") return null;
  const params = sharedAttrParams();
  const hit = params.find((p) => p.name.toLowerCase() === key);
  return hit ? [hit] : null;
}

export function getNodeSchema(kind: string):
  | {
      ok: true;
      schema: {
        kind: string;
        element: string;
        coords: string;
        children?: string;
        shared?: boolean;
        insertDefaults: Record<string, string>;
        params: SchemaParam[];
      };
    }
  | { ok: false; message: string; kinds: string[] } {
  const name = kind.trim();
  const kinds = Object.keys(KIND_ATTRS);
  const shared = sharedQuery(name);
  if (shared) {
    return {
      ok: true,
      schema: {
        kind: name.toLowerCase() === "transform" ? "s3dx:transform" : name,
        element: "",
        coords: WORLD,
        shared: true,
        insertDefaults: {},
        params: shared,
      },
    };
  }
  if (!name || name === "list" || name === "*") {
    return {
      ok: true,
      schema: {
        kind: "list",
        element: "",
        coords: WORLD,
        insertDefaults: {},
        params: kinds.map((k) => ({
          name: k,
          type: "kind",
          required: false,
          insertDefault: null,
          note: "pass this kind to get_node_schema",
          onInvalid: "Unknown kinds are rejected. Shared attributes: get_node_schema('shared') or get_node_schema('s3dx:transform').",
        })),
      },
    };
  }
  if (!KIND_ATTRS[name] && name !== "group") {
    return {
      ok: false,
      message: `unknown kind '${name}'. Shared attributes: get_node_schema('shared') or get_node_schema('s3dx:transform').`,
      kinds,
    };
  }
  const notes = KIND_NOTES[name];
  const insertDefaults = rootAttrDefaults(name);
  const names = new Set([...(KIND_ATTRS[name] ?? []), ...Object.keys(insertDefaults)]);
  const params = [...names].map((param) =>
    schemaParam(name, param, insertDefaults[param] ?? null, notes?.params?.[param] ?? "")
  );
  if (!WITHOUT_SHARED.has(name)) {
    const have = new Set(params.map((p) => p.name));
    for (const attr of sharedAttrParams()) {
      if (!have.has(attr.name)) params.push(attr);
    }
  }
  const svgLeaf = new Set(["circle", "rect", "ellipse", "polygon"]);
  const element =
    name === "group"
      ? "g"
      : name.startsWith("svg-")
        ? name.slice(4)
        : svgLeaf.has(name)
          ? name
          : `s3dx:${name}`;
  return {
    ok: true,
    schema: {
      kind: name,
      element,
      coords: [WORLD, notes?.coords].filter(Boolean).join(" "),
      ...(notes?.children ? { children: notes.children } : {}),
      insertDefaults,
      params,
    },
  };
}

export type NodeEdit = { handle: string; updates: Record<string, string> };

export function applyNodeUpdates(
  content: string,
  edits: NodeEdit[]
):
  | {
      ok: true;
      content: string;
      results: {
        handle: string;
        resolvedFromId?: string;
        attrs: Record<string, string> | null;
        notes?: string[];
        material?: ReturnType<typeof materialView>;
      }[];
    }
  | { ok: false; message: string; errors: { handle: string; message: string }[] } {
  if (!edits.length) {
    return { ok: false, message: "missing edits", errors: [] };
  }
  const errors: { handle: string; message: string }[] = [];
  const planned: {
    handle: string;
    resolvedFromId?: string;
    updates: Record<string, string>;
    notes: string[];
    wantMaterial: boolean;
  }[] = [];
  for (const edit of edits) {
    const resolved = resolveNodeHandle(content, edit.handle);
    if (!resolved.ok) {
      errors.push({ handle: edit.handle, message: resolved.message });
      continue;
    }
    const kind = resolved.node.kind;
    const valid = validateNodeAttrs(
      content,
      kind,
      resolved.handle,
      edit.updates
    );
    if (!valid.ok) {
      errors.push({ handle: resolved.handle, message: valid.message });
      continue;
    }
    planned.push({
      handle: resolved.handle,
      ...(resolved.resolvedFromId
        ? { resolvedFromId: resolved.resolvedFromId }
        : {}),
      updates: valid.updates,
      notes: valid.notes,
      wantMaterial: Object.prototype.hasOwnProperty.call(edit.updates, "material"),
    });
  }
  if (errors.length) {
    return {
      ok: false,
      message: errors.map((e) => `${e.handle}: ${e.message}`).join(" | "),
      errors,
    };
  }
  let next = content;
  for (const edit of planned) {
    const updated = applyAttrsAtPath(next, edit.handle, edit.updates);
    if (!updated) {
      errors.push({ handle: edit.handle, message: "path not found during apply" });
      break;
    }
    next = updated;
  }
  if (errors.length) {
    return {
      ok: false,
      message: errors.map((e) => `${e.handle}: ${e.message}`).join(" | "),
      errors,
    };
  }
  return {
    ok: true,
    content: next,
    results: planned.map((edit) => ({
      handle: edit.handle,
      ...(edit.resolvedFromId ? { resolvedFromId: edit.resolvedFromId } : {}),
      attrs: readAttrsAtPath(next, edit.handle),
      ...(edit.notes.length ? { notes: edit.notes } : {}),
      ...(edit.wantMaterial
        ? { material: materialView(next, edit.handle) }
        : {}),
    })),
  };
}

export function classifyRenderWarning(
  message: string
): "material" | "geometry" | "other" {
  if (/material|\bfill\b|opacity/i.test(message)) return "material";
  if (
    /unknown s3dx|unknown attribute|skipped|ref\(#|invertible|requires |invalid|not a multiple|operand/i.test(
      message
    )
  ) {
    return "geometry";
  }
  return "other";
}

/** Evaluator warnings do not include host material-reference fallback. */
export const RUNTIME_WARNING_SCOPE =
  "runtimeWarnings are evaluator messages only (unknown elements, bad parameters, missing geometry). They do not include material-reference fallback. documentValid is the document check, the same field as validate_document. The call's ok only means the preview was captured. documentValid is true only when documentErrors is 0.";

export const HANDLE_LIFETIME =
  "Index handles such as defs:main.7 address the child currently at that position. They stay valid until an earlier sibling is inserted, deleted, or moved; after that the same string can address a different node. In one edit_document transaction, bind an index handle before any insert, delete, or move. An unbound or shifted index fails with handle.stale and writes nothing. Ids are stable and resolve again through find_node_by_id. Assigning an id does not shift indexes. New nodes receive an id; ensure_node_ids fills any that are still missing.";

/** `defs:main.7` and `anim:0` name a position. `defs:main` and a bare id do not. */
export function isPositionalHandle(ref: string): boolean {
  const trimmed = ref.trim();
  const colon = trimmed.indexOf(":");
  if (colon < 0) return false;
  return trimmed
    .slice(colon + 1)
    .split(".")
    .some((seg) => /^\d+$/.test(seg));
}

/** XYZ triplets. A repeated closing vertex is dropped, matching prism mesh build. */
export function parseXyzList(raw: string): number[][] {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const pts: number[][] = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    pts.push([nums[i]!, nums[i + 1]!, nums[i + 2]!]);
  }
  if (pts.length >= 2) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) pts.pop();
  }
  return pts;
}

/**
 * Unit normal of a prism base: (p1-p0) × (p2-p0).
 * Same rule as the viewer `buildPrismGeometry` when `normal` is omitted.
 * A degenerate cross product is +Z. Null when there are fewer than 3 points.
 */
export function prismPolygonNormal(
  points: number[][]
): [number, number, number] | null {
  if (points.length < 3) return null;
  const a = points[0]!;
  const b = points[1]!;
  const c = points[2]!;
  const x = (b[1]! - a[1]!) * (c[2]! - a[2]!) - (b[2]! - a[2]!) * (c[1]! - a[1]!);
  const y = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!);
  const z = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
  const len = Math.hypot(x, y, z);
  if (len < 1e-12) return [0, 0, 1];
  return [x / len, y / len, z / len];
}

export type MaterialReferenceIssue = {
  code: string;
  message: string;
  fix: string;
};

/** Host material fallback. Null when the reference resolves. */
export function materialReferenceIssue(
  content: string,
  raw: string
): MaterialReferenceIssue | null {
  const token = normalizeRefToken(raw);
  if (!token) return null;
  if (/url\s*\(/i.test(raw) && !/^url\(\s*#([^)\s]+)\s*\)$/i.test(token)) {
    return {
      code: "material.unparsed",
      message: `could not parse material '${raw.trim()}' — falling back to default`,
      fix: "url(#id)",
    };
  }
  const parsed = parseMaterialRef(token);
  const docs = new Set(extractDocumentMaterials(content).map((d) => d.id));
  if (parsed.kind === "id") {
    if (docs.has(parsed.value)) return null;
    return {
      code: "material.unknown-url",
      message: `unknown material url(#${parsed.value}) — falling back to default`,
      fix: "Create that material, or set material to a built-in keyword or an existing url(#id).",
    };
  }
  const keyword = parsed.value;
  if (!keyword) return null;
  if (Object.prototype.hasOwnProperty.call(BUILTIN_MATERIALS, keyword)) return null;
  if (docs.has(keyword)) {
    return {
      code: "material.bare-document-id",
      message: `material '${keyword}' is a document id — use url(#${keyword}); falling back to default`,
      fix: `url(#${keyword})`,
    };
  }
  return {
    code: "material.unknown-keyword",
    message: `unknown material '${keyword}' — falling back to default`,
    fix: "Use a built-in keyword (steel, plastic, default, …) or url(#documentId).",
  };
}

/** One attribute write. Pass a list of these as edit_document ops; nothing is written until then. */
export type IssueRepair = {
  op: "update";
  handle: string;
  updates: Record<string, string>;
};

export type DocumentIssue = {
  handle: string;
  id: string | null;
  kind: string;
  attribute: string;
  code: string;
  severity: "error" | "info";
  message: string;
  fix: string;
  /** Present when the fix is an attribute write. Infos are omitted from the top-level repairs batch. */
  repair?: IssueRepair;
};

const CONCRETE_MATERIAL = /^(?:url\(\s*#[^)\s]+\s*\)|[A-Za-z_][\w.-]*)$/;
const CONCRETE_ID = /^[A-Za-z_][\w:.-]*$/;

function repairFor(issue: {
  handle: string;
  id: string | null;
  attribute: string;
  code: string;
  fix: string;
}): IssueRepair | undefined {
  if (!issue.handle || issue.handle.startsWith("style:")) return undefined;
  const fix = issue.fix.trim();
  if (issue.attribute === "material" && CONCRETE_MATERIAL.test(fix)) {
    return {
      op: "update",
      handle: issue.id || issue.handle,
      updates: { material: fix },
    };
  }
  if (
    (issue.code === "id.missing" || issue.code === "id.duplicate") &&
    CONCRETE_ID.test(fix)
  ) {
    return {
      op: "update",
      handle: issue.handle,
      updates: { id: fix },
    };
  }
  if (issue.code === "attr.unknown" && issue.attribute && !issue.attribute.includes(" ")) {
    return {
      op: "update",
      handle: issue.id || issue.handle,
      updates: { [issue.attribute]: "" },
    };
  }
  return undefined;
}

function pushIssue(issues: DocumentIssue[], issue: DocumentIssue): void {
  issues.push(issue);
}

export function validateDocument(content: string): {
  issues: DocumentIssue[];
  errorCount: number;
  infoCount: number;
  /** True when errorCount is 0. Infos such as id.missing do not clear this. */
  documentValid: boolean;
  /** Error repairs only. Pass to edit_document for one undo. This call does not write. */
  repairs: IssueRepair[];
  handleLifetime: string;
} {
  const issues: DocumentIssue[] = [];
  const walked = walkAll(content, 5000);
  const used = collectElementIds(content);
  const seen = new Map<string, string>();
  const groupIds = new Set(extractDefsGroups(content).map((g) => g.id));
  const rules = extractClassRules(content);

  for (const node of walked.nodes) {
    if (!node.id) {
      const id = allocateElementId(used, node.kind);
      pushIssue(issues, {
        handle: node.handle,
        id: null,
        kind: node.kind,
        attribute: "id",
        code: "id.missing",
        severity: "info",
        message: `${node.kind} has no id. Index handles for it expire when an earlier sibling changes.`,
        fix: id,
      });
    } else {
      const first = seen.get(node.id);
      if (first) {
        const id = allocateElementId(used, node.kind);
        pushIssue(issues, {
          handle: node.handle,
          id: node.id,
          kind: node.kind,
          attribute: "id",
          code: "id.duplicate",
          severity: "error",
          message: `id '${node.id}' is already used at ${first}.`,
          fix: id,
        });
      } else {
        seen.set(node.id, node.handle);
      }
    }

    const attrs = readAttrsAtPath(content, node.handle);
    if (!attrs) continue;
    const allow = allowedNames(node.kind);
    if (allow) {
      for (const name of Object.keys(attrs)) {
        if (name.startsWith("xmlns")) continue;
        if (!allow.has(name)) {
          pushIssue(issues, {
            handle: node.handle,
            id: node.id,
            kind: node.kind,
            attribute: name,
            code: "attr.unknown",
            severity: "error",
            message: `'${name}' is not an attribute of ${node.kind}.`,
            fix: "Remove it, or see get_node_schema for the allowed names.",
          });
        }
      }
    }

    const ownMaterial = attrs.material?.trim();
    if (ownMaterial) {
      const found = materialReferenceIssue(content, ownMaterial);
      if (found) {
        pushIssue(issues, {
          handle: node.handle,
          id: node.id,
          kind: node.kind,
          attribute: "material",
          code: found.code,
          severity: "error",
          message: found.message,
          fix: found.fix,
        });
      }
    }
    const inline = inlineDecls(attrs.style)["--material"]?.trim();
    if (inline) {
      const found = materialReferenceIssue(content, inline);
      if (found) {
        pushIssue(issues, {
          handle: node.handle,
          id: node.id,
          kind: node.kind,
          attribute: "style",
          code: found.code,
          severity: "error",
          message: found.message,
          fix: found.fix,
        });
      }
    }

    if (node.kind === "prism") {
      const pts = parseXyzList(attrs.points ?? "");
      if (pts.length < 3) {
        pushIssue(issues, {
          handle: node.handle,
          id: node.id,
          kind: node.kind,
          attribute: "points",
          code: "prism.too-few-points",
          severity: "error",
          message: "prism needs at least 3 XYZ triplets or it produces no mesh.",
          fix: "Provide at least 3 points. Reversing their order reverses the extrusion when normal is omitted.",
        });
      }
    }

    if (node.kind === "use") {
      const target = hrefTarget(attrs.href);
      if (!target || !groupIds.has(target)) {
        pushIssue(issues, {
          handle: node.handle,
          id: node.id,
          kind: node.kind,
          attribute: "href",
          code: "use.unknown-target",
          severity: "error",
          message: target
            ? `use href="#${target}" does not match a <g> under defs.`
            : "use is missing href.",
          fix: target ? "href=\"#groupId\" of an existing defs group." : "href=\"#groupId\"",
        });
      }
    }
  }

  for (const [name, decls] of Object.entries(rules)) {
    const ref = (decls["--material"] || decls.material || "").trim();
    if (!ref) continue;
    const found = materialReferenceIssue(content, ref);
    if (!found) continue;
    pushIssue(issues, {
      handle: `style:.${name}`,
      id: null,
      kind: "style",
      attribute: "--material",
      code: found.code,
      severity: "error",
      message: found.message,
      fix: found.fix,
    });
  }

  if (walked.truncated) {
    pushIssue(issues, {
      handle: "",
      id: null,
      kind: "document",
      attribute: "",
      code: "document.truncated",
      severity: "info",
      message: "Node walk stopped at the safety cap. Later nodes were not checked.",
      fix: "Split the document or inspect the remaining tree with list_nodes.",
    });
  }

  for (const issue of issues) {
    const repair = repairFor(issue);
    if (repair) issue.repair = repair;
  }
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const infoCount = issues.length - errorCount;
  const repairs = issues
    .filter((i) => i.severity === "error" && i.repair)
    .map((i) => i.repair!);
  return {
    issues,
    errorCount,
    infoCount,
    documentValid: errorCount === 0,
    repairs,
    handleLifetime: HANDLE_LIFETIME,
  };
}

/** Write an id onto every walked node that lacks one. Indexes do not move. */
export function assignMissingNodeIds(content: string): {
  content: string;
  assigned: { handle: string; id: string; kind: string }[];
} {
  const missing = walkAll(content, 5000).nodes.filter((n) => !n.id);
  const used = collectElementIds(content);
  let next = content;
  const assigned: { handle: string; id: string; kind: string }[] = [];
  for (const node of missing) {
    const id = allocateElementId(used, node.kind);
    const updated = applyAttrsAtPath(next, node.handle, { id });
    if (!updated) continue;
    next = updated;
    assigned.push({ handle: node.handle, id, kind: node.kind });
  }
  return { content: next, assigned };
}
