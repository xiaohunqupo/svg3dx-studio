import * as THREE from "three";
import { getPickData, setPickData } from "svg3dx-viewer";

/** Shared unit circle — world radius set each frame for ~constant pixel size. */
const SHARED_GEO = new THREE.CircleGeometry(1, 28);
const _world = new THREE.Vector3();
const _parentScale = new THREE.Vector3();
const _parentQuat = new THREE.Quaternion();

/** Default editor marker color (sky) — kept off the amber selection outline. */
export const POINT_MARKER_COLOR = 0x38bdf8;

/** On-screen radius target (CSS pixels). */
const PIXEL_RADIUS = 7;
/** Safety clamps in world units (CAD extents are often tens–hundreds). */
const WORLD_RADIUS_MIN = 0.08;
const WORLD_RADIUS_MAX = 8;

export type PointBillboardOptions = {
  /** Prefer the live editor camera — OutlinePass may pass another view. */
  getCamera: () => THREE.Camera;
  /** Canvas CSS height for pixel→world conversion. */
  getViewHeight: () => number;
};

/**
 * World radius that covers `PIXEL_RADIUS` CSS pixels at `dist` from `camera`.
 */
function radiusForScreenPixels(
  camera: THREE.Camera,
  dist: number,
  viewHeightPx: number
): number {
  const h = Math.max(viewHeightPx, 1);
  const d = Math.max(dist, 1e-4);
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const persp = camera as THREE.PerspectiveCamera;
    const halfFov = THREE.MathUtils.degToRad(persp.fov) * 0.5;
    return d * Math.tan(halfFov) * ((2 * PIXEL_RADIUS) / h);
  }
  const ortho = camera as THREE.OrthographicCamera;
  if (ortho.isOrthographicCamera) {
    const worldH = (ortho.top - ortho.bottom) / Math.max(ortho.zoom, 1e-8);
    return worldH * (PIXEL_RADIUS / h);
  }
  return Math.min(Math.max(d * 0.01, WORLD_RADIUS_MIN), WORLD_RADIUS_MAX);
}

/**
 * Attach a camera-facing circle billboard under a point host Object3D.
 * Cheap (one shared disk), pickable Mesh (OutlinePass / raycast), skipped in fit.
 * Screen size stays ~constant; host scale is cancelled so gizmo scale cannot
 * inflate the marker.
 */
export function attachPointBillboard(
  host: THREE.Object3D,
  options: PointBillboardOptions
): THREE.Mesh {
  for (const child of [...host.children]) {
    if (child.userData?.pointBillboard) {
      host.remove(child);
      const mesh = child as THREE.Mesh;
      const mat = mesh.material;
      if (mat && !Array.isArray(mat)) mat.dispose();
    }
  }

  const mat = new THREE.MeshBasicMaterial({
    color: POINT_MARKER_COLOR,
    depthTest: true,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(SHARED_GEO, mat);
  mesh.name = "point-billboard";
  mesh.userData.pointBillboard = true;
  mesh.userData.skipFitBounds = true;
  // Avoid a one-frame unit disk before the first sized render.
  mesh.scale.setScalar(WORLD_RADIUS_MIN);

  mesh.onBeforeRender = (_renderer, _scene, renderCamera) => {
    // Composer / OutlinePass may invoke this with another camera; sizing against
    // that left markers as oversized "balls" after a viewer refresh.
    const camera = options.getCamera() || renderCamera;
    const parent = mesh.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(_parentQuat);
      // Face camera in world space: local = parentWorld^{-1} * camera.
      mesh.quaternion.copy(_parentQuat).invert().multiply(camera.quaternion);
      parent.getWorldScale(_parentScale);
    } else {
      mesh.quaternion.copy(camera.quaternion);
      _parentScale.set(1, 1, 1);
    }

    mesh.getWorldPosition(_world);
    const dist = _world.distanceTo(camera.position);
    const worldSize = THREE.MathUtils.clamp(
      radiusForScreenPixels(camera, dist, options.getViewHeight()),
      WORLD_RADIUS_MIN,
      WORLD_RADIUS_MAX
    );
    // Cancel parent scale so host gizmo scale never blows up the marker.
    const ps =
      (Math.abs(_parentScale.x) +
        Math.abs(_parentScale.y) +
        Math.abs(_parentScale.z)) /
      3;
    const local = ps > 1e-8 ? worldSize / ps : worldSize;
    mesh.scale.setScalar(local);
  };

  const pick = getPickData(host);
  if (pick) setPickData(mesh, { ...pick });

  host.add(mesh);
  return mesh;
}
