/**
 * Document `<s3dx:material>` entries for the material attribute picker.
 */

export type DocMaterial = {
  id: string;
  /** Raw `color` attr when present (RGBA floats). */
  color?: string;
  metalness?: string;
  roughness?: string;
};

/** Parse `<s3dx:material id="…" color="…">` from SVG text. */
export function extractDocumentMaterials(svg: string): DocMaterial[] {
  if (!svg) return [];
  const out: DocMaterial[] = [];
  const seen = new Set<string>();
  const re = /<s3dx:material\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1] ?? "";
    const id = attrOf(attrs, "id");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      color: attrOf(attrs, "color") ?? undefined,
      metalness: attrOf(attrs, "metalness") ?? undefined,
      roughness: attrOf(attrs, "roughness") ?? undefined,
    });
  }
  return out;
}

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

/**
 * Normalize material attr for the picker: bare document ids → `url(#id)`.
 * Built-in keywords and existing `url(#…)` are unchanged.
 */
export function normalizeMaterialAttr(
  raw: string,
  documentIds: Iterable<string>
): string {
  const s = raw.trim();
  if (!s) return "";
  if (/^url\(\s*#/i.test(s)) return s;
  const ids = documentIds instanceof Set ? documentIds : new Set(documentIds);
  if (ids.has(s)) return `url(#${s})`;
  return s;
}

/** Rewrite `material="url(#old)"` / `material="old"` after a document material id rename. */
export function rewriteMaterialIdRefs(
  content: string,
  oldId: string,
  newId: string
): string {
  if (!oldId || !newId || oldId === newId) return content;
  const esc = oldId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = content.replace(
    new RegExp(`url\\(\\s*#${esc}\\s*\\)`, "gi"),
    `url(#${newId})`
  );
  out = out.replace(
    new RegExp(`(\\bmaterial\\s*=\\s*)(["'])${esc}\\2`, "gi"),
    `$1$2${newId}$2`
  );
  return out;
}
