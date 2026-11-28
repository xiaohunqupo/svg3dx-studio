import assert from "node:assert/strict";
import { applyDocumentEdits } from "../src/chat/documentEdits.ts";
import { MATERIAL_LABELS } from "../src/i18n/vocab.ts";
import {
  applyAttrsToSnippet,
  applyNodeUpdates,
  assignMissingNodeIds,
  canonicalMaterialAttribute,
  findNodeById,
  getNodeSchema,
  listDocumentNodes,
  materialView,
  parseXyzList,
  prismPolygonNormal,
  resolveNodeHandle,
  RUNTIME_WARNING_SCOPE,
  validateDocument,
} from "../src/chat/documentQuery.ts";
import { ensureSnippetId } from "../src/utils/svgEdit.ts";

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
  const points = prism.schema.params.find((p) => p.name === "points");
  const height = prism.schema.params.find((p) => p.name === "height");
  const normal = prism.schema.params.find((p) => p.name === "normal");
  assert.ok(points?.insertDefault);
  assert.equal("default" in (height ?? {}), false);
  assert.equal(height?.insertDefault, "100");
  assert.equal(points?.type, "xyz-list");
  assert.equal(points?.required, true);
  assert.equal(points?.minCount, 3);
  assert.match(points?.onInvalid ?? "", /[Rr]evers/);
  assert.equal(height?.whenOmitted, "1");
  assert.match(normal?.whenOmitted ?? "", /p1-p0/);
  assert.match(prism.schema.coords, /Z-up/);
  assert.ok(prism.schema.params.some((p) => p.name === "s3dx:transform"));
}

const useSchema = getNodeSchema("use");
assert.equal(useSchema.ok, true);
if (useSchema.ok) {
  assert.ok(useSchema.schema.params.some((p) => p.name === "href"));
  assert.ok(useSchema.schema.params.some((p) => p.name === "s3dx:transform"));
}
const transform = getNodeSchema("transform");
assert.equal(transform.ok, true);
if (transform.ok) {
  assert.equal(transform.schema.kind, "s3dx:transform");
  assert.equal(transform.schema.shared, true);
  assert.match(transform.schema.params[0]?.note ?? "", /T · R · S/);
  assert.match(transform.schema.params[0]?.note ?? "", /Rz · Ry · Rx/);
  assert.match(transform.schema.params[0]?.note ?? "", /rotate\(90 90 0\)/);
  assert.match(
    transform.schema.params[0]?.note ?? "",
    /matrix\(0 0 -1 1 0 0 0 -1 0 0 0 0\)/
  );
  assert.match(transform.schema.params[0]?.note ?? "", /column vector/);
  assert.equal(transform.schema.params[0]?.whenOmitted, "identity");
}
const shared = getNodeSchema("shared");
assert.equal(shared.ok, true);
if (shared.ok) {
  assert.ok(shared.schema.params.some((p) => p.name === "material"));
  assert.ok(shared.schema.params.some((p) => p.name === "s3dx:transform"));
}

const forward = prismPolygonNormal([
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
]);
const reversed = prismPolygonNormal([
  [0, 0, 0],
  [0, 1, 0],
  [1, 0, 0],
]);
const degenerate = prismPolygonNormal(parseXyzList("0 0 0  1 0 0  2 0 0"));
assert.ok(forward && forward[2] > 0.9);
assert.ok(reversed && reversed[2] < -0.9);
assert.deepEqual(degenerate, [0, 0, 1]);

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

const OLIVE = `<?xml version="1.0"?>
<svg svg3d="true" xmlns="http://www.w3.org/2000/svg" xmlns:s3dx="urn:s3dx:draft:0.2">
  <s3dx:materials>
    <s3dx:material id="olive-paint" color="0.4 0.45 0.2 1" metalness="0" roughness="0.6"/>
  </s3dx:materials>
  <defs>
    <g id="body">
      <s3dx:box id="fuselage" material="olive-paint" length="2" width="2" height="2"/>
      <s3dx:prism id="fin" points="0 0 0  1 0 0" height="1"/>
    </g>
  </defs>
  <s3dx:model id="ship" active="true">
    <s3dx:use href="#body"/>
    <s3dx:use href="#body" material="steel"/>
    <s3dx:use href="#missing"/>
  </s3dx:model>
</svg>
`;

