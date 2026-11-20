import * as THREE from "three";
import {
  PlaneHelper,
  parseSectionShapes2D,
  sectionFrame,
  setPickData,
  REVOLVE_DEFAULT_SECTION_XF,
  type Value,
} from "svg3dx-viewer";
import {
  parseTransform12,
  matrix4ToMat4x3,
  matrix12ToTransformAttr,
} from "@/utils/nodeSchema";
import {
  listChildOpensAtPath,
  nodeKindAtPath,
  readAttrsAtPath,
} from "@/utils/nodeXmlEdit";

/** Light green fill for section XOY (distinct from selection gold / world blue-gray). */
const SECTION_PLANE_COLOR = 0x86efac;
/** Profile wire color for section 2D children (editor overlay). */
const SECTION_PROFILE_COLOR = 0x0f766e;

const SECTION_SHAPE_TAGS = new Set([
  "path",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "rect",
]);

const REVOLVE_DEFAULT_XF = mat4From12(REVOLVE_DEFAULT_SECTION_XF);

function mat4From12(m: ArrayLike<number>): THREE.Matrix4 {
  const mat = new THREE.Matrix4();
  mat.set(
    Number(m[0]),
    Number(m[3]),
    Number(m[6]),
    Number(m[9]),
    Number(m[1]),
    Number(m[4]),
    Number(m[7]),
    Number(m[10]),
    Number(m[2]),
    Number(m[5]),
    Number(m[8]),
    Number(m[11]),
    0,
    0,
    0,
    1
  );
  return mat;
}

function parseVec3Attr(
  raw: string | undefined,
  fallback: [number, number, number]
): THREE.Vector3 {
  if (!raw?.trim()) return new THREE.Vector3(...fallback);
  const parts = raw.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return new THREE.Vector3(...fallback);
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (![x, y, z].every(Number.isFinite)) return new THREE.Vector3(...fallback);
  return new THREE.Vector3(x, y, z);
}

/** Section-local pose frame as a Matrix4 (default = XY identity). */
function poseFrameMatrix(attrs: Record<string, string>): THREE.Matrix4 {
  const origin = parseVec3Attr(attrs.origin, [0, 0, 0]);
  const normal = parseVec3Attr(attrs.normal, [0, 0, 1]);
  const xDir = parseVec3Attr(attrs.xDir, [1, 0, 0]);
  const f = sectionFrame(origin, normal, xDir);
  const m = new THREE.Matrix4();
  m.makeBasis(f.x, f.y, f.n);
  m.setPosition(f.origin);
  return m;
}

function sectionTransformMatrix(
  attrs: Record<string, string>,
  parentKind: string | null
): THREE.Matrix4 {
  const raw = (attrs["s3dx:transform"] ?? attrs.transform ?? "").trim();
  if (raw) {
    const nums = parseTransform12(raw);
    if (nums) return mat4From12(nums);
  }
  // Unset transform under revolve → XY→XOZ default orientation.
  if (parentKind === "revolve") return REVOLVE_DEFAULT_XF.clone();
  return new THREE.Matrix4();
}

function planeSizeFor(parent: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(parent);
  if (box.isEmpty()) return 120;
  const s = box.getSize(new THREE.Vector3());
  const m = Math.max(s.x, s.y, s.z, 40);
  return Math.min(Math.max(m * 1.15, 80), 400);
}

export function parentTreePath(path: string): string | null {
  const i = path.lastIndexOf(".");
  if (i < 0) return null;
  return path.slice(0, i);
}

export function isSectionPath(content: string, path: string | null | undefined): boolean {
  if (!path || !content) return false;
  return nodeKindAtPath(content, path)?.kind === "section";
}

/** Nearest ancestor path that is a `<s3dx:section>`, or the path itself. */
export function sectionAncestorPath(
  content: string,
  path: string | null | undefined
): string | null {
  let p = path ?? null;
  while (p) {
    if (isSectionPath(content, p)) return p;
    p = parentTreePath(p);
  }
  return null;
}

/** Direct child `<s3dx:section>` paths under a construct (e.g. revolve). */
export function listSectionChildPaths(content: string, parentPath: string): string[] {
  return listChildOpensAtPath(content, parentPath)
    .map((c, i) => (c.local === "section" ? `${parentPath}.${i}` : null))
    .filter((p): p is string => !!p);
}

function shapeValueFromOpen(
  local: string,
  attrs: Record<string, string>
): Record<string, Value> {
  const out: Record<string, Value> = { tag: local };
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "d" || k === "points") {
      out[k] = v;
      continue;
    }
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : v;
  }
  return out;
}

function tagSectionProxy(
  obj: THREE.Object3D,
  path: string,
  extra?: { sectionProfile?: boolean }
): void {
  setPickData(obj, {
    treePath: path,
    defsPath: path.startsWith("defs:") ? path : undefined,
  });
  obj.userData.sectionProxy = true;
  if (extra?.sectionProfile) obj.userData.sectionProfile = true;
}

/**
 * Proxy Object3D for a `<s3dx:section>`: carries `s3dx:transform`, with a light-green
 * XOY plane (pose frame) as child, plus editor-only profile wires for 2D shapes.
 * Parent under the construct solid so the gizmo edits section-local transform.
 */
