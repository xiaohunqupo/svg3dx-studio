import type { GeometryKind } from "@/types/file";

const NS = "urn:s3dx:draft:0.1";

const DEFAULT_SNIPPETS: Record<GeometryKind, string> = {
  box: `<s3dx:box length="100" width="60" height="40" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  cylinder: `<s3dx:cylinder diameter="60" bottomCenterPt="0 0 0" topCenterPt="0 0 100"/>`,
  sphere: `<s3dx:sphere radius="40" center="0 0 0"/>`,
  cone: `<s3dx:cone bottomDiameter="60" topDiameter="20" bottomCenterPt="0 0 0" topCenterPt="0 0 80"/>`,
  torus: `<s3dx:torus diameter1="80" diameter2="20" angle="360" torusCenterPt="0 0 0" normal="0 0 1"/>`,
  wedge: `<s3dx:wedge length="80" width="60" height="40" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  pyramid: `<s3dx:pyramid length="80" width="80" height="60" lengthVec="1 0 0" widthVec="0 1 0"/>`,
  prism: `<s3dx:prism length="80" width="60" height="40" sides="6" lengthVec="1 0 0" widthVec="0 1 0"/>`,
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
  const body = DEFAULT_SNIPPETS[kind];
  const group = `    <g id="${id}">\n      ${body}\n    </g>\n`;
  svg = insertGroupIntoDefs(svg, group);
  return referenceInActiveModel(svg, id);
}

export const PRIMITIVE_MENU: { kind: GeometryKind; label: string }[] = [
  { kind: "box", label: "长方体 Box" },
  { kind: "cylinder", label: "圆柱 Cylinder" },
  { kind: "sphere", label: "球体 Sphere" },
  { kind: "cone", label: "圆锥 Cone" },
  { kind: "torus", label: "圆环 Torus" },
  { kind: "wedge", label: "楔体 Wedge" },
  { kind: "pyramid", label: "棱锥 Pyramid" },
  { kind: "prism", label: "棱柱 Prism" },
];
