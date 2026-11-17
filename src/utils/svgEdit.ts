import type {
  AddChildKind,
  ContainerKind,
  GeometryKind,
} from "@/types/file";

const NS = "urn:s3dx:draft:0.1";

export type AddChildMenuItem = {
  kind: Exclude<AddChildKind, "group">;
  labelZh: string;
  labelEn: string;
};

const GEOMETRY_SNIPPETS: Record<GeometryKind, string> = {
  box: `<s3dx:box length="100" width="100" height="100" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  cylinder: `<s3dx:cylinder diameter="100" bottomCenterPt="0 0 0" topCenterPt="0 0 100"/>`,
  sphere: `<s3dx:sphere radius="50" center="0 0 0"/>`,
  cone: `<s3dx:cone bottomDiameter="100" topDiameter="40" bottomCenterPt="0 0 0" topCenterPt="0 0 100"/>`,
  torus: `<s3dx:torus diameter1="100" diameter2="25" angle="360" torusCenterPt="0 0 0" normal="0 0 1"/>`,
  wedge: `<s3dx:wedge length="100" width="100" height="100" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  pyramid: `<s3dx:pyramid length="100" width="100" height="100" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  prism: `<s3dx:prism points="0 0 0  100 0 0  100 100 0  0 100 0" height="100"/>`,
  "sector-cylinder": `<s3dx:sector-cylinder diameter="100" bottomCenterPt="0 0 0" topCenterPt="0 0 100" angle="90"/>`,
  line: `<s3dx:line from="0 0 0" to="100 0 0"/>`,
  arc: `<s3dx:arc center="0 0 0" normal="0 0 1" radius="100" xDir="1 0 0" startAngle="0" angle="90"/>`,
  path: `<s3dx:path>
        <s3dx:line from="0 0 0" to="100 0 0"/>
        <s3dx:arc center="100 0 50" normal="0 -1 0" radius="50" from="100 0 0" to="150 0 50"/>
        <s3dx:line from="150 0 50" to="150 0 100"/>
      </s3dx:path>`,
  extrude: `<s3dx:extrude origin="0 0 0" normal="0 0 1" length="100">
        <s3dx:section>
          <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z"/>
        </s3dx:section>
      </s3dx:extrude>`,
  revolve: `<s3dx:revolve axisOrigin="0 0 0" axisDir="0 1 0" angle="360">
        <s3dx:section>
          <path d="M 40 0 L 100 0 L 100 100 L 40 60 Z"/>
        </s3dx:section>
      </s3dx:revolve>`,
  loft: `<s3dx:loft solid="true" blend="linear">
        <s3dx:section origin="0 0 0" normal="0 0 1">
          <path d="M -50 -50 L 50 -50 L 50 50 L -50 50 Z"/>
        </s3dx:section>
        <s3dx:section origin="0 0 100" normal="0 0 1">
          <circle cx="0" cy="0" r="40"/>
        </s3dx:section>
      </s3dx:loft>`,
  sweep: `<s3dx:sweep orient="frenet" solid="true" corner="arc" cornerRadius="50">
        <s3dx:section>
          <path d="M -20 -10 L 20 -10 L 20 10 L -20 10 Z"/>
        </s3dx:section>
        <s3dx:path points="0 0 0  100 0 0  100 0 100"/>
      </s3dx:sweep>`,
  pipe: `<s3dx:pipe radius="20" innerRadius="16" corner="arc" cornerRadius="50">
        <s3dx:path points="0 0 0  100 0 0  100 0 100"/>
      </s3dx:pipe>`,
};

const CONTAINER_SNIPPETS: Record<ContainerKind, string> = {
  "bool-union": `<s3dx:bool-union>
      </s3dx:bool-union>`,
  "bool-subtract": `<s3dx:bool-subtract>
      </s3dx:bool-subtract>`,
  "bool-intersect": `<s3dx:bool-intersect>
      </s3dx:bool-intersect>`,
  if: `<s3dx:if test="true">
      </s3dx:if>`,
  "if-not": `<s3dx:if-not test="false">
      </s3dx:if-not>`,
  "loop-points": `<s3dx:loop-points points="0 0 0  100 0 0  100 100 0  0 100 0">
      </s3dx:loop-points>`,
  "loop-range": `<s3dx:loop-range start="0" end="3" step="1">
      </s3dx:loop-range>`,
};

const DEFAULT_SNIPPETS: Record<Exclude<AddChildKind, "group">, string> = {
  ...GEOMETRY_SNIPPETS,
  ...CONTAINER_SNIPPETS,
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

function nextModelId(content: string): string {
  const used = new Set<string>();
  const re = /<s3dx:model\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const id = attr(m[1] ?? "", "id");
    if (id) used.add(id);
  }
  let n = 1;
  while (used.has(`view-${n}`)) n += 1;
  return `view-${n}`;
}

/** Insert an empty `<s3dx:model>` before `</svg>`. */
export function insertEmptyModel(content: string): { content: string; id: string } {
  let svg = ensureSvgShell(content);
  const id = nextModelId(svg);
  const nl = lineEnding(svg);
  const block = `  <s3dx:model id="${id}" mode="solid">${nl}  </s3dx:model>${nl}`;
  if (/<\/svg>/i.test(svg)) {
    svg = svg.replace(/<\/svg>/i, `${block}</svg>`);
  } else {
    svg = `${svg}${nl}${block}`;
  }
  return { content: svg, id };
}

function nextMaterialId(content: string): string {
  const used = new Set<string>();
  const re = /<s3dx:material\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const id = attr(m[1] ?? "", "id");
    if (id) used.add(id);
  }
  let n = 1;
  while (used.has(`material-${n}`)) n += 1;
  return `material-${n}`;
}

/** Insert an empty `<s3dx:material>` into `<s3dx:materials>` (creates the block if needed). */
export function insertEmptyMaterial(
  content: string
): { content: string; id: string } {
  let svg = ensureSvgShell(content);
  const id = nextMaterialId(svg);
  const nl = lineEnding(svg);
  const mat = `    <s3dx:material id="${id}" color="0.7 0.7 0.7 1" metalness="0" roughness="0.5"/>${nl}`;

  if (/<\/s3dx:materials>/i.test(svg)) {
    svg = svg.replace(/<\/s3dx:materials>/i, `${mat}  </s3dx:materials>`);
    return { content: svg, id };
  }

  const selfClose = /<s3dx:materials\b([^>]*)\/>/i.exec(svg);
  if (selfClose) {
    const open = selfClose[0].replace(/\/\s*>$/, ">");
    const replacement = `${open}${nl}${mat}  </s3dx:materials>`;
    svg =
      svg.slice(0, selfClose.index) +
      replacement +
      svg.slice(selfClose.index + selfClose[0].length);
    return { content: svg, id };
  }

  const block = `  <s3dx:materials>${nl}${mat}  </s3dx:materials>${nl}`;
  if (/<defs\b/i.test(svg)) {
    svg = svg.replace(/<defs\b/i, `${block}<defs`);
  } else if (/<\/svg>/i.test(svg)) {
    svg = svg.replace(/<\/svg>/i, `${block}</svg>`);
  } else {
    svg = `${svg}${nl}${block}`;
  }
  return { content: svg, id };
}

/** Span of `<s3dx:model id="…">…</s3dx:model>` (or self-closing), or null. */
function findModelSpan(
  svg: string,
  modelId: string
): { start: number; end: number } | null {
  const openRe = /<s3dx:model\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(svg))) {
    if (attr(m[1] ?? "", "id") !== modelId) continue;
    const full = m[0];
    const start = m.index;
    if (/\/\s*>$/.test(full)) {
      return { start, end: start + full.length };
    }
    let depth = 1;
    const tokenRe = /<\/?s3dx:model\b[^>]*>/gi;
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

/** Remove an `<s3dx:model id>` block. */
export function removeModelById(content: string, modelId: string): string {
  if (!modelId) return content;
  const span = findModelSpan(content, modelId);
  if (!span) return content;
  let start = span.start;
  let end = span.end;
  // Trim a surrounding blank line when present.
  if (content[end] === "\n") end += 1;
  else if (content.slice(end, end + 2) === "\r\n") end += 2;
  return content.slice(0, start) + content.slice(end);
}

/**
 * Insert `<s3dx:use>` into a model. `href` may be bare id or `#id`; empty allowed.
 */
export function insertUseIntoModel(
  content: string,
  modelId: string,
  href = ""
): { content: string; href: string } {
  let svg = ensureSvgShell(content);
  const bare = href.trim().replace(/^#/, "");
  const hrefAttr = bare ? `#${bare}` : "";
  const nl = lineEnding(svg);
  const use = `    <s3dx:use href="${hrefAttr}"/>${nl}`;

  const openRe = /<s3dx:model\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  let openEnd = -1;
  let selfClosing = false;
  let openIndex = -1;
  let openFull = "";
  while ((m = openRe.exec(svg))) {
    if (attr(m[1] ?? "", "id") !== modelId) continue;
    openIndex = m.index;
    openFull = m[0];
    openEnd = m.index + m[0].length;
    selfClosing = /\/\s*>$/.test(m[0]);
    break;
  }
  if (openIndex < 0) return { content: svg, href: hrefAttr };

  if (selfClosing) {
    const openTag = openFull.replace(/\/\s*>$/, ">");
    const replacement = `${openTag}${nl}${use}  </s3dx:model>`;
    svg = svg.slice(0, openIndex) + replacement + svg.slice(openEnd);
    return { content: svg, href: hrefAttr };
  }

  let depth = 1;
  const tokenRe = /<\/?s3dx:model\b[^>]*>/gi;
  tokenRe.lastIndex = openEnd;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(svg))) {
    const full = tm[0];
    if (/^<\//.test(full)) {
      depth -= 1;
      if (depth === 0) {
        svg = svg.slice(0, tm.index) + use + svg.slice(tm.index);
        return { content: svg, href: hrefAttr };
      }
      continue;
    }
    if (!/\/\s*>$/.test(full)) depth += 1;
  }
  return { content: svg, href: hrefAttr };
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
  if (!body) {
    return { content: svg, kind };
  }
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

/** Curves / wire — draft §3.2.3 (menu: 二维图元). */
export const CURVE_MENU: AddChildMenuItem[] = [
  { kind: "line", labelZh: "直线", labelEn: "Line" },
  { kind: "arc", labelZh: "圆弧", labelEn: "Arc" },
  { kind: "path", labelZh: "路径", labelEn: "Path" },
];

/** Basic solids — draft §3.2.2 (menu: 三维图元). */
export const SOLID_MENU: AddChildMenuItem[] = [
  { kind: "box", labelZh: "长方体", labelEn: "Box" },
  { kind: "cylinder", labelZh: "圆柱", labelEn: "Cylinder" },
  { kind: "sphere", labelZh: "球体", labelEn: "Sphere" },
  { kind: "cone", labelZh: "圆锥", labelEn: "Cone" },
  { kind: "torus", labelZh: "圆环", labelEn: "Torus" },
  { kind: "wedge", labelZh: "楔体", labelEn: "Wedge" },
  { kind: "prism", labelZh: "棱柱", labelEn: "Prism" },
  { kind: "sector-cylinder", labelZh: "扇形柱", labelEn: "Sector Cylinder" },
  { kind: "pyramid", labelZh: "棱锥", labelEn: "Pyramid" },
];

/** Construction solids — draft §3.2.4 (menu: 造型图元). */
export const MODELING_MENU: AddChildMenuItem[] = [
  { kind: "extrude", labelZh: "拉伸", labelEn: "Extrude" },
  { kind: "revolve", labelZh: "旋转", labelEn: "Revolve" },
  { kind: "loft", labelZh: "放样", labelEn: "Loft" },
  { kind: "sweep", labelZh: "扫掠", labelEn: "Sweep" },
  { kind: "pipe", labelZh: "圆管", labelEn: "Pipe" },
];

/** Boolean ops — 并集 / 差集 / 交集. */
export const BOOL_MENU: AddChildMenuItem[] = [
  { kind: "bool-union", labelZh: "并集", labelEn: "Union" },
  { kind: "bool-subtract", labelZh: "差集", labelEn: "Subtract" },
  { kind: "bool-intersect", labelZh: "交集", labelEn: "Intersect" },
];

export const LOGIC_MENU: AddChildMenuItem[] = [
  { kind: "if", labelZh: "如果", labelEn: "If" },
  { kind: "if-not", labelZh: "如果非", labelEn: "If not" },
];

export const LOOP_MENU: AddChildMenuItem[] = [
  { kind: "loop-points", labelZh: "点列循环", labelEn: "Loop points" },
  { kind: "loop-range", labelZh: "范围循环", labelEn: "Loop range" },
];

/** All insertable geometry kinds (curves + solids + modeling). */
export const PRIMITIVE_MENU: AddChildMenuItem[] = [
  ...CURVE_MENU,
  ...SOLID_MENU,
  ...MODELING_MENU,
];

/** Every non-group add-child kind (for type guards / menus). */
export const ADD_CHILD_MENU: AddChildMenuItem[] = [
  ...PRIMITIVE_MENU,
  ...BOOL_MENU,
  ...LOGIC_MENU,
  ...LOOP_MENU,
];

/** @deprecated Prefer SOLID_MENU; kept for callers expecting solid list. */
export const BASIC_SOLID_KINDS: GeometryKind[] = SOLID_MENU.map(
  (p) => p.kind as GeometryKind
);
