/**
 * Document structure cleanup for svg3dx Studio.
 *
 * Order (cheapest → dependents last):
 * 1. Unset `<s3dx:use>` (no href)
 * 2. Unreferenced top-level defs `<g id>`
 * 3. Empty bool / logic / loop containers, then empty `<g>`
 * 4. Unused document materials and CSS custom properties (params)
 * 5. Empty style rules (no parameters)
 * 6. `class` tokens that no longer match a defined style rule
 * 7. Sweep trajectory → always child `<s3dx:path>` (drop inline `path` / `form`)
 * 8. Primitive `form` normalization — drop attrs / children that don't match
 */

import { extractClassRules, extractDefsGroups } from "@/utils/styleClasses";
import { extractDocumentMaterials } from "@/utils/documentMaterials";
import {
  inactiveFormAttrNames,
  inferPrimitiveForm,
  primitiveFormSpec,
} from "@/utils/primitiveForms";
import { removeGroupById } from "@/utils/svgEdit";

export type OptimizeStats = {
  removedUses: number;
  removedGroups: number;
  removedContainers: number;
  removedMaterials: number;
  removedParams: number;
  removedStyles: number;
  removedClassAttrs: number;
  removedFormAttrs: number;
};

export type OptimizeResult = {
  content: string;
  stats: OptimizeStats;
  changed: boolean;
};

const EMPTY_CONTAINER_TAGS = [
  "s3dx:bool-union",
  "s3dx:bool-subtract",
  "s3dx:bool-intersect",
  "s3dx:if",
  "s3dx:if-not",
  "s3dx:loop-points",
  "s3dx:loop-range",
] as const;

type Span = { start: number; end: number };

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when markup has no element children (whitespace / comments only). */
function isEffectivelyEmpty(inner: string): boolean {
  const stripped = inner
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .trim();
  return !stripped || !/<[A-Za-z_]/.test(stripped);
}

/** Expand span to absorb a following newline. */
function expandTrailingNewline(svg: string, end: number): number {
  if (svg[end] === "\n") return end + 1;
  if (svg.slice(end, end + 2) === "\r\n") return end + 2;
  return end;
}

/** Trim leading indentation on the same line and a following newline. */
function expandLineSpan(svg: string, start: number, end: number): Span {
  let s = start;
  const e = expandTrailingNewline(svg, end);
  while (s > 0 && (svg[s - 1] === " " || svg[s - 1] === "\t")) s -= 1;
  return { start: s, end: e };
}

function cutSpan(svg: string, span: Span): string {
  const { start, end } = expandLineSpan(svg, span.start, span.end);
  return svg.slice(0, start) + svg.slice(end);
}

/**
 * All element spans for a tag name (e.g. `g`, `s3dx:if`), document order.
 * Handles self-closing and nested same-tag depth.
 */
function findTagSpans(svg: string, tagName: string): Span[] {
  const openRe = new RegExp(`<${escapeRegExp(tagName)}\\b([^>]*)\\/?>`, "gi");
  const spans: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    const full = m[0];
    const start = m.index;
    if (/\/\s*>$/.test(full)) {
      spans.push({ start, end: start + full.length });
      continue;
    }
    let depth = 1;
    const tokenRe = new RegExp(
      `<\\/?${escapeRegExp(tagName)}\\b[^>]*\\/?>`,
      "gi"
    );
    tokenRe.lastIndex = start + full.length;
    let tm: RegExpExecArray | null;
    let closed = false;
    while ((tm = tokenRe.exec(svg))) {
      const tok = tm[0];
      if (/^<\//.test(tok)) {
        depth -= 1;
        if (depth === 0) {
          spans.push({ start, end: tm.index + tok.length });
          closed = true;
          break;
        }
      } else if (!/\/\s*>$/.test(tok)) {
        depth += 1;
      }
    }
    if (!closed) {
      // Malformed — skip
    }
  }
  return spans;
}

