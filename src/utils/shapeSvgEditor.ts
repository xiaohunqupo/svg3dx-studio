import { isSectionPath, parentTreePath } from "@/interact/sectionProxy";
import {
  findRangeForTreePath,
  localTagName,
  nodeKindAtPath,
} from "@/utils/nodeXmlEdit";

/** 2D leaves under `<s3dx:section>` that the SVG canvas can edit. */
export const SECTION_SHAPE_EDIT_TAGS = new Set([
  "path",
  "circle",
  "ellipse",
  "rect",
  "polygon",
  "polyline",
]);

const GEOM_ATTRS: Record<string, string[]> = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  polygon: ["points"],
  polyline: ["points"],
};

export function geomAttrsForTag(tag: string): string[] {
  return GEOM_ATTRS[tag] ?? [];
}

export type SectionShapeDraft = {
  /** Stable id within the dialog session. */
  id: string;
  tag: string;
  /** Full element markup (`<path …/>` etc.). */
  xml: string;
};

/** True when the tree path points at an `<s3dx:section>`. */
export function isSectionEditable(
  content: string,
  path: string
): boolean {
  return isSectionPath(content, path);
}

/** Inspector field that hosts the pen-tool button for this shape kind. */
export function shapeEditorTriggerAttr(kind: string): string | null {
  const names = GEOM_ATTRS[kind];
  return names?.[0] ?? null;
}

const CANVAS_W = 640;
const CANVAS_H = 480;
const VIEW_PAD = 24;

export function isSectionShapeEditable(
  content: string,
  path: string
): boolean {
  const kind = nodeKindAtPath(content, path)?.kind;
  if (!kind || !SECTION_SHAPE_EDIT_TAGS.has(kind)) return false;
  const parent = parentTreePath(path);
  return !!parent && isSectionPath(content, parent);
}

export function readElementXmlAtPath(
  content: string,
  path: string
): string | null {
  const range = findRangeForTreePath(content, path);
  if (!range) return null;
  return content.slice(range.start, range.end).trim();
}

/** Wrap a single shape element in a standalone SVG for SvgCanvas. */
export function wrapShapeInSvg(elementXml: string): string {
  const viewBox = estimateViewBox(elementXml);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="${viewBox}">\n  ${elementXml}\n</svg>`;
}

/** Wrap multiple section shapes for the profile editor canvas. */
export function wrapShapesInSvg(
  shapesXml: string[],
  dims?: [number, number]
): string {
  const [w, h] = dims ?? [CANVAS_W, CANVAS_H];
  const joined = shapesXml.join("\n  ");
  const viewBox = estimateViewBox(joined || '<rect x="0" y="0" width="100" height="100"/>');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">\n  ${joined}\n</svg>`;
}

/** Read the full `<s3dx:section>…</s3dx:section>` element at path. */
export function readSectionElementXml(
  content: string,
  path: string
): string | null {
  if (!isSectionPath(content, path)) return null;
  return readElementXmlAtPath(content, path);
}

/** Parse direct 2D shape children out of a section element string. */
export function parseSectionShapeDrafts(sectionXml: string): SectionShapeDraft[] {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:s3dx="https://svg3dx.org/ns">${sectionXml}</svg>`,
    "image/svg+xml"
  );
  if (doc.querySelector("parsererror")) return [];
  let section: Element | null = null;
  for (const child of Array.from(doc.documentElement.children)) {
    if (localTagName(child.tagName) === "section") {
      section = child;
      break;
    }
  }
  if (!section) section = doc.documentElement.firstElementChild;
  if (!section) return [];
  const out: SectionShapeDraft[] = [];
  let i = 0;
  for (const child of Array.from(section.children)) {
    const tag = localTagName(child.tagName);
    if (!SECTION_SHAPE_EDIT_TAGS.has(tag)) continue;
    out.push({
      id: `shape-${i++}`,
      tag,
      xml: serializeElement(child),
    });
  }
  return out;
}

/** Serialize drafts back to indented child markup for `replaceChildrenAtPath`. */
export function serializeSectionShapeDrafts(
  drafts: SectionShapeDraft[]
): string {
  return drafts.map((d) => d.xml.trim()).join("\n");
}

/**
 * Pull editable shape elements from an SvgCanvas SVG string (document order).
 * Keeps only supported section tags; drops canvas chrome.
 */
export function extractShapesFromSvg(svgString: string): SectionShapeDraft[] {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  if (doc.querySelector("parsererror")) return [];
  const root = doc.documentElement;
  if (!root || localTagName(root.tagName) !== "svg") return [];
  const out: SectionShapeDraft[] = [];
  let i = 0;
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = localTagName(child.tagName);
      if (tag === "defs" || tag === "title" || tag === "desc") continue;
      if (SECTION_SHAPE_EDIT_TAGS.has(tag)) {
        out.push({
          id: `shape-${i++}`,
          tag,
          xml: serializeElement(child),
        });
        continue;
      }
      if (tag === "g") walk(child);
    }
  };
  walk(root);
  return out;
}

export function parseElementAttrs(elementXml: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${elementXml}</svg>`,
    "image/svg+xml"
  );
  const el = doc.documentElement?.firstElementChild;
  if (!el) return {};
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    out[attr.name] = attr.value;
  }
  return out;
}

