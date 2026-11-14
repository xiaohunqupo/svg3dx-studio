import type { AddChildKind, GeometryKind } from "@/types/file";

const NS = "urn:s3dx:draft:0.1";

const DEFAULT_SNIPPETS: Record<GeometryKind, string> = {
  box: `<s3dx:box length="100" width="60" height="40" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  cylinder: `<s3dx:cylinder diameter="60" bottomCenterPt="0 0 0" topCenterPt="0 0 100"/>`,
  sphere: `<s3dx:sphere radius="40" center="0 0 0"/>`,
  cone: `<s3dx:cone bottomDiameter="60" topDiameter="20" bottomCenterPt="0 0 0" topCenterPt="0 0 80"/>`,
  torus: `<s3dx:torus diameter1="80" diameter2="20" angle="360" torusCenterPt="0 0 0" normal="0 0 1"/>`,
  wedge: `<s3dx:wedge length="80" width="60" height="40" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  pyramid: `<s3dx:pyramid length="80" width="80" height="60" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  prism: `<s3dx:prism points="0 0 0  60 0 0  60 40 0  0 40 0" height="40"/>`,
  cutcylinder: `<s3dx:cutcylinder diameter="60" bottomCenterPt="0 0 0" topCenterPt="0 0 100" angle="90"/>`,
};

function ensureSvgShell(content: string): string {
  const trimmed = content.trim();
  if (trimmed.includes("<svg")) return content;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" svg3d="true" viewBox="0 0 800 600"
     xmlns="http://www.w3.org/2000/svg"
     xmlns:s3dx="${NS}">
  <defs>
  </defs>
  <s3dx:model id="solid-view" mode="solid" active="true">
  </s3dx:model>
</svg>
`;
}

function nextGroupId(content: string, kind: string): string {
  const re = new RegExp(`id="(group-${kind}-\\d+)"`, "g");
  let max = 0;
  for (const m of content.matchAll(re)) {
    const n = Number(m[1].split("-").pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `group-${kind}-${max + 1}`;
}

function insertGroupIntoDefs(svg: string, groupXml: string): string {
  if (/<\/defs>/i.test(svg)) {
    return svg.replace(/<\/defs>/i, `${groupXml}  </defs>`);
  }
  if (/<defs[^>]*>/i.test(svg)) {
    return svg.replace(/<defs([^>]*)>/i, `<defs$1>\n${groupXml}`);
  }
  return svg.replace(/<svg([^>]*)>/i, `<svg$1>\n  <defs>\n${groupXml}  </defs>\n`);
}

function referenceInActiveModel(svg: string, groupId: string): string {
  const use = `    <s3dx:use href="#${groupId}"/>\n`;
  if (/<s3dx:model[^>]*active="true"[^>]*>/i.test(svg)) {
    return svg.replace(
      /(<s3dx:model[^>]*active="true"[^>]*>)/i,
      `$1\n${use}`
    );
  }
  if (/<\/s3dx:model>/i.test(svg)) {
    return svg.replace(/<\/s3dx:model>/i, `${use}  </s3dx:model>`);
  }
  return svg.replace(
    /<\/svg>/i,
    `  <s3dx:model id="solid-view" mode="solid" active="true">\n${use}  </s3dx:model>\n</svg>`
  );
}

function lineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

/**
 * Insert `childXml` before the matching close tag of `<g id="parentId">`.
 */
export function insertXmlIntoGroup(
  svg: string,
  parentId: string,
  childXml: string
): string {
  const openRe = /<g\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  let openEnd = -1;
  let selfClosing = false;
  let openAttrs = "";
  let openIndex = -1;

  while ((m = openRe.exec(svg))) {
    const attrs = m[1] ?? "";
    if (attr(attrs, "id") !== parentId) continue;
    openIndex = m.index;
    openEnd = m.index + m[0].length;
    openAttrs = attrs;
    selfClosing = /\/\s*>$/.test(m[0]);
    break;
  }
  if (openIndex < 0) return svg;

  const nl = lineEnding(svg);
  if (selfClosing) {
    const replacement = `<g${openAttrs}>${nl}${childXml}${nl}    </g>`;
    return svg.slice(0, openIndex) + replacement + svg.slice(openEnd);
  }

  let depth = 1;
  const tokenRe = /<\/?g\b[^>]*>/gi;
  tokenRe.lastIndex = openEnd;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(svg))) {
    const full = tm[0];
    if (/^<\//.test(full)) {
      depth -= 1;
      if (depth === 0) {
        const insertAt = tm.index;
        const pad = childXml.endsWith(nl) ? "" : nl;
        return (
          svg.slice(0, insertAt) + childXml + pad + svg.slice(insertAt)
        );
      }
      continue;
    }
    if (!/\/\s*>$/.test(full)) depth += 1;
  }
  return svg;
}

