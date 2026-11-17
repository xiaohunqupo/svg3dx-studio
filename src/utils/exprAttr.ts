/**
 * Display / edit helpers for expression-capable scalar attrs
 * (`var(--name)`, `calc(var(--name))`, literals).
 */

const PURE_VAR_RE = /^var\(\s*(--([A-Za-z_][\w-]*))\s*\)$/i;
const PURE_CALC_VAR_RE =
  /^calc\(\s*var\(\s*(--([A-Za-z_][\w-]*))\s*\)\s*\)$/i;
const BARE_IDENT_RE = /^[A-Za-z_][\w-]*$/;
const DASHED_IDENT_RE = /^--([A-Za-z_][\w-]*)$/;

/** Bare param name without `--`, or null if not a pure var / calc(var) form. */
export function bareNameFromPureVarExpr(stored: string): string | null {
  const s = stored.trim();
  if (!s) return null;
  const calc = PURE_CALC_VAR_RE.exec(s);
  if (calc) return calc[2]!;
  const v = PURE_VAR_RE.exec(s);
  if (v) return v[2]!;
  return null;
}

/**
 * Stored → editor display.
 * `calc(var(--length))` / `var(--length)` → `length`; otherwise unchanged.
 */
export function simplifyExprDisplay(stored: string): string {
  const bare = bareNameFromPureVarExpr(stored);
  return bare ?? stored.trim();
}

export type ExprDisplayKind = "empty" | "literal" | "param-ok" | "param-bad" | "raw";

export function classifyExprDisplay(
  displayOrStored: string,
  effectiveBareNames: ReadonlySet<string>
): ExprDisplayKind {
  const s = displayOrStored.trim();
  if (!s) return "empty";
  const fromPure = bareNameFromPureVarExpr(s);
  if (fromPure) {
    return effectiveBareNames.has(fromPure) ? "param-ok" : "param-bad";
  }
  if (BARE_IDENT_RE.test(s)) {
    return effectiveBareNames.has(s) ? "param-ok" : "param-bad";
  }
  if (DASHED_IDENT_RE.test(s)) {
    const bare = s.slice(2);
    return effectiveBareNames.has(bare) ? "param-ok" : "param-bad";
  }
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) return "literal";
  if (s.includes("var(") || s.includes("calc(")) return "raw";
  return "raw";
}

/**
 * Editor display → stored attribute value.
 * Bare name that matches an effective param → `var(--name)`.
 * Otherwise keep as typed (literal / full expression).
 */
export function expandExprInput(
  display: string,
  effectiveBareNames: ReadonlySet<string>
): string {
  const s = display.trim();
  if (!s) return "";
  if (s.includes("var(") || s.includes("calc(")) return s;
  if (DASHED_IDENT_RE.test(s)) {
    const bare = s.slice(2);
    if (effectiveBareNames.has(bare)) return `var(${s})`;
    return s;
  }
  if (BARE_IDENT_RE.test(s) && effectiveBareNames.has(s)) {
    return `var(--${s})`;
  }
  return s;
}

export function bareParamName(dashedOrBare: string): string {
  const t = dashedOrBare.trim();
  return t.startsWith("--") ? t.slice(2) : t;
}

/** A parameter-like span inside the editor display text. */
export type ParamTokenSpan = {
  start: number;
  end: number;
  bare: string;
  /** `var(--x)` vs bare `x` vs `--x`. */
  kind: "var" | "bare" | "dashed";
};

const VAR_TOKEN_RE = /var\(\s*(--([A-Za-z_][\w-]*))\s*\)/gi;
const IDENT_TOKEN_RE = /--[A-Za-z_][\w-]*|[A-Za-z_][\w-]*/g;

/**
 * Find parameter tokens in editor text.
 * Includes `var(--name)`, `--name`, and bare idents (except `calc` / `var`).
 */
export function findParamTokens(text: string): ParamTokenSpan[] {
  const tokens: ParamTokenSpan[] = [];
  VAR_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VAR_TOKEN_RE.exec(text))) {
    tokens.push({
      start: m.index,
      end: m.index + m[0].length,
      bare: m[2]!,
      kind: "var",
    });
  }

  IDENT_TOKEN_RE.lastIndex = 0;
  while ((m = IDENT_TOKEN_RE.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    if (tokens.some((t) => start >= t.start && end <= t.end)) continue;
    const raw = m[0];
    if (raw === "calc" || raw === "var") continue;
    if (raw.startsWith("--")) {
      tokens.push({
        start,
        end,
        bare: raw.slice(2),
        kind: "dashed",
      });
    } else {
      tokens.push({ start, end, bare: raw, kind: "bare" });
    }
  }

  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}

/**
 * Token under caret. Caret at token start / middle / end all count
 * (range is inclusive on both ends).
 */
export function paramTokenAtCaret(
  text: string,
  caret: number
): ParamTokenSpan | null {
  const tokens = findParamTokens(text);
  for (const t of tokens) {
    if (caret >= t.start && caret <= t.end) return t;
  }
  return null;
}

/** Replace a token with a new bare param, preserving token form. */
export function replaceParamToken(
  text: string,
  token: ParamTokenSpan,
  newBare: string
): { text: string; caret: number } {
  const piece =
    token.kind === "var"
      ? `var(--${newBare})`
      : token.kind === "dashed"
        ? `--${newBare}`
        : newBare;
  const next = text.slice(0, token.start) + piece + text.slice(token.end);
  return { text: next, caret: token.start + piece.length };
}

function paramPieceForContext(text: string, newBare: string): string {
  const useVarForm = /var\s*\(|calc\s*\(/i.test(text);
  return useVarForm ? `var(--${newBare})` : newBare;
}

/**
 * Insert a param at caret. Inside `var(`/`calc(` expressions use `var(--name)`;
 * otherwise insert the bare name (matches simplified editor).
 */
export function insertParamAtCaret(
  text: string,
  caret: number,
  newBare: string
): { text: string; caret: number } {
  const piece = paramPieceForContext(text, newBare);
  const next = text.slice(0, caret) + piece + text.slice(caret);
  return { text: next, caret: caret + piece.length };
}

/** Replace an explicit selection range with a param. */
export function replaceSelectionWithParam(
  text: string,
  start: number,
  end: number,
  newBare: string
): { text: string; caret: number } {
  const a = Math.min(start, end);
  const b = Math.max(start, end);
  const piece = paramPieceForContext(text, newBare);
  const next = text.slice(0, a) + piece + text.slice(b);
  return { text: next, caret: a + piece.length };
}

export type ExprColorToken = {
  text: string;
  /** literal = number/ops; param-ok/bad = parameter spans. */
  kind: "literal" | "param-ok" | "param-bad";
};

/**
 * Segment editor text for colored mirror:
 * `100+length` → literal `100+` + purple/red `length`.
 */
export function colorizeExprDisplay(
  text: string,
  effectiveBareNames: ReadonlySet<string>
): ExprColorToken[] {
  if (!text) return [];
  const params = findParamTokens(text);
  const out: ExprColorToken[] = [];
  let i = 0;
  for (const p of params) {
    if (p.start > i) {
      out.push({ text: text.slice(i, p.start), kind: "literal" });
    }
    out.push({
      text: text.slice(p.start, p.end),
      kind: effectiveBareNames.has(p.bare) ? "param-ok" : "param-bad",
    });
    i = p.end;
  }
  if (i < text.length) {
    out.push({ text: text.slice(i), kind: "literal" });
  }
  return out;
}
