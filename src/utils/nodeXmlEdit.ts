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
