/**
 * Lightweight numeric preview for inspector labels.
 * Substitutes known params, then evaluates + - * / and parentheses only.
 */

function formatPreviewNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  const t = Math.round(n * 1e6) / 1e6;
  if (Number.isInteger(t)) return String(t);
  return String(t)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.$/, "");
}

/**
 * Resolve an attr draft value to a numeric preview string, or null if unknown.
 */
export function previewExprResult(
  raw: string,
  params: ReadonlyMap<string, string>
): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Fast path: plain number.
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) {
    return formatPreviewNum(Number(s));
  }

  let expr = s;
  expr = expr.replace(/var\(\s*--([A-Za-z_][\w-]*)\s*\)/gi, (_, name: string) => {
    const v = params.get(name);
    return v != null && String(v).trim() !== "" ? `(${String(v).trim()})` : "NaN";
  });
  expr = expr.replace(/\b([A-Za-z_][\w-]*)\b/g, (id) => {
    if (id === "calc" || id === "var") return id;
    if (params.has(id)) {
      const v = params.get(id)!;
      return v.trim() !== "" ? `(${v.trim()})` : "NaN";
    }
    return id;
  });
  expr = expr.replace(/calc\s*\(/gi, "(");

  // Only allow arithmetic after substitution.
  if (!/^[\d\s.+\-*/()eE]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const n = Function(`"use strict"; return (${expr});`)();
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return formatPreviewNum(n);
  } catch {
    return null;
  }
}
