/**
 * Locate and update SVG/XML elements referenced by tree paths
 * (`defs:groupId` / `defs:groupId.0.1` / `material:id`). Attribute writes
 * patch the original open-tag text so the rest of the document formatting
 * is preserved.
 */

type OpenTag = {
  start: number;
  /** End index (exclusive) of the full open tag including `>` / `/>`. */
  end: number;
  /** Raw attribute text between tag name and `>` / `/>`. */
  attrs: string;
  selfClosing: boolean;
  /** Tag local name lowercased (e.g. `box`, `g`). */
  local: string;
};

export type PathLocator =
  | {
      kind: "group";
      groupId: string;
      /** Indices into successive element-child lists under the group. Empty = the `<g>` itself. */
      indices: number[];
    }
  | {
      kind: "model";
      modelId: string;
      /** Index of `<s3dx:use>` under the model; omit / empty = the model element. */
      useIndex?: number;
    }
  | {
      kind: "material";
      materialId: string;
    };

/** Parse `defs:groupId`, `defs:groupId.0.1`, `model:solid-view` / `model:solid-view.0`, or `material:id`. */
export function parseTreePath(path: string): PathLocator | null {
  if (path.startsWith("model:")) {
    const rest = path.slice(6);
    if (!rest) return null;
    const parts = rest.split(".");
    const modelId = parts[0];
    if (!modelId) return null;
    if (parts.length === 1) return { kind: "model", modelId };
    const useIndex = Number(parts[1]);
    if (!Number.isInteger(useIndex) || useIndex < 0) return null;
    return { kind: "model", modelId, useIndex };
  }

  if (path.startsWith("material:")) {
    const materialId = path.slice("material:".length).trim();
    if (!materialId) return null;
    return { kind: "material", materialId };
  }

  const raw = path.startsWith("defs:") ? path.slice(5) : path;
  if (!raw || raw.startsWith("i")) return null;
  const parts = raw.split(".");
  const groupId = parts[0];
  if (!groupId) return null;
  const indices: number[] = [];
  for (let i = 1; i < parts.length; i++) {
    const n = Number(parts[i]);
    if (!Number.isInteger(n) || n < 0) return null;
    indices.push(n);
  }
  return { kind: "group", groupId, indices };
}

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name.replace(/[:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

function localOfTag(rawName: string): string {
  const i = rawName.indexOf(":");
  return (i >= 0 ? rawName.slice(i + 1) : rawName).toLowerCase();
}

/** Find the open tag of `<g id="groupId">` (first match). */
function findGroupOpen(svg: string, groupId: string): OpenTag | null {
  const openRe = /<g\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    const attrs = m[1] ?? "";
    if (attrOf(attrs, "id") !== groupId) continue;
    const full = m[0];
    return {
      start: m.index,
      end: m.index + full.length,
      attrs,
      selfClosing: /\/\s*>$/.test(full),
      local: "g",
    };
  }
  return null;
}

/** Find `<s3dx:model id="modelId">` open tag. */
function findModelOpen(svg: string, modelId: string): OpenTag | null {
  const openRe = /<s3dx:model\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    const attrs = m[1] ?? "";
    if (attrOf(attrs, "id") !== modelId) continue;
    const full = m[0];
    return {
      start: m.index,
      end: m.index + full.length,
      attrs,
      selfClosing: /\/\s*>$/.test(full),
      local: "model",
    };
  }
  return null;
}

/** Find `<s3dx:material id="materialId">` open tag. */
function findMaterialOpen(svg: string, materialId: string): OpenTag | null {
  const openRe = /<s3dx:material\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    const attrs = m[1] ?? "";
    if (attrOf(attrs, "id") !== materialId) continue;
    const full = m[0];
    return {
      start: m.index,
      end: m.index + full.length,
      attrs,
      selfClosing: /\/\s*>$/.test(full),
      local: "material",
    };
  }
  return null;
}

/**
 * End of the element that starts at `open` (index after its closing tag,
 * or after self-closing open).
 */
function elementEnd(svg: string, open: OpenTag): number {
  if (open.selfClosing) return open.end;
  const name = open.local;
  // Match same local name with optional prefix: </g> or </s3dx:box>
  const tokenRe = new RegExp(
    `<(\\/?)(?:[\\w.-]+:)?${name}\\b[^>]*>`,
    "gi"
  );
  tokenRe.lastIndex = open.end;
  let depth = 1;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(svg))) {
    if (tm[1]) {
      depth -= 1;
      if (depth === 0) return tm.index + tm[0].length;
    } else if (!/\/\s*>$/.test(tm[0])) {
      depth += 1;
    }
  }
  return open.end;
}