/** Rebuild a shape element from tag + attrs (self-closing). */
export function buildShapeXml(
  tag: string,
  attrs: Record<string, string>
): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (!value.trim() && name !== "d" && name !== "points") continue;
    parts.push(`${name}="${escapeAttr(value)}"`);
  }
  const attrText = parts.length ? ` ${parts.join(" ")}` : "";
  return `<${tag}${attrText}/>`;
}

/** Presentation attrs used only for the profile canvas — not persisted. */
const PROFILE_PRESENTATION_ATTRS = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "style",
  "class",
]);

function serializeElement(el: Element): string {
  const tag = localTagName(el.tagName);
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    // Drop svgcanvas bookkeeping attrs / generated ids.
    if (attr.name.startsWith("data-")) continue;
    if (attr.name === "id" && /^svg_\d+/.test(attr.value)) continue;
    // Contour editor paints stroke/fill for preview only.
    if (PROFILE_PRESENTATION_ATTRS.has(attr.name)) continue;
    parts.push(`${attr.name}="${escapeAttr(attr.value)}"`);
  }
  const attrText = parts.length ? ` ${parts.join(" ")}` : "";
  return `<${tag}${attrText}/>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export function canvasDimensions(): [number, number] {
  return [CANVAS_W, CANVAS_H];
}

/**
 * Pull geometry attrs from the edited SVG back onto the original tag.
 * Prefers an element with the same local name; otherwise the first editable shape.
 */
export function extractShapeAttrUpdates(
  svgString: string,
  originalKind: string
): Record<string, string> | null {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const root = doc.documentElement;
  if (!root || localTagName(root.tagName) !== "svg") return null;

  const want = originalKind.toLowerCase();
  let el: Element | null = null;
  for (const child of Array.from(root.querySelectorAll("*"))) {
    const local = localTagName(child.tagName);
    if (local === want) {
      el = child;
      break;
    }
  }
  if (!el) {
    for (const child of Array.from(root.children)) {
      const local = localTagName(child.tagName);
      if (SECTION_SHAPE_EDIT_TAGS.has(local)) {
        el = child;
        break;
      }
    }
  }
  if (!el) return null;

  const kind = localTagName(el.tagName);
  const names = GEOM_ATTRS[kind] ?? [];
  if (!names.length) return null;
  const updates: Record<string, string> = {};
  for (const name of names) {
    // Empty string clears optional attrs removed in the editor (e.g. rect rx).
    updates[name] = el.getAttribute(name) ?? "";
  }
  return updates;
}

function estimateViewBox(elementXml: string): string {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${elementXml}</svg>`,
    "image/svg+xml"
  );
  const el = doc.documentElement?.firstElementChild;
  if (!el) return `0 0 ${CANVAS_W} ${CANVAS_H}`;

  const local = localTagName(el.tagName);
  let minX = 0;
  let minY = 0;
  let maxX = 100;
  let maxY = 100;

  if (local === "path") {
    const box = boundsFromPathD(el.getAttribute("d") ?? "");
    if (box) ({ minX, minY, maxX, maxY } = box);
  } else if (local === "circle") {
    const cx = num(el.getAttribute("cx"));
    const cy = num(el.getAttribute("cy"));
    const r = Math.max(num(el.getAttribute("r"), 1), 1);
    minX = cx - r;
    minY = cy - r;
    maxX = cx + r;
    maxY = cy + r;
  } else if (local === "ellipse") {
    const cx = num(el.getAttribute("cx"));
    const cy = num(el.getAttribute("cy"));
    const rx = Math.max(num(el.getAttribute("rx"), 1), 1);
    const ry = Math.max(num(el.getAttribute("ry"), rx), 1);
    minX = cx - rx;
    minY = cy - ry;
    maxX = cx + rx;
    maxY = cy + ry;
  } else if (local === "rect") {
    const x = num(el.getAttribute("x"));
    const y = num(el.getAttribute("y"));
    const w = Math.max(num(el.getAttribute("width"), 1), 1);
    const h = Math.max(num(el.getAttribute("height"), 1), 1);
    minX = x;
    minY = y;
    maxX = x + w;
    maxY = y + h;
  } else if (local === "polygon" || local === "polyline") {
    const box = boundsFromPoints(el.getAttribute("points") ?? "");
    if (box) ({ minX, minY, maxX, maxY } = box);
  }

  const pad = VIEW_PAD;
  const w = Math.max(maxX - minX, 1) + pad * 2;
  const h = Math.max(maxY - minY, 1) + pad * 2;
  return `${minX - pad} ${minY - pad} ${w} ${h}`;
}

