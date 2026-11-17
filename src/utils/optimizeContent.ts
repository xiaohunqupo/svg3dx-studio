/**
 * Document structure cleanup for svg3dx Studio.
 *
 * Order (cheapest → dependents last):
 * 1. Unset `<s3dx:use>` (no href)
 * 2. Unreferenced top-level defs `<g id>`
 * 3. Empty bool / logic / loop containers, then empty `<g>`
 * 4. Unused document materials and CSS custom properties (params)
 */

import { extractDefsGroups } from "@/utils/styleClasses";
import { extractDocumentMaterials } from "@/utils/documentMaterials";
import { removeGroupById } from "@/utils/svgEdit";

export type OptimizeStats = {
  removedUses: number;
  removedGroups: number;
  removedContainers: number;
  removedMaterials: number;
  removedParams: number;
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

export function optimizeSvg3dxContent(content: string): OptimizeResult {
  const stats: OptimizeStats = {
    removedUses: 0,
    removedGroups: 0,
    removedContainers: 0,
    removedMaterials: 0,
    removedParams: 0,
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

  return {
    content: svg,
    stats,
    changed: svg !== content,
  };
}
