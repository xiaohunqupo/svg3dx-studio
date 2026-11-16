/**
 * Known geometry attributes (svg3dx draft §3.2, lowerCamelCase).
 * Used by the inspector to show empty fields for unset attrs.
 */

export type AttrField = {
  name: string;
  /** Placeholder / default hint when unset. */
  placeholder?: string;
  /** Short help under the input (enum meaning, units, etc.). */
  description?: string;
};

/** Common 3D transform on every geometry element. */
export const TRANSFORM_FIELDS: AttrField[] = [
  { name: "s3dx:transform", placeholder: "1 0 0 0 1 0 0 0 1 0 0 0" },
];

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

/** Column-vector axes + translation (matches core `Mat4x3`). */
export type TransformParts = {
  position: string;
  xdir: string;
  ydir: string;
  zdir: string;
};

export const TRANSFORM_PART_KEYS = [
  "position",
  "xdir",
  "ydir",
  "zdir",
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
 * Whether text looks like one or more XYZ triplets (points / vectors / matrices).
 * Used to enable R/G/B segmented coloring in the inspector.
 */
export function looksLikeVecRgbText(raw: string): boolean {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
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
  const nums = inner
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length !== 12 || nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

export function identityTransformParts(): TransformParts {
  return transformPartsFrom12(IDENTITY_12);
}

/** Empty part editors — defaults appear only as placeholders. */
export function emptyTransformParts(): TransformParts {
  return { position: "", xdir: "", ydir: "", zdir: "" };
}

export function transformPartsFrom12(m: number[]): TransformParts {
  return {
    xdir: formatVec3(m[0]!, m[1]!, m[2]!),
    ydir: formatVec3(m[3]!, m[4]!, m[5]!),
    zdir: formatVec3(m[6]!, m[7]!, m[8]!),
    position: formatVec3(m[9]!, m[10]!, m[11]!),
  };
}

export function parseVec3(raw: string): [number, number, number] | null {
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!];
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

/** Blank parts resolve to identity so compose / commit stay valid. */
export function transformPartsWithDefaults(parts: TransformParts): TransformParts {
  const id = identityTransformParts();
  return {
    position: (parts.position ?? "").trim() || id.position,
    xdir: (parts.xdir ?? "").trim() || id.xdir,
    ydir: (parts.ydir ?? "").trim() || id.ydir,
    zdir: (parts.zdir ?? "").trim() || id.zdir,
  };
}

/** Build bare 12-number display from parts; null if any non-empty part is invalid. */
export function transformDisplayFromParts(parts: TransformParts): string | null {
  return transformDisplayFromPartsResolved(transformPartsWithDefaults(parts));
}

function transformDisplayFromPartsResolved(
  parts: TransformParts
): string | null {
  const x = parseVec3(parts.xdir);
  const y = parseVec3(parts.ydir);
  const z = parseVec3(parts.zdir);
  const p = parseVec3(parts.position);
  if (!x || !y || !z || !p) return null;
  return [...x, ...y, ...z, ...p].map(formatTransformNum).join(" ");
}

/**
 * Sync editors from compact display. Identity / unset → empty strings so
 * placeholders show defaults (not "has value").
 */
export function syncTransformPartsFromDisplay(raw: string): TransformParts {
  const m = parseTransform12(raw);
  if (!m || isIdentityTransformDisplay(raw)) return emptyTransformParts();
  const parts = transformPartsFrom12(m);
  const id = identityTransformParts();
  const blankIfIdentity = (value: string, identity: string): string => {
    const v = parseVec3(value);
    const i = parseVec3(identity);
    if (v && i && vec3Equals(v, i)) return "";
    return value;
  };
  return {
    position: blankIfIdentity(parts.position, id.position),
    xdir: blankIfIdentity(parts.xdir, id.xdir),
    ydir: blankIfIdentity(parts.ydir, id.ydir),
    zdir: blankIfIdentity(parts.zdir, id.zdir),
  };
}

/**
 * Appearance attrs (draft §8): fill × material × opacity.
 * Shown for primitives / groups / bool containers — not geometric params.
 */
export const APPEARANCE_FIELDS: AttrField[] = [
  { name: "fill", placeholder: "#87ABCCFF" },
  { name: "material", placeholder: "default" },
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
    { name: "center", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
    { name: "radius", placeholder: "100" },
    { name: "xDir", placeholder: "1 0 0" },
    { name: "startAngle", placeholder: "0" },
    { name: "angle", placeholder: "90" },
    { name: "from" },
    { name: "to" },
  ],
  path: [{ name: "points", placeholder: "0 0 0  100 0 0  100 0 100" }],
  extrude: [
    { name: "origin", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
    { name: "xDir", placeholder: "1 0 0" },
    { name: "dir", placeholder: "0 0 1" },
    { name: "length", placeholder: "100" },
  ],
  revolve: [
    { name: "origin", placeholder: "0 0 0" },
    { name: "normal", placeholder: "0 0 1" },
    { name: "xDir", placeholder: "1 0 0" },
    { name: "axisOrigin", placeholder: "0 0 0" },
    { name: "axisDir", placeholder: "0 1 0" },
    { name: "angle", placeholder: "360" },
  ],
  loft: [
    { name: "solid", placeholder: "true" },
    {
      name: "blend",
      placeholder: "linear",
      description:
        "截面形状趋近律：linear（匀速）/ sine（前慢后快）/ cosine（两端慢中间快）/ tan（前更慢）/ cotan（前更快）",
    },
  ],
  sweep: [
    { name: "orient", placeholder: "frenet" },
    { name: "refDir" },
    { name: "solid", placeholder: "true" },
    { name: "corner", placeholder: "arc" },
    { name: "cornerRadius", placeholder: "50" },
    { name: "path" },
  ],
  pipe: [
    { name: "radius", placeholder: "20" },
    { name: "innerRadius", placeholder: "16" },
    { name: "corner", placeholder: "arc" },
    { name: "cornerRadius", placeholder: "50" },
    { name: "path" },
  ],
};

export const GROUP_BASIC_FIELDS: AttrField[] = [
  { name: "id" },
  { name: "class" },
];

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
