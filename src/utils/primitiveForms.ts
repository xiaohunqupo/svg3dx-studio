/**
 * Primitive `form` attribute — mutually exclusive parameter systems (§3.2).
 * Shared vocabulary across kinds; each kind only exposes its own values.
 */

export type PrimitiveFormSpec = {
  /** Allowed `form` values (XML identifiers). */
  values: readonly string[];
  /** Default when omitted / for new inserts. */
  default: string;
  /** Attrs kept for every form. */
  shared: readonly string[];
  /** Attrs exclusive to each form value (stripped when inactive). */
  byForm: Readonly<Record<string, readonly string[]>>;
};

/** `form` specs keyed by primitive local name. */
export const PRIMITIVE_FORMS: Readonly<Record<string, PrimitiveFormSpec>> = {
  arc: {
    values: ["angles", "ends"],
    default: "angles",
    shared: ["center", "normal", "radius", "xDir"],
    byForm: {
      angles: ["startAngle", "angle"],
      ends: ["from", "to"],
    },
  },
  path: {
    values: ["polyline", "segments"],
    default: "segments",
    shared: [],
    byForm: {
      polyline: ["points"],
      segments: [],
    },
  },
  // `sweep` has no `form`: trajectory is always a child `<s3dx:path>`.
  pipe: {
    values: ["inline", "child"],
    default: "child",
    shared: [],
    byForm: {
      inline: ["path"],
      child: [],
    },
  },
};

export function primitiveFormSpec(kind: string): PrimitiveFormSpec | null {
  return PRIMITIVE_FORMS[kind] ?? null;
}

function attrNonEmpty(
  attrs: Record<string, string> | null | undefined,
  name: string
): boolean {
  if (!attrs) return false;
  const direct = attrs[name];
  if (direct?.trim()) return true;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(attrs)) {
    if (k.toLowerCase() === lower && v.trim()) return true;
  }
  return false;
}

/** Infer `form` when the attribute is missing (document order / heuristics). */
export function inferPrimitiveForm(
  kind: string,
  attrs: Record<string, string> | null | undefined,
  opts?: { hasPathChild?: boolean; hasCurveChildren?: boolean }
): string {
  const spec = primitiveFormSpec(kind);
  if (!spec) return "";
  const written = attrs
    ? (attrs.form ?? attrs.Form ?? "").trim()
    : "";
  if (written && (spec.values as readonly string[]).includes(written)) {
    return written;
  }

  if (kind === "arc") {
    if (attrNonEmpty(attrs, "from") && attrNonEmpty(attrs, "to")) return "ends";
    return "angles";
  }
  if (kind === "path") {
    if (opts?.hasCurveChildren) return "segments";
    if (attrNonEmpty(attrs, "points")) return "polyline";
    return spec.default;
  }
  if (kind === "pipe") {
    if (opts?.hasPathChild) return "child";
    if (attrNonEmpty(attrs, "path")) return "inline";
    return spec.default;
  }
  return spec.default;
}

/** Attr names that belong to other forms and should be cleared. */
export function inactiveFormAttrNames(
  kind: string,
  form: string
): string[] {
  const spec = primitiveFormSpec(kind);
  if (!spec) return [];
  const active = new Set<string>([
    ...spec.shared,
    ...(spec.byForm[form] ?? []),
    "form",
  ]);
  const out: string[] = [];
  for (const [f, names] of Object.entries(spec.byForm)) {
    if (f === form) continue;
    for (const n of names) {
      if (!active.has(n)) out.push(n);
    }
  }
  return out;
}

/** Whether an attr should show for the current form (shared always). */
export function isAttrActiveForForm(
  kind: string,
  form: string,
  attrName: string
): boolean {
  const spec = primitiveFormSpec(kind);
  if (!spec) return true;
  if (attrName === "form") return true;
  if (spec.shared.includes(attrName)) return true;
  const exclusive = spec.byForm[form] ?? [];
  if (exclusive.includes(attrName)) return true;
  // Attr not listed in form system → always show (e.g. sweep orient).
  const allExclusive = new Set(
    Object.values(spec.byForm).flatMap((xs) => [...xs])
  );
  return !allExclusive.has(attrName);
}
