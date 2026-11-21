/**
 * Lightweight preview for inspector labels.
 * Substitutes known params, then evaluates arithmetic and condition syntax
 * (`=` `<` `>` `<=` `>=` `<>`, `and` / `or` / `not`) matching draft §2.
 */

function formatPreviewNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  const t = Math.round(n * 1e6) / 1e6;
  if (Number.isInteger(t)) return String(t);
  return String(t)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.$/, "");
}

const EXPR_KEYWORDS = new Set([
  "calc",
  "var",
  "true",
  "false",
  "and",
  "or",
  "not",
]);

/** Substitute `var(--name)` / bare param names and unwrap `calc(...)`. */
function substituteParams(
  raw: string,
  params: ReadonlyMap<string, string>
): string {
  let expr = raw;
  expr = expr.replace(
    /var\(\s*--([A-Za-z_][\w-]*)\s*\)/gi,
    (_, name: string) => {
      const v = params.get(name);
      return v != null && String(v).trim() !== ""
        ? `(${String(v).trim()})`
        : "NaN";
    }
  );
  expr = expr.replace(/\b([A-Za-z_][\w-]*)\b/g, (id) => {
    if (EXPR_KEYWORDS.has(id.toLowerCase())) return id;
    if (params.has(id)) {
      const v = params.get(id)!;
      return v.trim() !== "" ? `(${v.trim()})` : "NaN";
    }
    return id;
  });
  return expr.replace(/calc\s*\(/gi, "(");
}

function tryEvalArithmetic(expr: string): string | null {
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

/**
 * Map svg3dx condition operators to JS, then evaluate.
 * Multi-char ops are protected before rewriting lone `=`.
 */
function tryEvalCondition(expr: string): string | null {
  let js = expr;
  js = js.replace(/<>/g, "\0NE\0");
  js = js.replace(/<=/g, "\0LE\0");
  js = js.replace(/>=/g, "\0GE\0");
  js = js.replace(/=/g, "===");
  js = js.replace(/\0NE\0/g, "!==");
  js = js.replace(/\0LE\0/g, "<=");
  js = js.replace(/\0GE\0/g, ">=");
  js = js.replace(/\band\b/gi, "&&");
  js = js.replace(/\bor\b/gi, "||");
  js = js.replace(/\bnot\b/gi, "!");

  // Reject leftover identifiers other than true/false.
  const stripped = js
    .replace(/\btrue\b/gi, "1")
    .replace(/\bfalse\b/gi, "0");
  if (!/^[\d\s.+\-*/()eE&|!<=>]+$/.test(stripped)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${js});`)();
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number" && Number.isFinite(v)) return formatPreviewNum(v);
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve an attr draft value to a preview string, or null if unknown.
 * Returns a number string for arithmetic, or `true` / `false` for conditions.
 */
export function previewExprResult(
  raw: string,
  params: ReadonlyMap<string, string>
): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Fast path: plain number / bool literal.
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) {
    return formatPreviewNum(Number(s));
  }
  if (/^(true|false)$/i.test(s)) return s.toLowerCase();

  const expr = substituteParams(s, params);
  return tryEvalArithmetic(expr) ?? tryEvalCondition(expr);
}