function removeUnsetUses(svg: string, stats: OptimizeStats): string {
  const re = /<s3dx:use\b([^>]*)\/?>/gi;
  const cuts: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1] ?? "";
    const href =
      attrOf(attrs, "href") ?? attrOf(attrs, "xlink:href") ?? "";
    const bare = href.replace(/^#/, "").trim();
    if (!bare) {
      cuts.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  let out = svg;
  for (let i = cuts.length - 1; i >= 0; i -= 1) {
    out = cutSpan(out, cuts[i]!);
    stats.removedUses += 1;
  }
  return out;
}

function collectReferencedGroupIds(svg: string): Set<string> {
  const ids = new Set<string>();
  const re = /<s3dx:use\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1] ?? "";
    const href =
      attrOf(attrs, "href") ?? attrOf(attrs, "xlink:href") ?? "";
    const bare = href.replace(/^#/, "").trim();
    if (bare) ids.add(bare);
  }
  return ids;
}

function removeUnreferencedDefsGroups(
  svg: string,
  stats: OptimizeStats
): string {
  let out = svg;
  // Repeat: removing a group cannot revive another, but keep simple.
  for (let pass = 0; pass < 32; pass += 1) {
    const groups = extractDefsGroups(out);
    const referenced = collectReferencedGroupIds(out);
    const unused = groups.map((g) => g.id).filter((id) => !referenced.has(id));
    if (!unused.length) break;
    for (const id of unused) {
      const next = removeGroupById(out, id);
      if (next !== out) {
        out = next;
        stats.removedGroups += 1;
      }
    }
  }
  return out;
}

function removeEmptyContainers(svg: string, stats: OptimizeStats): string {
  let out = svg;
  for (const tag of EMPTY_CONTAINER_TAGS) {
    const spans = findTagSpans(out, tag);
    const closeRe = new RegExp(`</${escapeRegExp(tag)}\\s*>$`, "i");
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const span = spans[i]!;
      const openEnd = out.indexOf(">", span.start) + 1;
      if (openEnd <= 0) continue;
      const selfClosing = /\/\s*>$/.test(out.slice(span.start, openEnd));
      const innerOnly = selfClosing
        ? ""
        : out.slice(openEnd, span.end).replace(closeRe, "");
      if (!isEffectivelyEmpty(innerOnly)) continue;
      out = cutSpan(out, span);
      stats.removedContainers += 1;
    }
  }
  return out;
}

function removeEmptyGroups(svg: string, stats: OptimizeStats): string {
  let out = svg;
  // Re-scan after each id-based delete: removeGroupById also strips uses.
  for (;;) {
    const spans = findTagSpans(out, "g");
    let removed = false;
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const span = spans[i]!;
      const openMatch = /^<g\b([^>]*)\/?>/i.exec(
        out.slice(span.start, span.end)
      );
      if (!openMatch) continue;
      const attrs = openMatch[1] ?? "";
      const selfClosing = /\/\s*>$/.test(openMatch[0]);
      const openEnd = span.start + openMatch[0].length;
      const innerOnly = selfClosing
        ? ""
        : out.slice(openEnd, span.end).replace(/<\/g\s*>$/i, "");
      if (!isEffectivelyEmpty(innerOnly)) continue;
      const id = attrOf(attrs, "id");
      if (id) {
        const next = removeGroupById(out, id);
        if (next !== out) {
          out = next;
          stats.removedGroups += 1;
          removed = true;
          break;
        }
      }
      out = cutSpan(out, span);
      stats.removedGroups += 1;
      removed = true;
      break;
    }
    if (!removed) break;
  }
  return out;
}

function collectUsedMaterialIds(svg: string): Set<string> {
  const used = new Set<string>();
  const re =
    /\bmaterial\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw) continue;
    const url = /^url\(\s*#\s*([^)\s]+)\s*\)$/i.exec(raw);
    if (url) {
      used.add(url[1]!);
      continue;
    }
    if (raw.startsWith("#")) used.add(raw.slice(1));
    else if (!/[\s(/]/.test(raw)) used.add(raw);
  }
  return used;
}

function removeUnusedMaterials(svg: string, stats: OptimizeStats): string {
  const docs = extractDocumentMaterials(svg);
  if (!docs.length) return svg;
  const used = collectUsedMaterialIds(svg);
  let out = svg;
  for (const mat of docs) {
    if (used.has(mat.id)) continue;
    const re = new RegExp(
      `\\s*<s3dx:material\\b(?=[^>]*\\bid\\s*=\\s*(["'])${escapeRegExp(
        mat.id
      )}\\1)[^>]*\\/?>`,
      "i"
    );
    const next = out.replace(re, "");
    if (next !== out) {
      out = next;
      stats.removedMaterials += 1;
    }
  }
  // Drop empty materials block.
  out = out.replace(
    /\s*<s3dx:materials\b[^>]*>\s*<\/s3dx:materials>/gi,
    "\n"
  );
  return out;
}

