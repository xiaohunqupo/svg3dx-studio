import * as THREE from "three";
import { getPickData, setPickData } from "svg3dx-viewer";

/** Shared unit circle — scaled per-frame for roughly screen-constant size. */
const SHARED_GEO = new THREE.CircleGeometry(1, 28);
const _world = new THREE.Vector3();

/** Default editor marker color (amber). */
export const POINT_MARKER_COLOR = 0xf59e0b;

/**
 * Attach a camera-facing circle billboard under a point host Object3D.
 * Cheap (one shared disk), pickable Mesh (OutlinePass / raycast), skipped in fit.
 */
export function attachPointBillboard(host: THREE.Object3D): THREE.Mesh {
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

  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    mesh.quaternion.copy(camera.quaternion);
    mesh.getWorldPosition(_world);
    const dist = _world.distanceTo(camera.position);
    // ~constant on-screen size; clamp so near/far stays pickable.
    const s = Math.max(2.5, Math.min(dist * 0.016, 28));
    mesh.scale.setScalar(s);
  };

  const pick = getPickData(host);
  if (pick) setPickData(mesh, { ...pick });

  host.add(mesh);
  return mesh;
}