/** Insert an empty `<g>` into `<defs>` (not referenced by models). */
export function insertEmptyGroup(content: string): { content: string; id: string } {
  let svg = ensureSvgShell(content);
  const id = nextGroupId(svg, "new");
  const nl = lineEnding(svg);
  const group = `    <g id="${id}">${nl}    </g>${nl}`;
  svg = insertGroupIntoDefs(svg, group);
  return { content: svg, id };
}

/** Insert a primitive group into defs and reference it from the active model. */
export function insertPrimitive(content: string, kind: GeometryKind): string {
  let svg = ensureSvgShell(content);
  const id = nextGroupId(svg, kind);
  const nl = lineEnding(svg);
  const body = DEFAULT_SNIPPETS[kind];
  const group = `    <g id="${id}">${nl}      ${body}${nl}    </g>${nl}`;
  svg = insertGroupIntoDefs(svg, group);
  return referenceInActiveModel(svg, id);
}

export type InsertChildResult = {
  content: string;
  /** Present when a nested `<g id>` was created. */
  childId?: string;
  kind: AddChildKind;
};

/** Insert a nested group or basic solid into an existing `<g id>`. */
export function insertChildIntoGroup(
  content: string,
  parentGroupId: string,
  kind: AddChildKind
): InsertChildResult {
  const svg = ensureSvgShell(content);
  const nl = lineEnding(svg);

  if (kind === "group") {
    const id = nextGroupId(svg, "new");
    const child = `      <g id="${id}">${nl}      </g>${nl}`;
    return {
      content: insertXmlIntoGroup(svg, parentGroupId, child),
      childId: id,
      kind,
    };
  }

  const body = DEFAULT_SNIPPETS[kind];
  const child = `      ${body}${nl}`;
  return {
    content: insertXmlIntoGroup(svg, parentGroupId, child),
    kind,
  };
}

/** Span of `<g id="…">…</g>` (or self-closing), or null. */
function findGroupSpan(
  svg: string,
  groupId: string
): { start: number; end: number } | null {
  const openRe = /<g\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    const attrs = m[1] ?? "";
    if (attr(attrs, "id") !== groupId) continue;
    const full = m[0];
    const start = m.index;
    if (/\/\s*>$/.test(full)) {
      return { start, end: start + full.length };
    }
    let depth = 1;
    const tokenRe = /<\/?g\b[^>]*\/?>/gi;
    tokenRe.lastIndex = start + full.length;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(svg))) {
      const tok = tm[0];
      if (/^<\//.test(tok)) {
        depth -= 1;
        if (depth === 0) {
          return { start, end: tm.index + tok.length };
        }
      } else if (!/\/\s*>$/.test(tok)) {
        depth += 1;
      }
    }
    return null;
  }
  return null;
}

/**
 * Remove a `<g id>` and any `<s3dx:use href="#id">` references.
 * Nested markup inside the group is removed with it.
 */
export function removeGroupById(content: string, groupId: string): string {
  if (!groupId) return content;
  let svg = content;
  const span = findGroupSpan(svg, groupId);
  if (span) {
    let start = span.start;
    let end = span.end;
    // Trim a surrounding blank line when present.
    if (svg[end] === "\n") end += 1;
    else if (svg.slice(end, end + 2) === "\r\n") end += 2;
    svg = svg.slice(0, start) + svg.slice(end);
  }
  const useRe = new RegExp(
    `\\s*<s3dx:use\\b[^>]*\\bhref\\s*=\\s*[\"']#${groupId.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}[\"'][^>]*\\/?>`,
    "gi"
  );
  svg = svg.replace(useRe, "");
  return svg;
}

/** Basic solids listed in draft §3.2.2 (for menus). */
export const BASIC_SOLID_KINDS: GeometryKind[] = [
  "box",
  "cylinder",
  "sphere",
  "cone",
  "torus",
  "wedge",
  "prism",
  "cutcylinder",
  "pyramid",
];

export const PRIMITIVE_MENU: { kind: GeometryKind; labelZh: string; labelEn: string }[] =
  [
    { kind: "box", labelZh: "长方体", labelEn: "Box" },
    { kind: "cylinder", labelZh: "圆柱", labelEn: "Cylinder" },
    { kind: "sphere", labelZh: "球体", labelEn: "Sphere" },
    { kind: "cone", labelZh: "圆锥", labelEn: "Cone" },
    { kind: "torus", labelZh: "圆环", labelEn: "Torus" },
    { kind: "wedge", labelZh: "楔体", labelEn: "Wedge" },
    { kind: "prism", labelZh: "棱柱", labelEn: "Prism" },
    { kind: "cutcylinder", labelZh: "扇形柱", labelEn: "Cut Cylinder" },
    { kind: "pyramid", labelZh: "棱锥", labelEn: "Pyramid" },
  ];