/** Custom properties referenced via var(--name) anywhere in the document. */
function collectReferencedParamNames(svg: string): Set<string> {
  const used = new Set<string>();
  const re = /var\(\s*--([A-Za-z_][\w-]*)\s*[,)]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    used.add(m[1]!);
  }
  return used;
}

function removeUnusedParams(svg: string, stats: OptimizeStats): string {
  let out = svg;
  for (let pass = 0; pass < 32; pass += 1) {
    const used = collectReferencedParamNames(out);
    let passRemoved = 0;

    const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    out = out.replace(styleRe, (full, css: string) => {
      let nextCss = css;
      const ruleRe = /([^{}@]+)\{([^}]*)\}/g;
      nextCss = nextCss.replace(ruleRe, (ruleFull, selector: string, body: string) => {
        const props: string[] = [];
        const propRe =
          /((?:--[A-Za-z_][\w-]*)|(?:[A-Za-z_][\w-]*))\s*:\s*([^;]+);?/g;
        let pm: RegExpExecArray | null;
        let bodyChanged = false;
        while ((pm = propRe.exec(body))) {
          const name = pm[1]!.trim();
          const value = pm[2]!.trim();
          if (name.startsWith("--")) {
            const bare = name.slice(2);
            if (!used.has(bare)) {
              passRemoved += 1;
              bodyChanged = true;
              continue;
            }
          }
          props.push(`      ${name}: ${value};`);
        }
        if (!bodyChanged) return ruleFull;
        if (!props.length) return ""; // drop empty rule
        return `${selector.trim()} {\n${props.join("\n")}\n    }`;
      });
      // Collapse leftover blank lines from removed rules
      nextCss = nextCss.replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n");
      return full.replace(css, nextCss);
    });

    if (!passRemoved) break;
    stats.removedParams += passRemoved;
  }
  return out;
}

/** True when a CSS rule body declares no properties. */
function ruleBodyHasNoProps(body: string): boolean {
  return !/(?:--[A-Za-z_][\w-]*|[A-Za-z_][\w-]*)\s*:/.test(body);
}

/**
 * Drop `:root` / `.class` rules that have no parameters left,
 * then remove empty `<style>` blocks.
 */
function removeEmptyStyleRules(svg: string, stats: OptimizeStats): string {
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let out = svg.replace(styleRe, (full, css: string) => {
    let nextCss = css;
    const ruleRe = /([^{}@]+)\{([^}]*)\}/g;
    nextCss = nextCss.replace(ruleRe, (ruleFull, selector: string, body: string) => {
      const sel = selector.trim();
      if (!sel) return ruleFull;
      const isRoot = /^:root$/i.test(sel);
      const isClass = /^\.[A-Za-z_][\w-]*$/.test(sel);
      if (!isRoot && !isClass) return ruleFull;
      if (!ruleBodyHasNoProps(body)) return ruleFull;
      stats.removedStyles += 1;
      return "";
    });
    nextCss = nextCss.replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n");
    return full.replace(css, nextCss);
  });

  out = out.replace(/\s*<style\b[^>]*>\s*<\/style>/gi, "\n");
  return out;
}

/**
 * On every element, keep only `class` tokens that still have a `.token { }`
 * rule in `<style>`. Remove the attribute when nothing remains.
 */
function removeInvalidClassAttrs(svg: string, stats: OptimizeStats): string {
  const defined = new Set(Object.keys(extractClassRules(svg)));
  const tagRe = /<([A-Za-z_][\w:.-]*)(\s[^>]*?)(\s*\/?\s*)>/g;
  return svg.replace(tagRe, (full, tag: string, attrs: string, close: string) => {
    const m = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!m) return full;
    const quote = m[1] != null ? '"' : "'";
    const tokens = (m[1] ?? m[2] ?? "").trim().split(/\s+/).filter(Boolean);
    const kept = tokens.filter((c) => defined.has(c));
    // Keep as-is when every token maps to a defined style rule.
    if (tokens.length > 0 && kept.length === tokens.length) return full;

    stats.removedClassAttrs += 1;
    const nextAttrs = !kept.length
      ? attrs.replace(m[0], "")
      : attrs.replace(m[0], ` class=${quote}${kept.join(" ")}${quote}`);
    const selfClosing = /\/\s*$/.test(close);
    if (!nextAttrs.trim()) {
      return selfClosing ? `<${tag}/>` : `<${tag}>`;
    }
    return selfClosing ? `<${tag}${nextAttrs}/>` : `<${tag}${nextAttrs}>`;
  });
}

