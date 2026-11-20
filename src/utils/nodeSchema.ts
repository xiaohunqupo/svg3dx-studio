/**
 * Known geometry attributes (svg3dx draft §3.2, lowerCamelCase).
 * Used by the inspector to show empty fields for unset attrs.
 */

import { BLEND_VALUES } from "@/utils/blendSchematic";
import { DEFAULT_FILL_HEX8 } from "@/utils/fillColor";

export type AttrField = {
  name: string;
  /** Placeholder / default hint when unset. */
  placeholder?: string;
  /** Short help under the input (enum meaning, units, etc.). */
  description?: string;
  /** Fixed enum choices — inspector shows a select; values are XML identifiers. */
  enumValues?: readonly string[];
  /** Boolean attr — inspector shows a checkbox (`"true"` / `"false"`). */
  boolean?: boolean;
  /**
   * Only show this field when another attr’s current value is in `values`.
   * Empty / unset `name` is treated as `whenEmpty` (if provided).
   */
  visibleWhen?: {
    name: string;
    values: readonly string[];
    whenEmpty?: string;
  };
};

/** Common 3D transform on every geometry element. */
export const TRANSFORM_FIELDS: AttrField[] = [
  { name: "s3dx:transform", placeholder: "1 0 0 0 1 0 0 0 1 0 0 0" },
];

/**
 * Effective default `s3dx:transform` for a section under `revolve`
 * (XY → body XOZ). Keep in sync with viewer `REVOLVE_DEFAULT_SECTION_XF`.
 */
export const REVOLVE_SECTION_TRANSFORM_DISPLAY =
  "1 0 0 0 0 1 0 -1 0 0 0 0";

const MATRIX_WRAP_RE = /^matrix\s*\(\s*([\s\S]*?)\s*\)\s*$/i;

/** Inspector display: bare 12 numbers (strip `matrix(...)`). */
export function transformToDisplay(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m = MATRIX_WRAP_RE.exec(s);
  return (m ? m[1]! : s).trim().replace(/\s+/g, " ");
}

/** Persist form: `matrix(…)`; empty input → empty (attr removed). */
export function transformToAttr(display: string): string {
  const inner = transformToDisplay(display);
  if (!inner) return "";
  return `matrix(${inner})`;
}

/**
 * Persist a numeric 12-vector as `s3dx:transform`.
 * Identity / empty → `""` so the attribute is removed.
 */
export function matrix12ToTransformAttr(m: number[]): string {
  if (m.length !== 12) return "";
  const display = m.map(formatTransformNum).join(" ");
  if (isIdentityTransformDisplay(display)) return "";
  return transformToAttr(display);
}

/** THREE.Matrix4 (column-major) → svg3dx Mat4x3 12-vector. */
export function matrix4ToMat4x3(matrix: {
  elements: ArrayLike<number>;
}): number[] {
  const e = matrix.elements;
  return [
    e[0]!,
    e[1]!,
    e[2]!,
    e[4]!,
    e[5]!,
    e[6]!,
    e[8]!,
    e[9]!,
    e[10]!,
    e[12]!,
    e[13]!,
    e[14]!,
  ];
}

/** Column-vector axes + translation (matches core `Mat4x3`). */
export type TransformParts = {
  xdir: string;
  ydir: string;
  zdir: string;
  /** Last column — SVG/CSS “translate” / spec `tx ty tz`. */
  translation: string;
};

/** Display order matches matrix layout: X, Y, Z, then translation. */
export const TRANSFORM_PART_KEYS = [
  "xdir",
  "ydir",
  "zdir",
  "translation",
] as const;

export type TransformPartKey = (typeof TRANSFORM_PART_KEYS)[number];

const IDENTITY_12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Bare 12-number identity (inspector display). */
export const IDENTITY_TRANSFORM_DISPLAY = "1 0 0 0 1 0 0 0 1 0 0 0";

