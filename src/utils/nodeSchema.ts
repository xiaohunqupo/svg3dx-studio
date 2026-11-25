/**
 * Known geometry attributes (svg3dx draft §3.2, lowerCamelCase).
 * Used by the inspector to show empty fields for unset attrs.
 */

import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { BLEND_VALUES } from "@/utils/blendSchematic";
import { DEFAULT_FILL_HEX8 } from "@/utils/fillColor";

export type AttrField = {
  name: string;
  /**
   * Optional ATTR_LABELS key for the inspector title when it should differ
   * from `name` (e.g. animation `fill` → `animFill`).
   */
  labelKey?: string;
  /** Placeholder / default hint when unset. */
  placeholder?: string;
  /** Short help under the input (enum meaning, units, etc.). */
  description?: string;
  /** Fixed enum choices — inspector shows a select; values are XML identifiers. */
  enumValues?: readonly string[];
  /** Boolean attr — inspector shows a checkbox (`"true"` / `"false"`). */
  boolean?: boolean;
  /**
   * Point-typed attr: literals / var / calc, or live `ref(#id)` to an
   * `<s3dx:point>` (draft 0.2). Inspector offers a point picker.
   */
  pointAttr?: boolean;
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

/** Persistent `s3dx:transform` syntax (self-describing). */
export type TransformForm = "matrix" | "trs";

/** Detect matrix vs TRS from attribute / draft text. Empty → matrix. */
export function detectTransformForm(raw: string): TransformForm {
  const s = raw.trim();
  if (!s) return "matrix";
  const lower = s.toLowerCase();
  const hasMatrix = lower.includes("matrix(");
  const hasTrs =
    lower.includes("translate(") ||
    lower.includes("rotate(") ||
    lower.includes("scale(");
  if (hasMatrix && hasTrs) {
    const first = firstTransformKeyword(lower);
    if (first && first !== "matrix") return "trs";
    return "matrix";
  }
  if (hasTrs) return "trs";
  return "matrix";
}

function firstTransformKeyword(
  lower: string
): "matrix" | "translate" | "rotate" | "scale" | null {
  const pats: Array<["matrix" | "translate" | "rotate" | "scale", string]> = [
    ["matrix", "matrix("],
    ["translate", "translate("],
    ["rotate", "rotate("],
    ["scale", "scale("],
  ];
  let best: { i: number; name: "matrix" | "translate" | "rotate" | "scale" } | null =
    null;
  for (const [name, pat] of pats) {
    const i = lower.indexOf(pat);
    if (i < 0) continue;
    if (!best || i < best.i) best = { i, name };
  }
  return best?.name ?? null;
}

/** Inspector display: bare 12 for matrix; TRS functions kept as-is. */
export function transformToDisplay(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  if (detectTransformForm(s) === "trs") {
    return s.replace(/\s+/g, " ").trim();
  }
  const m = MATRIX_WRAP_RE.exec(s);
  return (m ? m[1]! : s).trim().replace(/\s+/g, " ");
}

/** Persist: `matrix(…)` or TRS function list; empty → attr removed. */
export function transformToAttr(display: string): string {
  const s = display.trim();
  if (!s) return "";
  if (detectTransformForm(s) === "trs") {
    if (isIdentityTransformDisplay(s)) return "";
    return normalizeTrsAttr(s);
  }
  const inner = transformToDisplay(s);
  if (!inner) return "";
  if (isIdentityTransformDisplay(inner)) return "";
  return `matrix(${inner})`;
}

/**
 * Persist a numeric 12-vector as `s3dx:transform`.
 * Identity / empty → `""` so the attribute is removed.
 * `form` selects matrix vs TRS serialization (gizmo respects document form).
 */
export function matrix12ToTransformAttr(
  m: number[],
  form: TransformForm = "matrix"
): string {
  if (m.length !== 12) return "";
  if (form === "trs") {
    const trs = decomposeMatrix12ToTrs(m);
    const display = formatTrsDisplay(trs);
    if (isIdentityTransformDisplay(display)) return "";
    return display;
  }
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

/**
 * Inspector expand order: translation first (aligned with TRS), then axes.
 * Matrix serialize order remains xdir·ydir·zdir·translation (see compose).
 */
export const TRANSFORM_PART_KEYS = [
  "translation",
  "xdir",
  "ydir",
  "zdir",
] as const;

export type TransformPartKey = (typeof TRANSFORM_PART_KEYS)[number];

/** TRS editor channels (degrees for rotate). */
export type TransformTrs = {
  translate: string;
  rotate: string;
  scale: string;
};

export const TRANSFORM_TRS_KEYS = [
  "translate",
  "rotate",
  "scale",
] as const;

export type TransformTrsKey = (typeof TRANSFORM_TRS_KEYS)[number];

const IDENTITY_12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** Bare 12-number identity (inspector display for matrix form). */
export const IDENTITY_TRANSFORM_DISPLAY = "1 0 0 0 1 0 0 0 1 0 0 0";

const IDENTITY_TRS: TransformTrs = {
  translate: "0 0 0",
  rotate: "0 0 0",
  scale: "1 1 1",
};

export function transformPartPlaceholder(key: TransformPartKey): string {
  const id = identityTransformParts();
  return id[key];
}

export function transformTrsPlaceholder(key: TransformTrsKey): string {
  return IDENTITY_TRS[key];
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

/** True if display is empty or numerically identity (matrix or TRS). */
export function isIdentityTransformDisplay(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  if (detectTransformForm(s) === "trs") {
    const trs = parseTransformTrs(s);
    if (!trs) return false;
    const nums = resolveTrsNumbers(trs);
    if (!nums) return false;
    const m = composeTrsToMatrix12(nums);
    return m.every((n, i) => Math.abs(n - IDENTITY_12[i]!) < 1e-9);
  }
  const display = transformToDisplay(s);
  if (!display) return true;
  const m = parseTransform12(display);
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
  if (detectTransformForm(raw) === "trs") return emptyTransformParts();
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

export function emptyTransformTrs(): TransformTrs {
  return { translate: "", rotate: "", scale: "" };
}

export function identityTransformTrs(): TransformTrs {
  return { ...IDENTITY_TRS };
}

/** Parse TRS function list into channel strings (expressions preserved). */
export function parseTransformTrs(raw: string): TransformTrs | null {
  const s = raw.trim();
  if (!s || detectTransformForm(s) !== "trs") return null;
  const funcs = iterTransformFuncs(s);
  if (!funcs) return null;
  const out: TransformTrs = {
    translate: "",
    rotate: "",
    scale: "",
  };
  for (const { name, args } of funcs) {
    if (name === "matrix") return null;
    if (name === "translate" || name === "rotate" || name === "scale") {
      out[name] = args.trim().replace(/\s+/g, " ");
    }
  }
  return out;
}

export function syncTransformTrsFromDisplay(raw: string): TransformTrs {
  if (!raw.trim() || isIdentityTransformDisplay(raw)) {
    return emptyTransformTrs();
  }
  if (detectTransformForm(raw) === "matrix") {
    const m = parseTransform12(transformToDisplay(raw));
    if (!m) return emptyTransformTrs();
    const trs = decomposeMatrix12ToTrs(m);
    return blankTrsIfIdentity(formatTrsChannels(trs));
  }
  const parsed = parseTransformTrs(raw);
  if (!parsed) return emptyTransformTrs();
  return blankTrsIfIdentity(transformTrsWithDefaults(parsed));
}

function blankTrsIfIdentity(trs: TransformTrs): TransformTrs {
  return {
    translate: blankIfIdentityVec(trs.translate, IDENTITY_TRS.translate),
    rotate: blankIfIdentityVec(trs.rotate, IDENTITY_TRS.rotate),
    scale: blankIfIdentityVec(trs.scale, IDENTITY_TRS.scale),
  };
}

/** Blank channels resolve to identity defaults for compose / commit. */
export function transformTrsWithDefaults(trs: TransformTrs): TransformTrs {
  return {
    translate: (trs.translate ?? "").trim() || IDENTITY_TRS.translate,
    rotate: (trs.rotate ?? "").trim() || IDENTITY_TRS.rotate,
    scale: (trs.scale ?? "").trim() || IDENTITY_TRS.scale,
  };
}

function formatTrsChannels(n: {
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: [number, number, number];
}): TransformTrs {
  return {
    translate: formatVec3(n.translate[0], n.translate[1], n.translate[2]),
    rotate: formatVec3(n.rotate[0], n.rotate[1], n.rotate[2]),
    scale: formatVec3(n.scale[0], n.scale[1], n.scale[2]),
  };
}

/** Build TRS attr display; omit identity channels. null if a channel is invalid. */
export function transformDisplayFromTrs(trs: TransformTrs): string | null {
  const resolved = transformTrsWithDefaults(trs);
  for (const key of TRANSFORM_TRS_KEYS) {
    if (!parseVec3Components(resolved[key])) return null;
  }
  return formatTrsDisplayFromChannels(resolved);
}

function formatTrsDisplayFromChannels(trs: TransformTrs): string {
  const parts: string[] = [];
  if (!vecEqualsDefault(trs.translate, IDENTITY_TRS.translate)) {
    parts.push(`translate(${clampVecTokens(trs.translate, 3)})`);
  }
  if (!vecEqualsDefault(trs.rotate, IDENTITY_TRS.rotate)) {
    parts.push(`rotate(${clampVecTokens(trs.rotate, 3)})`);
  }
  if (!vecEqualsDefault(trs.scale, IDENTITY_TRS.scale)) {
    parts.push(`scale(${clampVecTokens(trs.scale, 3)})`);
  }
  return parts.join(" ");
}

export function formatTrsDisplay(n: {
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: [number, number, number];
}): string {
  return formatTrsDisplayFromChannels(formatTrsChannels(n));
}

function normalizeTrsAttr(raw: string): string {
  const parsed = parseTransformTrs(raw);
  if (!parsed) return raw.trim().replace(/\s+/g, " ");
  const display = transformDisplayFromTrs(parsed);
  return display ?? raw.trim().replace(/\s+/g, " ");
}

function resolveTrsNumbers(trs: TransformTrs): {
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: [number, number, number];
} | null {
  const r = transformTrsWithDefaults(trs);
  const t = parseVec3(r.translate);
  const rot = parseVec3(r.rotate);
  const s = parseVec3(r.scale);
  if (!t || !rot || !s) return null;
  return { translate: t, rotate: rot, scale: s };
}

/** Numeric matrix12 → TRS (Euler XYZ degrees), via THREE.decompose. */
export function decomposeMatrix12ToTrs(m: number[]): {
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: [number, number, number];
} {
  const mat = new Matrix4();
  const e = mat.elements;
  e[0] = m[0]!;
  e[1] = m[1]!;
  e[2] = m[2]!;
  e[3] = 0;
  e[4] = m[3]!;
  e[5] = m[4]!;
  e[6] = m[5]!;
  e[7] = 0;
  e[8] = m[6]!;
  e[9] = m[7]!;
  e[10] = m[8]!;
  e[11] = 0;
  e[12] = m[9]!;
  e[13] = m[10]!;
  e[14] = m[11]!;
  e[15] = 1;
  const pos = new Vector3();
  const quat = new Quaternion();
  const scale = new Vector3();
  mat.decompose(pos, quat, scale);
  const euler = new Euler().setFromQuaternion(quat, "XYZ");
  const rad2deg = 180 / Math.PI;
  return {
    translate: [pos.x, pos.y, pos.z],
    rotate: [euler.x * rad2deg, euler.y * rad2deg, euler.z * rad2deg],
    scale: [scale.x, scale.y, scale.z],
  };
}

/** Numeric TRS → matrix12 (`T · R · S`, Euler XYZ degrees). */
export function composeTrsToMatrix12(n: {
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: [number, number, number];
}): number[] {
  const deg2rad = Math.PI / 180;
  const mat = new Matrix4();
  const pos = new Vector3(n.translate[0], n.translate[1], n.translate[2]);
  const euler = new Euler(
    n.rotate[0] * deg2rad,
    n.rotate[1] * deg2rad,
    n.rotate[2] * deg2rad,
    "XYZ"
  );
  const quat = new Quaternion().setFromEuler(euler);
  const scale = new Vector3(n.scale[0], n.scale[1], n.scale[2]);
  mat.compose(pos, quat, scale);
  return matrix4ToMat4x3(mat);
}

/**
 * Evaluate transform draft/attr to a numeric 12-vector.
 * `evalToken` resolves each component (literals / var / calc); return null to abort.
 */
export function evaluateTransformToMatrix12(
  raw: string,
  evalToken: (tok: string) => number | null
): number[] | null {
  const s = raw.trim();
  if (!s) return [...IDENTITY_12];
  if (detectTransformForm(s) === "trs") {
    const trs = parseTransformTrs(s) ?? emptyTransformTrs();
    const resolved = transformTrsWithDefaults(trs);
    const channels = TRANSFORM_TRS_KEYS.map((key) => {
      const toks = parseVec3Components(resolved[key]);
      if (!toks) return null;
      const nums = toks.map((t) => evalToken(t));
      if (nums.some((n) => n == null || !Number.isFinite(n))) return null;
      return nums as [number, number, number];
    });
    if (channels.some((c) => !c)) return null;
    return composeTrsToMatrix12({
      translate: channels[0]!,
      rotate: channels[1]!,
      scale: channels[2]!,
    });
  }
  const toks = parseTransform12Components(transformToDisplay(s));
  if (!toks) return null;
  const nums = toks.map((t) => evalToken(t));
  if (nums.some((n) => n == null || !Number.isFinite(n))) return null;
  return nums as number[];
}

/**
 * Convert evaluated numeric transform between forms (lossy for expressions / shear).
 * Returns attr value (`matrix(...)` or TRS list), or `""` for identity.
 */
export function convertTransformForm(
  raw: string,
  to: TransformForm,
  /** Optional pre-evaluated 12-vector when expressions need baking. */
  evaluated12?: number[] | null
): string {
  if (!raw.trim() && !evaluated12) {
    return "";
  }
  // Translation-only (R=0,S=1): keep T tokens so silent switches don't bake --vars.
  const preserved = tryConvertTranslationOnlyPreservingTokens(raw, to);
  if (preserved != null) return preserved;

  let m: number[] | null = evaluated12 ?? null;
  if (!m) {
    if (detectTransformForm(raw) === "matrix") {
      m = parseTransform12(transformToDisplay(raw));
    } else {
      const trs = parseTransformTrs(raw);
      const nums = trs ? resolveTrsNumbers(trs) : null;
      m = nums ? composeTrsToMatrix12(nums) : null;
    }
  }
  if (!m) return transformToAttr(transformToDisplay(raw));
  return matrix12ToTransformAttr(m, to);
}

/**
 * If the source is identity-linear / default R·S, rewrite only the translation
 * channel into the other form (expressions preserved). Otherwise `null`.
 */
function tryConvertTranslationOnlyPreservingTokens(
  raw: string,
  to: TransformForm
): string | null {
  const s = raw.trim();
  if (!s) return "";

  if (detectTransformForm(s) === "trs") {
    const parsed = parseTransformTrs(s) ?? emptyTransformTrs();
    const resolved = transformTrsWithDefaults(parsed);
    if (vec3TokensHaveExpr(resolved.rotate) || vec3TokensHaveExpr(resolved.scale)) {
      return null;
    }
    const rot = parseVec3(resolved.rotate);
    const scl = parseVec3(resolved.scale);
    if (!rot || !scl) return null;
    if (!approxVec3(rot, [0, 0, 0]) || !approxVec3(scl, [1, 1, 1])) return null;
    if (to === "trs") return normalizeTrsAttr(s);
    const t = clampVecTokens(resolved.translate, 3);
    if (vecEqualsDefault(t, IDENTITY_TRS.translate)) return "";
    return `matrix(1 0 0 0 1 0 0 0 1 ${t})`;
  }

  // matrix form
  const toks = parseTransform12Components(transformToDisplay(s));
  if (!toks) return null;
  if (toks.slice(0, 9).some((t) => !isNumericTransformTok(t))) return null;
  const linear = toks.slice(0, 9).map(Number);
  if (linear.some((n) => !Number.isFinite(n))) return null;
  const idLinear = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (!linear.every((n, i) => Math.abs(n - idLinear[i]!) < 1e-9)) return null;
  const t = toks.slice(9, 12).join(" ");
  if (to === "matrix") return transformToAttr(transformToDisplay(s));
  if (vecEqualsDefault(t, IDENTITY_TRS.translate)) return "";
  return `translate(${t})`;
}

const isNumericTransformTok = (tok: string) =>
  /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(tok.trim());

function vec3TokensHaveExpr(raw: string): boolean {
  const toks = parseVec3Components(raw.trim() || "0 0 0");
  if (!toks) return true;
  return toks.some((t) => !isNumericTransformTok(t));
}

/** True if any transform component is not a plain number (var/calc/bare name). */
export function transformHasExprTokens(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;

  if (detectTransformForm(s) === "trs") {
    const trs = parseTransformTrs(s) ?? emptyTransformTrs();
    const resolved = transformTrsWithDefaults(trs);
    for (const key of TRANSFORM_TRS_KEYS) {
      if (vec3TokensHaveExpr(resolved[key])) return true;
    }
    return false;
  }
  const toks = parseTransform12Components(transformToDisplay(s));
  if (!toks) return /var\s*\(|calc\s*\(/i.test(s);
  return toks.some((t) => !isNumericTransformTok(t));
}

/**
 * True when decompose→compose does not reproduce `m` (shear / non-TRS linear part).
 */
export function matrix12LosesInfoUnderTrs(m: number[]): boolean {
  if (m.length !== 12) return true;
  const trs = decomposeMatrix12ToTrs(m);
  const back = composeTrsToMatrix12(trs);
  for (let i = 0; i < 12; i++) {
    if (Math.abs(m[i]! - back[i]!) > 1e-5) return true;
  }
  return false;
}

function approxVec3(
  a: [number, number, number],
  b: [number, number, number],
  eps = 1e-5
): boolean {
  return (
    Math.abs(a[0] - b[0]) <= eps &&
    Math.abs(a[1] - b[1]) <= eps &&
    Math.abs(a[2] - b[2]) <= eps
  );
}

/**
 * Whether switching persistent form needs a confirm dialog.
 *
 * Silent: identity, or **translation-only** (rotate≈0, scale≈1) — T maps 1:1.
 * Confirm: non-default rotate (Euler not unique), non-default scale (esp. with
 * rotation / non-uniform), shear, or expressions on rotate/scale / linear part.
 * Translation-channel expressions alone do not force a prompt.
 */
export function transformFormSwitchNeedsConfirm(
  raw: string,
  evaluated12?: number[] | null
): boolean {
  const s = raw.trim();
  if (!s) return false;

  const m =
    evaluated12 ??
    (() => {
      if (detectTransformForm(s) === "matrix") {
        return parseTransform12(transformToDisplay(s));
      }
      const trs = parseTransformTrs(s);
      const nums = trs ? resolveTrsNumbers(trs) : null;
      return nums ? composeTrsToMatrix12(nums) : null;
    })();

  // Prefer evaluated matrix when expressions need baking for R/S checks.
  const numeric = evaluated12 ?? m;
  if (!numeric) return true;

  if (matrix12LosesInfoUnderTrs(numeric)) return true;

  const trs = decomposeMatrix12ToTrs(numeric);
  const rotNonDefault = !approxVec3(trs.rotate, [0, 0, 0]);
  const scaleNonDefault = !approxVec3(trs.scale, [1, 1, 1]);
  if (rotNonDefault || scaleNonDefault) return true;

  // Translation-only / identity: warn only if linear (matrix) or R/S (TRS) carry exprs.
  if (detectTransformForm(s) === "trs") {
    const parsed = parseTransformTrs(s) ?? emptyTransformTrs();
    const resolved = transformTrsWithDefaults(parsed);
    if (vec3TokensHaveExpr(resolved.rotate)) return true;
    if (vec3TokensHaveExpr(resolved.scale)) return true;
    return false;
  }
  const toks = parseTransform12Components(transformToDisplay(s));
  if (!toks) return /var\s*\(|calc\s*\(/i.test(s);
  // First 9 = linear; last 3 = translation (exprs on T alone are OK).
  return toks.slice(0, 9).some((t) => !isNumericTransformTok(t));
}

function iterTransformFuncs(
  s: string
): Array<{ name: string; args: string }> | null {
  const out: Array<{ name: string; args: string }> = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i]!)) i += 1;
    if (i >= n) break;
    const start = i;
    while (i < n && /[A-Za-z_]/.test(s[i]!)) i += 1;
    if (i === start) return null;
    const name = s.slice(start, i).toLowerCase();
    while (i < n && /\s/.test(s[i]!)) i += 1;
    if (s[i] !== "(") return null;
    i += 1;
    const argsStart = i;
    let depth = 1;
    while (i < n) {
      const c = s[i]!;
      if (c === "(") depth += 1;
      else if (c === ")") {
        depth -= 1;
        if (depth === 0) {
          out.push({ name, args: s.slice(argsStart, i) });
          i += 1;
          break;
        }
      }
      i += 1;
    }
    if (depth !== 0) return null;
  }
  return out.length ? out : null;
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
    { name: "bottomCenterPt", placeholder: "0 0 0", pointAttr: true },
    { name: "topCenterPt", placeholder: "0 0 100", pointAttr: true },
  ],
  sphere: [
    { name: "radius", placeholder: "50" },
    { name: "center", placeholder: "0 0 0", pointAttr: true },
  ],
  cone: [
    { name: "bottomDiameter", placeholder: "100" },
    { name: "topDiameter", placeholder: "40" },
    { name: "bottomCenterPt", placeholder: "0 0 0", pointAttr: true },
    { name: "topCenterPt", placeholder: "0 0 100", pointAttr: true },
  ],
  torus: [
    { name: "diameter1", placeholder: "100" },
    { name: "diameter2", placeholder: "25" },
    { name: "angle", placeholder: "360" },
    { name: "torusCenterPt", placeholder: "0 0 0", pointAttr: true },
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
    { name: "bottomCenterPt", placeholder: "0 0 0", pointAttr: true },
    { name: "topCenterPt", placeholder: "0 0 100", pointAttr: true },
    { name: "angle", placeholder: "90" },
  ],
  point: [
    { name: "id", placeholder: "point-1" },
    { name: "at", placeholder: "0 0 0" },
  ],
  line: [
    { name: "from", placeholder: "0 0 0", pointAttr: true },
    { name: "to", placeholder: "100 0 0", pointAttr: true },
  ],
  arc: [
    {
      name: "form",
      placeholder: "angles",
      enumValues: ["angles", "ends"],
    },
    { name: "center", placeholder: "0 0 0", pointAttr: true },
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
      pointAttr: true,
      visibleWhen: {
        name: "form",
        values: ["ends"],
        whenEmpty: "angles",
      },
    },
    {
      name: "to",
      placeholder: "100 0 0",
      pointAttr: true,
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
    { name: "origin", placeholder: "0 0 0", pointAttr: true },
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
  gltf: [{ name: "href", placeholder: "assets/model.glb" }],
  /** Control-flow containers — draft §5. */
  if: [{ name: "test", placeholder: "true" }],
  "if-not": [{ name: "test", placeholder: "true" }],
  /** Animation (SMIL-shaped subset — draft §10). */
  animate: [
    {
      name: "attributeName",
      placeholder: "--H",
      // enumValues filled at inspect time from `:root` params
    },
    { name: "from", labelKey: "animFrom", placeholder: "0" },
    { name: "to", labelKey: "animTo", placeholder: "100" },
    { name: "begin", placeholder: "0s" },
    { name: "dur", placeholder: "2s" },
    // Spec default is `1` (omit). `0` = indefinite — keep explicit when set.
    { name: "repeat", placeholder: "1" },
    {
      name: "fill",
      labelKey: "animFill",
      placeholder: "remove",
      enumValues: ["remove", "freeze"],
    },
    {
      name: "calcMode",
      placeholder: "linear",
      enumValues: BLEND_VALUES,
    },
  ],
  animateTransform: [
    {
      name: "attributeName",
      placeholder: "transform",
      enumValues: ["transform"],
    },
    {
      name: "type",
      placeholder: "rotate",
      enumValues: ["translate", "rotate", "scale"],
    },
    { name: "from", labelKey: "animFrom", placeholder: "0 0 0" },
    { name: "to", labelKey: "animTo", placeholder: "0 0 90" },
    { name: "begin", placeholder: "0s" },
    { name: "dur", placeholder: "2s" },
    { name: "repeat", placeholder: "1" },
    {
      name: "fill",
      labelKey: "animFill",
      placeholder: "remove",
      enumValues: ["remove", "freeze"],
    },
    {
      name: "calcMode",
      placeholder: "linear",
      enumValues: BLEND_VALUES,
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
