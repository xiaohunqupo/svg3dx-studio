/** Minimal starter document for draft 0.2. */

export const EMPTY_DOCUMENT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1"
     svg3d="true"
     viewBox="0 0 800 600"
     xmlns="http://www.w3.org/2000/svg"
     xmlns:s3dx="urn:s3dx:draft:0.2">

  <style>
    :root { --length: 100; --width: 100; --height: 100; }
  </style>

  <defs>
    <g id="main">
      <s3dx:box length="var(--length)" width="var(--width)" height="var(--height)"
                lengthVec="1 0 0" widthVec="0 1 0"/>
    </g>
  </defs>

  <s3dx:model id="solid-view" mode="solid" active="true">
    <s3dx:use href="#main"/>
  </s3dx:model>
</svg>
`;

const UNTITLED = "untitled.svg3dx";

function takenNameSet(existingNames: Iterable<string>): Set<string> {
  return new Set([...existingNames].map((n) => n.trim().toLowerCase()));
}

/** Ensure a `.svg3dx` / `.svg3dxz` / `.svg` extension; default `.svg3dx`. */
export function ensureDocumentFileName(name: string): string {
  const trimmed = name.trim() || "untitled";
  if (/\.(svg3dxz|svg3dx|svg)$/i.test(trimmed)) return trimmed;
  return `${trimmed}.svg3dx`;
}

/** Next free `untitled.svg3dx` / `untitled-2.svg3dx` … among existing names. */
export function nextUntitledName(existingNames: Iterable<string>): string {
  return nextUniqueFileName(UNTITLED, existingNames);
}

/**
 * Next free name from a preferred base (`foo.svg3dx` → `foo-2.svg3dx` …).
 * Case-insensitive against existing names.
 */
export function nextUniqueFileName(
  preferred: string,
  existingNames: Iterable<string>
): string {
  const base = ensureDocumentFileName(preferred);
  const taken = takenNameSet(existingNames);
  if (!taken.has(base.toLowerCase())) return base;
  const stem = base.replace(/\.(svg3dxz|svg3dx|svg)$/i, "");
  const ext = base.slice(stem.length) || ".svg3dx";
  for (let i = 2; ; i++) {
    const name = `${stem}-${i}${ext}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Default duplicate name: `copy of X.svg3dx`, falling back to unique suffix. */
export function nextCopyFileName(
  sourceName: string,
  existingNames: Iterable<string>
): string {
  const base = ensureDocumentFileName(sourceName);
  const stem = base.replace(/\.(svg3dxz|svg3dx|svg)$/i, "");
  const ext = base.slice(stem.length) || ".svg3dx";
  return nextUniqueFileName(`copy of ${stem}${ext}`, existingNames);
}