function parseAttrMap(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    out[m[1]!] = (m[2] ?? m[3] ?? "").trim();
  }
  return out;
}

function serializeAttrMap(map: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (!v.trim() && k !== "form") continue;
    parts.push(`${k}="${v}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function elementHasDirectChild(
  inner: string,
  childLocals: readonly string[]
): boolean {
  for (const local of childLocals) {
    const re = new RegExp(`<s3dx:${escapeRegExp(local)}\\b`, "i");
    if (re.test(inner)) return true;
  }
  return false;
}

function stripDirectChildren(
  inner: string,
  childLocals: readonly string[]
): { inner: string; removed: number } {
  let next = inner;
  let removed = 0;
  for (const local of childLocals) {
    const tag = `s3dx:${local}`;
    const spans = findTagSpans(next, tag);
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const span = spans[i]!;
      // Only strip top-level children of this inner blob (depth 0 relative to inner).
      // findTagSpans is document-order in `next`; nested same-tag is rare for line/arc/path.
      next = next.slice(0, span.start) + next.slice(span.end);
      removed += 1;
    }
  }
  next = next.replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n");
  return { inner: next, removed };
}

/**
 * Sweep has no inline trajectory: ensure child `<s3dx:path>`, drop `form` /
 * parent `path=` (promote path attr to a polyline child when missing).
 */
function normalizeSweepChildPath(svg: string, stats: OptimizeStats): string {
  const tag = "s3dx:sweep";
  const openRe = new RegExp(`<${escapeRegExp(tag)}\\b([^>]*)(\\/?)>`, "gi");
  const matches: Array<{
    start: number;
    end: number;
    attrs: string;
    selfClosing: boolean;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      attrs: m[1] ?? "",
      selfClosing: /\/\s*$/.test(m[2] ?? "") || /\/\s*>$/.test(m[0]),
    });
  }

  let out = svg;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const hit = matches[i]!;
    const map = parseAttrMap(hit.attrs);
    let inner = "";
    let closeEnd = hit.end;
    if (!hit.selfClosing) {
      const spans = findTagSpans(out, tag).filter((s) => s.start === hit.start);
      const span = spans[0];
      if (span) {
        inner = out.slice(hit.end, span.end).replace(
          new RegExp(`</${escapeRegExp(tag)}\\s*>$`, "i"),
          ""
        );
        closeEnd = span.end;
      }
    }

    let changed = false;
    let nextInner = inner;
    const hasPathChild = elementHasDirectChild(nextInner, ["path"]);
    const pathAttr = (map.path ?? "").trim();

    if (pathAttr && !hasPathChild) {
      const indent = "\n        ";
      nextInner =
        nextInner.replace(/\s*$/, "") +
        `${indent}<s3dx:path form="polyline" points="${pathAttr}"/>\n      `;
      changed = true;
      stats.removedFormAttrs += 1;
    }

    if ("path" in map) {
      delete map.path;
      changed = true;
      stats.removedFormAttrs += 1;
    }
    if ("form" in map) {
      delete map.form;
      changed = true;
      stats.removedFormAttrs += 1;
    }

    if (!changed) continue;

    const open =
      hit.selfClosing && !nextInner.trim()
        ? `<${tag}${serializeAttrMap(map)}/>`
        : `<${tag}${serializeAttrMap(map)}>`;
    const close = nextInner.trim() || !hit.selfClosing ? `</${tag}>` : "";
    const body = close ? `${nextInner}${close}` : "";
    out = out.slice(0, hit.start) + open + body + out.slice(closeEnd);
  }
  return out;
}

/**
 * Normalize `form` on arc / path / pipe: write inferred form, strip
 * inactive attrs, and drop children that conflict with the active form.
 * (`sweep` has no `form` — see `normalizeSweepChildPath`.)
 */
function normalizePrimitiveForms(svg: string, stats: OptimizeStats): string {
  const kinds = ["arc", "path", "pipe"] as const;
  let out = svg;

  for (const kind of kinds) {
    const tag = `s3dx:${kind}`;
    const openRe = new RegExp(`<${escapeRegExp(tag)}\\b([^>]*)(\\/?)>`, "gi");
    const matches: Array<{
      start: number;
      end: number;
      attrs: string;
      selfClosing: boolean;
    }> = [];
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(out))) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        attrs: m[1] ?? "",
        selfClosing: /\/\s*$/.test(m[2] ?? "") || /\/\s*>$/.test(m[0]),
      });
    }

    for (let i = matches.length - 1; i >= 0; i -= 1) {
      const hit = matches[i]!;
      const map = parseAttrMap(hit.attrs);
      let inner = "";
      let closeEnd = hit.end;
      if (!hit.selfClosing) {
        const spans = findTagSpans(out, tag).filter((s) => s.start === hit.start);
        const span = spans[0];
        if (span) {
          const openEnd = hit.end;
          inner = out.slice(openEnd, span.end).replace(
            new RegExp(`</${escapeRegExp(tag)}\\s*>$`, "i"),
            ""
          );
          closeEnd = span.end;
        }
      }

      const form = inferPrimitiveForm(kind, map, {
        hasCurveChildren: elementHasDirectChild(inner, ["line", "arc"]),
        hasPathChild: elementHasDirectChild(inner, ["path"]),
      });
      if (!form || !primitiveFormSpec(kind)) continue;

      let changed = false;
      if (map.form !== form) {
        map.form = form;
        changed = true;
      }
      for (const name of inactiveFormAttrNames(kind, form)) {
        if (name in map && map[name]!.trim()) {
          delete map[name];
          stats.removedFormAttrs += 1;
          changed = true;
        } else if (name in map) {
          delete map[name];
          changed = true;
        }
      }

      let nextInner = inner;
      if (kind === "path" && form === "polyline") {
        const stripped = stripDirectChildren(nextInner, ["line", "arc"]);
        if (stripped.removed) {
          nextInner = stripped.inner;
          stats.removedFormAttrs += stripped.removed;
          changed = true;
        }
      }
      if ((kind === "sweep" || kind === "pipe") && form === "inline") {
        const stripped = stripDirectChildren(nextInner, ["path"]);
        if (stripped.removed) {
          nextInner = stripped.inner;
          stats.removedFormAttrs += stripped.removed;
          changed = true;
        }
      }

      if (!changed) continue;

      const open =
        hit.selfClosing && !nextInner.trim()
          ? `<${tag}${serializeAttrMap(map)}/>`
          : `<${tag}${serializeAttrMap(map)}>`;
      const replacement = hit.selfClosing && !nextInner.trim()
        ? open
        : `${open}${nextInner}</${tag}>`;
      out = out.slice(0, hit.start) + replacement + out.slice(closeEnd);
    }
  }

  return out;
}

export function optimizeSvg3dxContent(content: string): OptimizeResult {
  const stats: OptimizeStats = {
    removedUses: 0,
    removedGroups: 0,
    removedContainers: 0,
    removedMaterials: 0,
    removedParams: 0,
    removedStyles: 0,
    removedClassAttrs: 0,
    removedFormAttrs: 0,
  };
  if (!content) {
    return { content, stats, changed: false };
  }

  let svg = content;

  // 1. Unset references
  svg = removeUnsetUses(svg, stats);

  // 2. Unreferenced defs groups (drops whole unused subtrees first)
  svg = removeUnreferencedDefsGroups(svg, stats);

  // 3. Empty containers then empty groups — iterate for nesting
  for (let guard = 0; guard < 64; guard += 1) {
    const before = svg;
    svg = removeEmptyContainers(svg, stats);
    svg = removeEmptyGroups(svg, stats);
    if (svg === before) break;
  }

  // Groups that lost their last use while emptying may now be unreferenced
  svg = removeUnreferencedDefsGroups(svg, stats);

  // 4. Materials & params
  svg = removeUnusedMaterials(svg, stats);
  svg = removeUnusedParams(svg, stats);

  // 5. Style rules with no parameters (incl. emptied by step 4)
  svg = removeEmptyStyleRules(svg, stats);

  // 6. class attrs pointing at styles that no longer exist
  svg = removeInvalidClassAttrs(svg, stats);

  // 7. sweep → child path only
  svg = normalizeSweepChildPath(svg, stats);

  // 8. form attrs / mismatched geometry parameters
  svg = normalizePrimitiveForms(svg, stats);

  return {
    content: svg,
    stats,
    changed: svg !== content,
  };
}
