/**
 * Known geometry attributes (svg3dx draft §3.2, lowerCamelCase).
 * Used by the inspector to show empty fields for unset attrs.
 */

export type AttrField = {
  name: string;
  /** Placeholder / default hint when unset. */
  placeholder?: string;
};

/** Common 3D transform on every geometry element. */
export const TRANSFORM_FIELDS: AttrField[] = [
  { name: "s3dx:transform", placeholder: "matrix(1 0 0 0 1 0 0 0 1 0 0 0)" },
];

const PRIMITIVE_ATTRS: Record<string, AttrField[]> = {
  box: [
    { name: "length" },
    { name: "width" },
    { name: "height" },
    { name: "lengthVec", placeholder: "1 0 0" },
    { name: "widthVec", placeholder: "0 1 0" },
  ],
  cylinder: [
    { name: "diameter" },
    { name: "bottomCenterPt" },
    { name: "topCenterPt" },
  ],
  sphere: [{ name: "radius" }, { name: "center" }],
  cone: [
    { name: "bottomDiameter" },
    { name: "topDiameter" },
    { name: "bottomCenterPt" },
    { name: "topCenterPt" },
  ],
  torus: [
    { name: "diameter1" },
    { name: "diameter2" },
    { name: "angle", placeholder: "360" },
    { name: "torusCenterPt" },
    { name: "normal" },
  ],
  wedge: [
    { name: "length" },
    { name: "width" },
    { name: "height" },
    { name: "lengthVec", placeholder: "1 0 0" },
    { name: "widthVec", placeholder: "0 1 0" },
    { name: "topLength", placeholder: "0" },
  ],
  pyramid: [
    { name: "length" },
    { name: "width" },
    { name: "height" },
    { name: "lengthVec", placeholder: "1 0 0" },
    { name: "widthVec", placeholder: "0 1 0" },
    { name: "topLength", placeholder: "0" },
    { name: "topWidth" },
  ],
  prism: [
    { name: "points" },
    { name: "height" },
    { name: "normal" },
  ],
  cutcylinder: [
    { name: "diameter" },
    { name: "bottomCenterPt" },
    { name: "topCenterPt" },
    { name: "angle", placeholder: "360" },
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