export class SectionProxy {
  readonly root: THREE.Group;
  readonly path: string;
  private readonly planeHost: THREE.Group;
  private plane: PlaneHelper;
  private readonly profiles = new THREE.Group();
  private readonly profileByPath = new Map<string, THREE.Object3D>();

  constructor(path: string, size: number) {
    this.path = path;
    this.root = new THREE.Group();
    this.root.name = `section-proxy:${path}`;
    // TransformControls edits position/quaternion/scale — keep auto-update on.
    this.root.matrixAutoUpdate = true;
    this.planeHost = new THREE.Group();
    this.planeHost.name = "section-pose-frame";
    this.planeHost.matrixAutoUpdate = false;
    this.plane = new PlaneHelper(size, SECTION_PLANE_COLOR);
    this.plane.name = "section-xoy-plane";
    // Soft fill — readable but not confused with selection gold.
    const fill = this.plane.children.find(
      (c) => (c as THREE.Mesh).isMesh
    ) as THREE.Mesh | undefined;
    if (fill?.material && !Array.isArray(fill.material)) {
      (fill.material as THREE.MeshBasicMaterial).opacity = 0.2;
    }
    this.profiles.name = "section-profiles";
    this.planeHost.add(this.plane);
    this.planeHost.add(this.profiles);
    this.root.add(this.planeHost);
    tagSectionProxy(this.root, path);
    this.root.traverse((c) => {
      if (c.userData.sectionProfile) return;
      tagSectionProxy(c, path);
    });
  }

  /** Drawable objects for a section or one of its 2D children. */
  highlightObjects(path: string): THREE.Object3D[] {
    if (path === this.path) {
      const objects: THREE.Object3D[] = [];
      this.plane.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) objects.push(mesh);
        const line = obj as THREE.Line;
        if (line.isLine) objects.push(line);
      });
      return objects;
    }
    const profile = this.profileByPath.get(path);
    return profile ? [profile] : [];
  }

  /** Place under `parent` using section attrs from the document. */
  syncFromDocument(content: string, parent: THREE.Object3D): void {
    const attrs = readAttrsAtPath(content, this.path) ?? {};
    const parentKind =
      parentTreePath(this.path) != null
        ? nodeKindAtPath(content, parentTreePath(this.path)!)?.kind ?? null
        : null;
    const T = sectionTransformMatrix(attrs, parentKind);
    const F = poseFrameMatrix(attrs);

    // Must decompose: TransformControls / updateMatrix() read TRS, not raw .matrix.
    T.decompose(this.root.position, this.root.quaternion, this.root.scale);
    this.root.updateMatrix();
    this.planeHost.matrix.copy(F);
    this.syncProfiles(content);
    this.planeHost.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);

    if (this.root.parent !== parent) {
      parent.add(this.root);
    }
  }

  /**
   * Editor-only wires for SVG shape children (core folds them into the solid —
   * they never become scene instructions on their own).
   */
  private syncProfiles(content: string): void {
    this.clearProfiles();
    const children = listChildOpensAtPath(content, this.path);
    for (let i = 0; i < children.length; i++) {
      const open = children[i]!;
      if (!SECTION_SHAPE_TAGS.has(open.local)) continue;
      const shapePath = `${this.path}.${i}`;
      const shapeAttrs = readAttrsAtPath(content, shapePath) ?? {};
      const parsed = parseSectionShapes2D(
        { shapes: [shapeValueFromOpen(open.local, shapeAttrs)] },
        48
      )[0];
      if (!parsed || parsed.ring.length < 2) continue;

      const pts = parsed.ring.map((p) => new THREE.Vector3(p.x, p.y, 0));
      if (parsed.closed && pts.length >= 2) {
        pts.push(pts[0]!.clone());
      }
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: SECTION_PROFILE_COLOR,
        toneMapped: false,
        depthTest: true,
        depthWrite: false,
      });
      const line = new THREE.Line(geom, mat);
      line.name = `section-profile:${shapePath}`;
      line.renderOrder = 2;
      tagSectionProxy(line, shapePath, { sectionProfile: true });
      this.profiles.add(line);
      this.profileByPath.set(shapePath, line);
    }
  }

  private clearProfiles(): void {
    for (const child of [...this.profiles.children]) {
      this.profiles.remove(child);
      const line = child as THREE.Line;
      line.geometry?.dispose();
      const mat = line.material;
      if (mat && !Array.isArray(mat)) mat.dispose();
    }
    this.profileByPath.clear();
  }

  /** `s3dx:transform` attr from the current local matrix (pose stays on planeHost). */
  commitTransformAttr(): string {
    this.root.updateMatrix();
    const m = matrix4ToMat4x3(this.root.matrix);
    return matrix12ToTransformAttr(m);
  }

  dispose(): void {
    this.clearProfiles();
    this.root.removeFromParent();
    this.plane.dispose();
  }
}

export function createSectionProxy(
  content: string,
  path: string,
  parent: THREE.Object3D
): SectionProxy {
  const proxy = new SectionProxy(path, planeSizeFor(parent));
  proxy.syncFromDocument(content, parent);
  return proxy;
}
