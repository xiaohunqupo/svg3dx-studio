/**
 * Studio rule: a value equal to the field default / placeholder is treated
 * as unset (empty), so clear sticks and the attr is omitted from XML.
 */

import {
  isIdentityTransformDisplay,
  splitVecTokens,
  vecEqualsDefault,
} from "@/utils/nodeSchema";

/** Attrs where an explicit value must stay even if it matches a hint. */
const SKIP_DEFAULT_BLANK = new Set([
  "id",
  "class",
  "type",
  "form",
  "mode",
  "active",
  "href",
  "xlink:href",
  "fill",
  "color",
  "material",
  "selector",
  "label",
  // Animation §10 — required / semantic; placeholders are examples, not omit-defaults.
  "attributeName",
  "from",
  "to",
  "dur",
]);

function bothNumericEqual(a: string, b: string): boolean {
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(a)) return false;
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(b)) return false;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-9;
}

function tokensEqualDefault(value: string, identity: string): boolean {
  const vToks = splitVecTokens(value);
  const iToks = splitVecTokens(identity);
  if (!vToks.length || vToks.length !== iToks.length) return false;
  if (vToks.length === 3) return vecEqualsDefault(value, identity);
  for (let i = 0; i < vToks.length; i++) {
    const a = vToks[i]!;
    const b = iToks[i]!;
    if (bothNumericEqual(a, b) || a === b) continue;
    return false;
  }
  return true;
}

/**
 * If `value` matches `defaultHint` (placeholder / schema default), return "".
 * Otherwise return the trimmed value.
 */
export function blankIfEqualsDefault(
  value: string,
  defaultHint: string | undefined | null,
  attrName?: string
): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (attrName && SKIP_DEFAULT_BLANK.has(attrName)) return v;

  const d = (defaultHint ?? "").trim();
  if (!d) return v;

  if (
    attrName === "s3dx:transform" ||
    (splitVecTokens(d).length === 12 && splitVecTokens(v).length === 12)
  ) {
    if (isIdentityTransformDisplay(v) && isIdentityTransformDisplay(d)) {
      return "";
    }
  }

  if (bothNumericEqual(v, d) || v === d) return "";
  if (tokensEqualDefault(v, d)) return "";
  return v;
}

export function shouldBlankDefault(attrName: string): boolean {
  return !SKIP_DEFAULT_BLANK.has(attrName);
}