export function transformPartPlaceholder(key: TransformPartKey): string {
  const id = identityTransformParts();
  return id[key];
}

/**
 * Split a space/comma-separated vector, respecting parentheses so spaces
 * inside `calc(...)` / `var(...)` do not create extra components.
 */
export function splitVecTokens(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  const out: string[] = [];
  let buf = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "(") {
      depth += 1;
      buf += c;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      buf += c;
      continue;
    }
    if (
      depth === 0 &&
      (c === " " || c === "\t" || c === "\n" || c === "\r" || c === ",")
    ) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/** Keep at most `maxComponents` vector tokens (drop extras). */
export function clampVecTokens(raw: string, maxComponents: number): string {
  const toks = splitVecTokens(raw);
  if (!toks.length) return "";
  if (maxComponents <= 0 || toks.length <= maxComponents) {
    return toks.join(" ");
  }
  return toks.slice(0, maxComponents).join(" ");
}

/**
 * Whether text looks like one or more XYZ triplets (points / vectors / matrices).
 * Used to enable the vector inspector control.
 */
export function looksLikeVecRgbText(raw: string): boolean {
  const nums = splitVecTokens(raw);
  return nums.length >= 3 && nums.length % 3 === 0;
}

/** True if display is empty or numerically identity. */
export function isIdentityTransformDisplay(raw: string): boolean {
  const s = transformToDisplay(raw);
  if (!s) return true;
  const m = parseTransform12(s);
  if (!m) return false;
  return m.every((n, i) => Math.abs(n - IDENTITY_12[i]!) < 1e-9);
}

function formatTransformNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const t = Math.round(n * 1e6) / 1e6;
  if (Number.isInteger(t)) return String(t);
  return String(t)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.$/, "");
}

function formatVec3(a: number, b: number, c: number): string {
  return `${formatTransformNum(a)} ${formatTransformNum(b)} ${formatTransformNum(c)}`;
}

/** Parse display/attr text into 12 numbers, or null if not a plain numeric matrix. */
export function parseTransform12(raw: string): number[] | null {
  const inner = transformToDisplay(raw);
  if (!inner) return null;
  const toks = splitVecTokens(inner);
  if (toks.length !== 12) return null;
  const nums = toks.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

export function identityTransformParts(): TransformParts {
  return transformPartsFrom12(IDENTITY_12);
}

/** Empty part editors — defaults appear only as placeholders. */
export function emptyTransformParts(): TransformParts {
  return { xdir: "", ydir: "", zdir: "", translation: "" };
}

export function transformPartsFrom12(m: number[]): TransformParts {
  return {
    xdir: formatVec3(m[0]!, m[1]!, m[2]!),
    ydir: formatVec3(m[3]!, m[4]!, m[5]!),
    zdir: formatVec3(m[6]!, m[7]!, m[8]!),
    translation: formatVec3(m[9]!, m[10]!, m[11]!),
  };
}

export function parseVec3(raw: string): [number, number, number] | null {
  const toks = splitVecTokens(raw);
  if (toks.length !== 3) return null;
  const nums = toks.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!];
}

/** Three expression-capable components, or null. */
export function parseVec3Components(raw: string): [string, string, string] | null {
  const toks = splitVecTokens(raw);
  if (toks.length !== 3) return null;
  return [toks[0]!, toks[1]!, toks[2]!];
}

/** Twelve expression-capable matrix tokens, or null. */
export function parseTransform12Components(raw: string): string[] | null {
  const inner = transformToDisplay(raw);
  if (!inner) return null;
  const toks = splitVecTokens(inner);
  return toks.length === 12 ? toks : null;
}

function vec3Equals(
  a: [number, number, number],
  b: [number, number, number]
): boolean {
  return (
    Math.abs(a[0] - b[0]) < 1e-9 &&
    Math.abs(a[1] - b[1]) < 1e-9 &&
    Math.abs(a[2] - b[2]) < 1e-9
  );
}