/** Direct child element open tags inside parent (document order). */
function childOpens(svg: string, parent: OpenTag): OpenTag[] {
  if (parent.selfClosing) return [];
  const innerStart = parent.end;
  const closeEnd = elementEnd(svg, parent);
  const closeRe = new RegExp(
    `<\\/(?:[\\w.-]+:)?${parent.local}\\s*>`,
    "i"
  );
  const closeSlice = svg.slice(innerStart, closeEnd);
  const cm = closeRe.exec(closeSlice);
  const bodyEnd = cm ? innerStart + cm.index : closeEnd;
  return childOpensAccurate(svg, innerStart, bodyEnd);
}

function childOpensAccurate(
  svg: string,
  innerStart: number,
  bodyEnd: number
): OpenTag[] {
  const outs: OpenTag[] = [];
  const tokenRe = /<\/?([A-Za-z_][\w:.-]*)\b[^>]*>/g;
  const body = svg.slice(innerStart, bodyEnd);
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(body))) {
    const full = m[0];
    const rawName = m[1] ?? "";
    const isClose = full.startsWith("</");
    const selfClosing = /\/\s*>$/.test(full);
    if (isClose) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const attrsMatch = /^<[\w:.-]+\b([^>]*)\/?>/.exec(full);
      outs.push({
        start: innerStart + m.index,
        end: innerStart + m.index + full.length,
        attrs: attrsMatch?.[1] ?? "",
        selfClosing,
        local: localOfTag(rawName),
      });
    }
    if (!selfClosing) depth += 1;
  }
  return outs;
}

/** Normalize newlines to LF (CodeMirror always stores `\n`). */
export function normalizeXmlNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Smallest contiguous replacement that turns `from` into `to`
 * (shared prefix + suffix). Used so external sync / undo / redo
 * update CodeMirror locally instead of rewriting the whole doc.
 */
export function minimalStringChange(
  from: string,
  to: string
): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  const fromLen = from.length;
  const toLen = to.length;
  const minLen = Math.min(fromLen, toLen);
  let start = 0;
  while (start < minLen && from.charCodeAt(start) === to.charCodeAt(start)) {
    start += 1;
  }
  let endFrom = fromLen;
  let endTo = toLen;
  while (
    endFrom > start &&
    endTo > start &&
    from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)
  ) {
    endFrom -= 1;
    endTo -= 1;
  }
  return {
    from: start,
    to: endFrom,
    insert: to.slice(start, endTo),
  };
}

/** Locate a CSS rule inside the first `<style>` block. */
function findStyleRuleRange(
  content: string,
  ruleRe: RegExp
): { start: number; end: number } | null {
  const styleRe = /<style\b[^>]*>/i;
  const open = styleRe.exec(content);
  if (!open) return null;
  const bodyStart = open.index + open[0].length;
  const close = content.slice(bodyStart).search(/<\/style\s*>/i);
  if (close < 0) return null;
  const body = content.slice(bodyStart, bodyStart + close);
  const m = ruleRe.exec(body);
  if (!m) return null;
  return {
    start: bodyStart + m.index,
    end: bodyStart + m.index + m[0].length,
  };
}

/** Locate `:root { … }` inside the first `<style>` block. */
function findRootRuleRange(
  content: string
): { start: number; end: number } | null {
  return findStyleRuleRange(content, /:root\s*\{[^}]*\}/);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Locate `.className { … }` inside the first `<style>` block. */
function findClassRuleRange(
  content: string,
  className: string
): { start: number; end: number } | null {
  const cls = className.trim().replace(/^\./, "");
  if (!cls) return null;
  return findStyleRuleRange(
    content,
    new RegExp(`\\.${escapeRegExp(cls)}\\s*\\{[^}]*\\}`)
  );
}

/** Parse `style::root` / `style:.className` / legacy `style:groupId`. */
function stylePathTarget(
  path: string
): { kind: "root" } | { kind: "class"; name: string } | { kind: "group"; id: string } | null {
  if (!path.startsWith("style:")) return null;
  const rest = path.slice("style:".length);
  if (!rest) return null;
  if (rest === ":root" || rest === "root") return { kind: "root" };
  if (rest.startsWith(".")) {
    const name = rest.slice(1).trim();
    return name ? { kind: "class", name } : null;
  }
  return { kind: "group", id: rest };
}

export type TextRange = { start: number; end: number };

function openContains(
  content: string,
  open: OpenTag,
  offset: number
): boolean {
  return offset >= open.start && offset < elementEnd(content, open);
}

function deepestChildPath(
  content: string,
  open: OpenTag,
  path: string,
  offset: number
): string {
  const kids = childOpens(content, open);
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!;
    if (openContains(content, kid, offset)) {
      return deepestChildPath(content, kid, `${path}.${i}`, offset);
    }
  }
  return path;
}

function listMaterialIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<s3dx:material\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const id = attrOf(m[1] ?? "", "id");
    if (id) ids.push(id);
  }
  return ids;
}

function listModelIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<s3dx:model\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const id = attrOf(m[1] ?? "", "id");
    if (id) ids.push(id);
  }
  return ids;
}

function listDefsGroupIds(content: string): string[] {
  const ids: string[] = [];
  const defs = /<defs\b[^>]*>/i.exec(content);
  if (!defs) return ids;
  const bodyStart = defs.index + defs[0].length;
  const closeRel = content.slice(bodyStart).search(/<\/defs\s*>/i);
  const bodyEnd = closeRel >= 0 ? bodyStart + closeRel : content.length;
  // Top-level `<g id>` under defs only (depth 0).
  const body = content.slice(bodyStart, bodyEnd);
  const tokenRe = /<\/?g\b[^>]*\/?>/gi;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(body))) {
    const full = m[0];
    const selfClosing = /\/\s*>$/.test(full);
    if (full.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const attrsMatch = /^<g\b([^>]*)\/?>/i.exec(full);
      const id = attrOf(attrsMatch?.[1] ?? "", "id");
      if (id) ids.push(id);
    }
    if (!selfClosing) depth += 1;
  }
  return ids;
}

/**
 * Character range in `content` for a Studio tree path — full element
 * (open tag through matching close / self-closing), not just the open tag.
 * Offsets are only valid for the same newline convention as `content`
 * (prefer LF — match CodeMirror via {@link normalizeXmlNewlines}).
 */
export function findRangeForTreePath(
  content: string,
  path: string
): TextRange | null {
  if (!path) return null;
  if (path.startsWith("style:")) {
    const target = stylePathTarget(path);
    if (!target) return null;
    if (target.kind === "root") return findRootRuleRange(content);
    if (target.kind === "class") {
      return findClassRuleRange(content, target.name);
    }
    // Legacy: class styles keyed by the owning group id.
    const g = findGroupOpen(content, target.id);
    return g ? { start: g.start, end: elementEnd(content, g) } : null;
  }
  const open = findOpenTagAtPath(content, path);
  if (!open) return null;
  return { start: open.start, end: elementEnd(content, open) };
}

/**
 * Open / close tag ranges for a tree path (self-closing → `close` is null).
 * Used to highlight matching tags when the caret moves in the source editor.
 */
export function findTagPairRanges(
  content: string,
  path: string
): { open: TextRange; close: TextRange | null } | null {
  if (!path) return null;
  if (path.startsWith("style:")) {
    const target = stylePathTarget(path);
    if (!target) return null;
    if (target.kind === "root") {
      const root = findRootRuleRange(content);
      return root ? { open: root, close: null } : null;
    }
    if (target.kind === "class") {
      const rule = findClassRuleRange(content, target.name);
      return rule ? { open: rule, close: null } : null;
    }
    const g = findGroupOpen(content, target.id);
    if (!g) return null;
    return tagPairFromOpen(content, g);
  }
  const open = findOpenTagAtPath(content, path);
  if (!open) return null;
  return tagPairFromOpen(content, open);
}

function tagPairFromOpen(
  content: string,
  open: OpenTag
): { open: TextRange; close: TextRange | null } {
  const openRange = { start: open.start, end: open.end };
  if (open.selfClosing) return { open: openRange, close: null };
  const fullEnd = elementEnd(content, open);
  const inner = content.slice(open.end, fullEnd);
  const closeRe = new RegExp(`<\\/(?:[\\w.-]+:)?${open.local}\\s*>`, "gi");
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = closeRe.exec(inner))) last = m;
  if (!last || last.index === undefined) {
    return { open: openRange, close: null };
  }
  return {
    open: openRange,
    close: {
      start: open.end + last.index,
      end: open.end + last.index + last[0].length,
    },
  };
}

/**
 * Map a document offset to the deepest Studio tree path that contains it.
 * Returns null for positions outside materials / models / defs groups / :root.
 */