const olive = validateDocument(OLIVE);
const bare = olive.issues.filter((i) => i.code === "material.bare-document-id");
assert.equal(bare.length, 1);
assert.equal(bare[0]!.id, "fuselage");
assert.equal(bare[0]!.attribute, "material");
assert.equal(bare[0]!.fix, "url(#olive-paint)");
assert.equal("ok" in olive, false);
assert.equal(olive.documentValid, false);
assert.deepEqual(olive.repairs, [
  { op: "update", handle: "fuselage", updates: { material: "url(#olive-paint)" } },
]);
const repaired = applyDocumentEdits(OLIVE, olive.repairs);
assert.equal(repaired.ok, true);
if (repaired.ok) {
  assert.equal(repaired.undo, "single");
  const again = validateDocument(repaired.content);
  assert.equal(
    again.issues.some((i) => i.code === "material.bare-document-id"),
    false
  );
  assert.equal(materialView(repaired.content, "defs:body.0")?.ownAttribute, "url(#olive-paint)");
}
assert.equal(OLIVE.includes("url(#olive-paint)"), false);
assert.ok(olive.issues.some((i) => i.code === "prism.too-few-points" && i.id === "fin"));
assert.ok(olive.issues.some((i) => i.code === "use.unknown-target"));
assert.equal(
  olive.issues.filter((i) => i.handle === "model:ship.1" && i.attribute === "material").length,
  0
);
assert.match(RUNTIME_WARNING_SCOPE, /material-reference/);
const runtimeWarnings: string[] = [];
assert.equal(runtimeWarnings.length, 0);
assert.ok(olive.errorCount > 0);

const fuselage = materialView(OLIVE, "defs:body.0");
assert.equal(fuselage?.ownAttribute, "olive-paint");
assert.equal(fuselage?.effective.fellBack, true);
const override = materialView(OLIVE, "model:ship.1");
assert.equal(override?.ownAttribute, "steel");
assert.equal(override?.effective.effectiveId, "steel");
assert.equal(override?.effective.fellBack, false);
assert.equal(materialView(OLIVE, "defs:body.0")?.ownAttribute, "olive-paint");

const BOXES = `<?xml version="1.0"?>
<svg svg3d="true" xmlns="http://www.w3.org/2000/svg" xmlns:s3dx="urn:s3dx:draft:0.2">
  <defs>
    <g id="main">
      <s3dx:box id="a" length="1" width="1" height="1"/>
      <s3dx:box id="b" length="1" width="1" height="1"/>
      <s3dx:box id="c" length="1" width="1" height="1"/>
    </g>
  </defs>
</svg>
`;

const stale = applyDocumentEdits(BOXES, [
  { op: "delete", handle: "defs:main.0" },
  { op: "update", handle: "defs:main.1", updates: { length: "9" } },
]);
assert.equal(stale.ok, false);
if (!stale.ok) assert.equal(stale.code, "handle.stale");
assert.match(BOXES, /id="a"/);
assert.match(BOXES, /id="c"/);

const edited = applyDocumentEdits(BOXES, [
  { op: "delete", handle: "a" },
  { op: "update", handle: "b", updates: { length: "9" } },
]);
assert.equal(edited.ok, true);
if (edited.ok) {
  assert.equal(edited.content.includes('id="a"'), false);
  assert.match(edited.content, /id="b"/);
  assert.match(edited.content, /length="9"/);
  assert.match(edited.content, /id="c"/);
  assert.equal(edited.undo, "single");
}

const rejected = applyDocumentEdits(BOXES, [
  { op: "insert", parent: "defs:main", kind: "sphere", attrs: { id: "ear", radius: "1" } },
  { op: "update", handle: "ear", updates: { material: "nope" } },
]);
assert.equal(rejected.ok, false);
if (!rejected.ok) assert.equal(rejected.code, "attr.invalid");
assert.equal(BOXES.includes("ear"), false);

const made = applyDocumentEdits(BOXES, [
  { op: "insert", parent: "defs:main", kind: "sphere", attrs: { radius: "3" } },
]);
assert.equal(made.ok, true);
if (made.ok) {
  assert.equal(made.results[0]!.id, "sphere-1");
  assert.match(made.content, /id="sphere-1"/);
}

const moved = applyDocumentEdits(BOXES, [
  { op: "insert", parent: "defs:main", kind: "group", attrs: { id: "pocket" } },
  { op: "move", handle: "c", parent: "pocket" },
]);
assert.equal(moved.ok, true);
if (moved.ok) {
  assert.match(moved.content, /<g id="pocket">[\s\S]*id="c"/);
  assert.equal(moved.undo, "single");
}

const BARE = `<?xml version="1.0"?>
<svg svg3d="true" xmlns="http://www.w3.org/2000/svg" xmlns:s3dx="urn:s3dx:draft:0.2">
  <defs>
    <g id="main">
      <s3dx:box length="1" width="1" height="1"/>
    </g>
  </defs>
</svg>
`;
const bareReport = validateDocument(BARE);
const missing = bareReport.issues.find((i) => i.code === "id.missing");
assert.equal(missing?.fix, "box-1");
assert.deepEqual(missing?.repair, {
  op: "update",
  handle: "defs:main.0",
  updates: { id: "box-1" },
});
assert.equal(bareReport.repairs.length, 0);
assert.equal(bareReport.documentValid, true);
const filled = assignMissingNodeIds(BARE);
assert.equal(filled.assigned[0]!.id, "box-1");
assert.match(filled.content, /id="box-1"/);
assert.equal(
  validateDocument(filled.content).issues.some((i) => i.code === "id.missing"),
  false
);

const stamped = ensureSnippetId(
  `<s3dx:box length="1" width="1" height="1"/>`,
  BARE,
  "box"
);
assert.equal(stamped.id, "box-1");
assert.match(stamped.snippet, /id="box-1"/);

console.log("document query checks passed");
