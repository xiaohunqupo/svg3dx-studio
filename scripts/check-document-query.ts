import assert from "node:assert/strict";
import { MATERIAL_LABELS } from "../src/i18n/vocab.ts";
import {
  applyAttrsToSnippet,
  applyNodeUpdates,
  canonicalMaterialAttribute,
  findNodeById,
  getNodeSchema,
  listDocumentNodes,
  materialView,
  resolveNodeHandle,
} from "../src/chat/documentQuery.ts";

const DOC = `<?xml version="1.0"?>
<svg svg3d="true" xmlns="http://www.w3.org/2000/svg" xmlns:s3dx="urn:s3dx:draft:0.2">
  <style>
    .skin { --material: url(#paint); }
  </style>
  <s3dx:materials>
    <s3dx:material id="paint" color="1 0 0 1" metalness="0" roughness="0.4"/>
  </s3dx:materials>
  <defs>
    <g id="head">
      <s3dx:sphere id="nose" radius="10" center="0 0 0"/>
      <s3dx:box id="brow" material="paint" length="1" width="1" height="1"/>
      <s3dx:box id="cheek" class="skin" material="steel" length="1" width="1" height="1"/>
    </g>
  </defs>
  <s3dx:model id="main" active="true">
    <s3dx:use href="#head"/>
  </s3dx:model>
</svg>
`;

const nose = findNodeById(DOC, "nose");
assert.equal(nose.length, 1);
assert.equal(nose[0]!.handle, "defs:head.0");
assert.equal(nose[0]!.role, "definition");
assert.equal(nose[0]!.kind, "sphere");
assert.equal(nose[0]!.instances.length, 1);
assert.equal(nose[0]!.instances[0]!.handle, "model:main.0");
assert.equal(nose[0]!.instances[0]!.href, "#head");

const guessed = resolveNodeHandle(DOC, "defs:nose");
assert.equal(guessed.ok, true);
if (guessed.ok) {
  assert.equal(guessed.handle, "defs:head.0");
  assert.equal(guessed.resolvedFromId, "nose");
}

const listed = listDocumentNodes(DOC, { scope: "definitions" });
assert.ok(listed.nodes.some((n) => n.id === "nose" && n.handle === "defs:head.0"));
assert.ok(!listed.nodes.some((n) => n.handle === "defs:nose"));
const instances = listDocumentNodes(DOC, { scope: "instances" });
assert.ok(instances.nodes.some((n) => n.role === "model" && n.id === "main"));
assert.ok(instances.nodes.some((n) => n.role === "instance" && n.href === "#head"));

const brow = materialView(DOC, "defs:head.1");
assert.ok(brow);
assert.equal(brow!.ownAttribute, "paint");
assert.equal(brow!.effective.fellBack, true);
assert.match(brow!.effective.reason ?? "", /url\(#paint\)/);

const canon = canonicalMaterialAttribute(DOC, "paint");
assert.equal(canon.ok, true);
if (canon.ok) assert.equal(canon.attribute, "url(#paint)");

const assigned = applyNodeUpdates(DOC, [
  { handle: "nose", updates: { material: "paint" } },
]);
assert.equal(assigned.ok, true);
if (assigned.ok) {
  const view = materialView(assigned.content, "defs:head.0");
  assert.equal(view?.ownAttribute, "url(#paint)");
  assert.equal(view?.effective.fellBack, false);
  assert.equal(view?.effective.effectiveId, "paint");
  assert.equal(view?.effective.source, "document");
}

const cheek = materialView(DOC, "defs:head.2");
assert.ok(cheek);
assert.equal(cheek!.ownAttribute, "steel");
assert.equal(cheek!.overridden, true);
assert.equal(cheek!.effective.effectiveId, "paint");
assert.equal(cheek!.effective.fellBack, false);
assert.equal(cheek!.effective.source, "document");

const prism = getNodeSchema("prism");
assert.equal(prism.ok, true);
if (prism.ok) {
  assert.ok(prism.schema.params.some((p) => p.name === "points" && p.default));
  assert.ok(prism.schema.params.some((p) => p.name === "height"));
  assert.ok(prism.schema.params.some((p) => p.name === "normal"));
  assert.match(prism.schema.coords, /Z-up/);
}

const bad = applyNodeUpdates(DOC, [
  { handle: "defs:head.0", updates: { radius: "4" } },
  { handle: "defs:head.1", updates: { material: "nope" } },
]);
assert.equal(bad.ok, false);
if (!bad.ok) assert.match(bad.message, /unknown material/);

const typo = applyNodeUpdates(DOC, [
  { handle: "defs:head.1", updates: { lengthh: "2" } },
]);
assert.equal(typo.ok, false);

const batch = applyNodeUpdates(DOC, [
  { handle: "defs:head.0", updates: { radius: "4" } },
  { handle: "brow", updates: { length: "8", material: "steel" } },
]);
assert.equal(batch.ok, true);
if (batch.ok) {
  assert.equal(batch.results.length, 2);
  assert.equal(batch.results[0]!.attrs?.radius, "4");
  assert.equal(batch.results[1]!.handle, "defs:head.1");
  assert.equal(batch.results[1]!.attrs?.length, "8");
  assert.equal(batch.results[1]!.attrs?.material, "steel");
  assert.equal(batch.results[1]!.material?.effective.fellBack, false);
}

for (const id of Object.keys(MATERIAL_LABELS)) {
  const builtin = canonicalMaterialAttribute("<svg/>", id);
  assert.equal(builtin.ok, true);
  if (builtin.ok) {
    assert.equal(builtin.source, "builtin");
    assert.equal(builtin.attribute, id);
  }
}

const patched = applyAttrsToSnippet(
  `<s3dx:prism points="0 0 0  1 0 0  0 1 0" height="100"/>`,
  { height: "40", id: "fin" }
);
assert.match(patched, /height="40"/);
assert.match(patched, /id="fin"/);
assert.match(patched, /points="0 0 0  1 0 0  0 1 0"/);

console.log("document query checks passed");
