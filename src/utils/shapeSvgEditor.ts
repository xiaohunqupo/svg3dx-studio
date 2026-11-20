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

/** Minimal path bounds from M/L/H/V/Z (+ relative) — enough for section profiles. */
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
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };
  const re = /([MmLlHhVvZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let cmd = "M";
  let m: RegExpExecArray | null;
  const nums: number[] = [];
  const flush = () => {
    if (!nums.length) return;
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x = nums[i]!;
        y = nums[i + 1]!;
        touch(x, y);
      }
    } else if (cmd === "m" || cmd === "l") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        x += nums[i]!;
        y += nums[i + 1]!;
        touch(x, y);
      }
    } else if (cmd === "H") {
      for (const n of nums) {
        x = n;
        touch(x, y);
      }
    } else if (cmd === "h") {
      for (const n of nums) {
        x += n;
        touch(x, y);
      }
    } else if (cmd === "V") {
      for (const n of nums) {
        y = n;
        touch(x, y);
      }
    } else if (cmd === "v") {
      for (const n of nums) {
        y += n;
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