/** True when `value` is numerically (or textually) the same as the default vec. */
export function vecEqualsDefault(value: string, identity: string): boolean {
  const v = (value ?? "").trim();
  const id = (identity ?? "").trim();
  if (!v) return true;
  if (!id) return false;
  const vn = parseVec3(v);
  const i = parseVec3(id);
  if (vn && i) return vec3Equals(vn, i);
  return clampVecTokens(v, 3) === clampVecTokens(id, 3);
}

/** Identity / default → "" so the editor shows placeholder (not a sticky value). */
export function blankIfIdentityVec(value: string, identity: string): string {
  return vecEqualsDefault(value, identity) ? "" : (value ?? "").trim();
}

/** Blank parts resolve to identity so compose / commit stay valid. */
export function transformPartsWithDefaults(parts: TransformParts): TransformParts {
  const id = identityTransformParts();
  return {
    xdir: (parts.xdir ?? "").trim() || id.xdir,
    ydir: (parts.ydir ?? "").trim() || id.ydir,
    zdir: (parts.zdir ?? "").trim() || id.zdir,
    translation: (parts.translation ?? "").trim() || id.translation,
  };
}

/** Build bare 12-token display from parts; null if any part is not 3 components. */
export function transformDisplayFromParts(parts: TransformParts): string | null {
  return transformDisplayFromPartsResolved(transformPartsWithDefaults(parts));
}

function transformDisplayFromPartsResolved(
  parts: TransformParts
): string | null {
  const axes = [parts.xdir, parts.ydir, parts.zdir, parts.translation] as const;
  const all: string[] = [];
  for (const axis of axes) {
    const toks = parseVec3Components(axis);
    if (!toks) return null;
    all.push(...toks);
  }
  const nums = all.map(Number);
  if (nums.every((n) => Number.isFinite(n))) {
    return nums.map(formatTransformNum).join(" ");
  }
  return all.join(" ");
}

/**
 * Sync editors from compact display. Identity / unset → empty strings so
 * placeholders show defaults (not "has value"). Same for expression matrices
 * when a part is numerically the identity default.
 */
export function syncTransformPartsFromDisplay(raw: string): TransformParts {
  if (isIdentityTransformDisplay(raw)) return emptyTransformParts();

  const id = identityTransformParts();
  const blankParts = (parts: TransformParts): TransformParts => ({
    xdir: blankIfIdentityVec(parts.xdir, id.xdir),
    ydir: blankIfIdentityVec(parts.ydir, id.ydir),
    zdir: blankIfIdentityVec(parts.zdir, id.zdir),
    translation: blankIfIdentityVec(parts.translation, id.translation),
  });

  const m = parseTransform12(raw);
  if (m) return blankParts(transformPartsFrom12(m));

  const toks = parseTransform12Components(raw);
  if (!toks) return emptyTransformParts();
  return blankParts({
    xdir: toks.slice(0, 3).join(" "),
    ydir: toks.slice(3, 6).join(" "),
    zdir: toks.slice(6, 9).join(" "),
    translation: toks.slice(9, 12).join(" "),
  });
}

/**
 * Appearance attrs (draft §8): fill × material × opacity.
 * Shown for primitives / groups / bool containers — not geometric params.
 */
export const APPEARANCE_FIELDS: AttrField[] = [
  // HEX8 placeholder / swatch hint; XML store form is DEFAULT_FILL_RGBA.
  { name: "fill", placeholder: DEFAULT_FILL_HEX8 },
  /** Placeholder is localized via `materialLabel('default')` in the inspector. */
  { name: "material" },
  { name: "opacity", placeholder: "1" },
];

export const APPEARANCE_ATTR_NAMES = new Set(
  APPEARANCE_FIELDS.map((f) => f.name.toLowerCase())
);

