/** Minimal starter document — same shape as `samples/draft-0.1-box.svg3dx`. */

export const EMPTY_DOCUMENT_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1"
     svg3d="true"
     viewBox="0 0 800 600"
     xmlns="http://www.w3.org/2000/svg"
     xmlns:s3dx="urn:s3dx:draft:0.1">

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

/** Next free `untitled.svg3dx` / `untitled-2.svg3dx` … among existing names. */
export function nextUntitledName(existingNames: Iterable<string>): string {
  const taken = new Set(
    [...existingNames].map((n) => n.trim().toLowerCase())
  );
  if (!taken.has(UNTITLED)) return UNTITLED;
  for (let i = 2; ; i++) {
    const name = `untitled-${i}.svg3dx`;
    if (!taken.has(name)) return name;
  }
}