export function findTreePathAtOffset(
  content: string,
  offset: number
): string | null {
  if (offset < 0 || offset > content.length) return null;

  const root = findRootRuleRange(content);
  if (root && offset >= root.start && offset < root.end) {
    return "style::root";
  }

  const styleOpen = /<style\b[^>]*>/i.exec(content);
  if (styleOpen) {
    const bodyStart = styleOpen.index + styleOpen[0].length;
    const close = content.slice(bodyStart).search(/<\/style\s*>/i);
    if (close >= 0) {
      const body = content.slice(bodyStart, bodyStart + close);
      const ruleRe = /\.([A-Za-z_][\w-]*)\s*\{[^}]*\}/g;
      let rm: RegExpExecArray | null;
      while ((rm = ruleRe.exec(body))) {
        const start = bodyStart + rm.index;
        const end = start + rm[0].length;
        if (offset >= start && offset < end) {
          return `style:.${rm[1]}`;
        }
      }
    }
  }

  for (const id of listMaterialIds(content)) {
    const open = findMaterialOpen(content, id);
    if (open && openContains(content, open, offset)) {
      return `material:${id}`;
    }
  }

  for (const id of listModelIds(content)) {
    const open = findModelOpen(content, id);
    if (!open || !openContains(content, open, offset)) continue;
    const kids = childOpens(content, open);
    for (let i = 0; i < kids.length; i++) {
      if (openContains(content, kids[i]!, offset)) {
        return `model:${id}.${i}`;
      }
    }
    return `model:${id}`;
  }

  for (const id of listDefsGroupIds(content)) {
    const open = findGroupOpen(content, id);
    if (!open || !openContains(content, open, offset)) continue;
    return deepestChildPath(content, open, `defs:${id}`, offset);
  }

  return null;
}

/** Resolve open tag for a tree path. */
export function findOpenTagAtPath(
  content: string,
  path: string
): OpenTag | null {
  const locator = parseTreePath(path);
  if (!locator) return null;
  if (locator.kind === "model") {
    const model = findModelOpen(content, locator.modelId);
    if (!model) return null;
    if (locator.useIndex === undefined) return model;
    const kids = childOpens(content, model);
    return kids[locator.useIndex] ?? null;
  }
  if (locator.kind === "material") {
    return findMaterialOpen(content, locator.materialId);
  }
  let cur = findGroupOpen(content, locator.groupId);
  if (!cur) return null;
  for (const idx of locator.indices) {
    const kids = childOpens(content, cur);
    const next = kids[idx];
    if (!next) return null;
    cur = next;
  }
  return cur;
}

function parseAttrMap(attrs: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    out[m[1]!] = m[2] ?? m[3] ?? "";
  }
  return out;
}

function serializeAttrs(map: Record<string, string>, original: string): string {
  // Preserve original order for keys that remain; append new keys.
  const order: string[] = [];
  const seen = new Set<string>();
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"[^"]*"|'[^']*')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original))) {
    const name = m[1]!;
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  for (const name of Object.keys(map)) {
    if (!seen.has(name)) order.push(name);
  }
  const parts: string[] = [];
  for (const name of order) {
    const value = map[name];
    if (value === undefined) continue;
    const escaped = value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    parts.push(`${name}="${escaped}"`);
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** Read all attributes of the element at path into a flat string map. */
export function readAttrsAtPath(
  content: string,
  path: string
): Record<string, string> | null {
  const open = findOpenTagAtPath(content, path);
  if (!open) return null;
  return parseAttrMap(open.attrs);
}

/**
 * Apply attribute updates at path.
 * Empty / whitespace-only values remove the attribute (not written).
 */
export function applyAttrsAtPath(
  content: string,
  path: string,
  updates: Record<string, string>
): string | null {
  const open = findOpenTagAtPath(content, path);
  if (!open) return null;

  const map = parseAttrMap(open.attrs);
  for (const [name, raw] of Object.entries(updates)) {
    const value = raw.trim();
    if (!value) {
      delete map[name];
      // Also drop unprefixed duplicate if clearing s3dx:transform
      if (name === "s3dx:transform") delete map["transform"];
    } else {
      map[name] = value;
    }
  }

  const openSlice = content.slice(open.start, open.end);
  const nameMatch = /^<\/?([A-Za-z_][\w:.-]*)/.exec(openSlice);
  if (!nameMatch) return null;
  const tagName = nameMatch[1]!;
  const attrsText = serializeAttrs(map, open.attrs);
  const newOpen = open.selfClosing
    ? `<${tagName}${attrsText}/>`
    : `<${tagName}${attrsText}>`;

  return content.slice(0, open.start) + newOpen + content.slice(open.end);
}

/**
 * Remove the element at a tree path (open tag through close / self-closing),
 * including a trailing newline when present and leading indent on that line.
 */
export function removeElementAtPath(
  content: string,
  path: string
): string | null {
  const open = findOpenTagAtPath(content, path);
  if (!open) return null;
  let start = open.start;
  let end = elementEnd(content, open);
  if (content[end] === "\n") end += 1;
  else if (content.slice(end, end + 2) === "\r\n") end += 2;
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  if (content.slice(lineStart, start).trim() === "") start = lineStart;
  return content.slice(0, start) + content.slice(end);
}

/** Local tag without namespace prefix, lowercased. */
export function localTagName(tag: string): string {
  return localOfTag(tag);
}