const PRIMITIVE_ATTRS: Record<string, AttrField[]> = {
  box: [
    { name: "length", placeholder: "100" },
    { name: "width", placeholder: "100" },
    { name: "height", placeholder: "100" },
    { name: "lengthVec", placeholder: "1 0 0" },
    { name: "widthVec", placeholder: "0 1 0" },
  ],
  cylinder: [
    { name: "diameter", placeholder: "100" },
    { name: "bottomCenterPt", placeholder: "0 0 0" },
    { name: "topCenterPt", placeholder: "0 0 100" },
  ],
  sphere: [
    { name: "radius", placeholder: "50" },
    { name: "center", placeholder: "0 0 0" },
  ],
  cone: [
    { name: "bottomDiameter", placeholder: "100" },
    { name: "topDiameter", placeholder: "40" },
    { name: "bottomCenterPt", placeholder: "0 0 0" },
    { name: "topCenterPt", placeholder: "0 0 100" },
  ],
  torus: [
    { name: "diameter1", placeholder: "100" },
    { name: "diameter2", placeholder: "25" },
    { name: "angle", placeholder: "360" },
    { name: "torusCenterPt", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
  ],
  wedge: [
    { name: "length", placeholder: "100" },
    { name: "width", placeholder: "100" },
    { name: "height", placeholder: "100" },
    { name: "lengthVec", placeholder: "1 0 0" },
    { name: "widthVec", placeholder: "0 1 0" },
    { name: "topLength", placeholder: "0" },
  ],
  pyramid: [
    { name: "length", placeholder: "100" },
    { name: "width", placeholder: "100" },
    { name: "height", placeholder: "100" },
    { name: "lengthVec", placeholder: "1 0 0" },
    { name: "widthVec", placeholder: "0 1 0" },
    { name: "topLength", placeholder: "0" },
    { name: "topWidth" },
  ],
  prism: [
    { name: "points", placeholder: "0 0 0  100 0 0  100 100 0  0 100 0" },
    { name: "height", placeholder: "100" },
    { name: "normal" },
  ],
  "sector-cylinder": [
    { name: "diameter", placeholder: "100" },
    { name: "bottomCenterPt", placeholder: "0 0 0" },
    { name: "topCenterPt", placeholder: "0 0 100" },
    { name: "angle", placeholder: "90" },
  ],
  line: [
    { name: "from", placeholder: "0 0 0" },
    { name: "to", placeholder: "100 0 0" },
  ],
  arc: [
    {
      name: "form",
      placeholder: "angles",
      enumValues: ["angles", "ends"],
    },
    { name: "center", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
    { name: "radius", placeholder: "100" },
    {
      name: "xDir",
      placeholder: "1 0 0",
      visibleWhen: {
        name: "form",
        values: ["angles"],
        whenEmpty: "angles",
      },
    },
    {
      name: "startAngle",
      placeholder: "0",
      visibleWhen: {
        name: "form",
        values: ["angles"],
        whenEmpty: "angles",
      },
    },
    {
      name: "angle",
      placeholder: "90",
      visibleWhen: {
        name: "form",
        values: ["angles"],
        whenEmpty: "angles",
      },
    },
    {
      name: "from",
      placeholder: "0 0 0",
      visibleWhen: {
        name: "form",
        values: ["ends"],
        whenEmpty: "angles",
      },
    },
    {
      name: "to",
      placeholder: "100 0 0",
      visibleWhen: {
        name: "form",
        values: ["ends"],
        whenEmpty: "angles",
      },
    },
  ],
  path: [
    {
      name: "form",
      placeholder: "segments",
      enumValues: ["polyline", "segments"],
    },
    {
      name: "points",
      placeholder: "0 0 0  100 0 0  100 0 100",
      visibleWhen: {
        name: "form",
        values: ["polyline"],
        whenEmpty: "segments",
      },
    },
  ],
  extrude: [
    { name: "origin", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
    { name: "xDir", placeholder: "1 0 0" },
    { name: "dir", placeholder: "0 0 1" },
    { name: "length", placeholder: "100" },
  ],
  revolve: [
    { name: "angle", placeholder: "360" },
    { name: "solid", placeholder: "true", boolean: true },
  ],
  section: [
    { name: "origin", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
    { name: "xDir", placeholder: "1 0 0" },
  ],
  loft: [
    { name: "solid", placeholder: "true", boolean: true },
    {
      name: "blend",
      placeholder: "linear",
      enumValues: BLEND_VALUES,
    },
  ],
  sweep: [
    {
      name: "orient",
      placeholder: "frenet",
      enumValues: ["frenet", "fixed", "parallel"],
    },
    {
      name: "refDir",
      placeholder: "0 0 1",
      visibleWhen: {
        name: "orient",
        values: ["fixed", "parallel"],
        whenEmpty: "frenet",
      },
    },
    { name: "solid", placeholder: "true", boolean: true },
    {
      name: "outerCorner",
      placeholder: "round",
      enumValues: ["round", "bevel", "miter"],
    },
    {
      name: "outerCornerRadius",
      placeholder: "50",
      visibleWhen: {
        name: "outerCorner",
        values: ["round"],
        whenEmpty: "round",
      },
    },
    {
      name: "innerCorner",
      placeholder: "round",
      enumValues: ["round", "bevel", "miter"],
    },
    {
      name: "innerCornerRadius",
      placeholder: "50",
      visibleWhen: {
        name: "innerCorner",
        values: ["round"],
        whenEmpty: "round",
      },
    },
    { name: "miterLimit", placeholder: "4" },
  ],
  pipe: [
    {
      name: "form",
      placeholder: "child",
      enumValues: ["inline", "child"],
    },
    { name: "radius", placeholder: "20" },
    { name: "innerRadius", placeholder: "16" },
    {
      name: "outerCorner",
      placeholder: "round",
      enumValues: ["round", "bevel", "miter"],
    },
    {
      name: "outerCornerRadius",
      placeholder: "50",
      visibleWhen: {
        name: "outerCorner",
        values: ["round"],
        whenEmpty: "round",
      },
    },
    {
      name: "innerCorner",
      placeholder: "round",
      enumValues: ["round", "bevel", "miter"],
    },
    {
      name: "innerCornerRadius",
      placeholder: "50",
      visibleWhen: {
        name: "innerCorner",
        values: ["round"],
        whenEmpty: "round",
      },
    },
    { name: "miterLimit", placeholder: "4" },
    {
      name: "path",
      placeholder: "0 0 0  100 0 0  100 0 100",
      visibleWhen: {
        name: "form",
        values: ["inline"],
        whenEmpty: "child",
      },
    },
  ],
};

export const GROUP_BASIC_FIELDS: AttrField[] = [
  { name: "id" },
  { name: "class" },
];

/** `<s3dx:model mode>` values (draft §7.1 + studio `lite-solid`). */
export const MODEL_MODE_VALUES = [
  "solid",
  "wireframe",
  "hidden-line",
  "lite-solid",
] as const;

/** Optional boolean attrs written as `"true"` / `"false"`. */
export const BOOL_ATTR_VALUES = ["true", "false"] as const;

export function primitiveAttrFields(kind: string): AttrField[] {
  return PRIMITIVE_ATTRS[kind] ?? [];
}

/** Look up a param value with case-insensitive key match. */
export function paramValue(
  params: Record<string, unknown> | undefined,
  name: string
): string {
  if (!params) return "";
  if (name in params) return formatUnknown(params[name]);
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(params)) {
    if (k.toLowerCase() === lower) return formatUnknown(v);
  }
  return "";
}

function formatUnknown(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "number" || typeof x === "boolean" || typeof x === "string"
          ? String(x)
          : JSON.stringify(x)
      )
      .join(" ");
  }
  return JSON.stringify(v);
}

export function formatTransformMatrix(m: number[] | undefined): string {
  if (!m?.length) return "";
  return m.map((n) => String(n)).join(" ");
}