function num(raw: string | null, fallback = 0): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boundsFromPoints(
  points: string
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const nums = points
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i]!;
    const y = nums[i + 1]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Approximate path bounds from endpoints / control points (M/L/H/V/C/S/Q/T/A/Z).
 * Good enough for editor viewBox padding — not a tight curve AABB.
 */
function boundsFromPathD(
  d: string
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!d.trim()) return null;
  let x = 0;
  let y = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const touch = (px: number, py: number) => {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  const re =
    /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let cmd = "M";
  let m: RegExpExecArray | null;
  const nums: number[] = [];
  const flush = () => {
    if (!nums.length && cmd.toUpperCase() !== "Z") return;
    const upper = cmd.toUpperCase();
    const rel = cmd === cmd.toLowerCase() && upper !== "Z";
    if (upper === "M" || upper === "L" || upper === "T") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x = rel ? x + nums[i]! : nums[i]!;
        y = rel ? y + nums[i + 1]! : nums[i + 1]!;
        touch(x, y);
      }
    } else if (upper === "H") {
      for (const n of nums) {
        x = rel ? x + n : n;
        touch(x, y);
      }
    } else if (upper === "V") {
      for (const n of nums) {
        y = rel ? y + n : n;
        touch(x, y);
      }
    } else if (upper === "C") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const x1 = rel ? x + nums[i]! : nums[i]!;
        const y1 = rel ? y + nums[i + 1]! : nums[i + 1]!;
        const x2 = rel ? x + nums[i + 2]! : nums[i + 2]!;
        const y2 = rel ? y + nums[i + 3]! : nums[i + 3]!;
        const nx = rel ? x + nums[i + 4]! : nums[i + 4]!;
        const ny = rel ? y + nums[i + 5]! : nums[i + 5]!;
        touch(x1, y1);
        touch(x2, y2);
        x = nx;
        y = ny;
        touch(x, y);
      }
    } else if (upper === "S" || upper === "Q") {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const x1 = rel ? x + nums[i]! : nums[i]!;
        const y1 = rel ? y + nums[i + 1]! : nums[i + 1]!;
        const nx = rel ? x + nums[i + 2]! : nums[i + 2]!;
        const ny = rel ? y + nums[i + 3]! : nums[i + 3]!;
        touch(x1, y1);
        x = nx;
        y = ny;
        touch(x, y);
      }
    } else if (upper === "A") {
      for (let i = 0; i + 6 < nums.length; i += 7) {
        const nx = rel ? x + nums[i + 5]! : nums[i + 5]!;
        const ny = rel ? y + nums[i + 6]! : nums[i + 6]!;
        x = nx;
        y = ny;
        touch(x, y);
      }
    }
    nums.length = 0;
  };
  while ((m = re.exec(d))) {
    if (m[1]) {
      flush();
      cmd = m[1];
    } else if (m[2]) {
      nums.push(Number(m[2]));
    }
  }
  flush();
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}
