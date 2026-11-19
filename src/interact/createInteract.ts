import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  applyWorldUp,
  createViewer,
  getPickData,
  pickPathFromObject,
  SelectionHighlight,
  type CreateViewerOptions,
  type EmbedViewer,
  type EvaluationResult,
  type ParamMap,
} from "svg3dx-viewer";
import {
  matrix4ToMat4x3,
  matrix12ToTransformAttr,
} from "@/utils/nodeSchema";

// Match viewer: Z-up before any studio Object3D / raycast helpers.
applyWorldUp();

const PICK_DRAG_PX = 5;

export type TransformMode = "translate" | "rotate" | "scale";

export type TransformCommitPayload = {
  path: string;
  /** `s3dx:transform` attr value (`matrix(...)` or `""` to clear). */
  transform: string;
};

/**
 * Studio-internal viewport interaction layer on top of `svg3dx-viewer`.
 *
 * Owns click-pick / highlight / TransformControls. World axes live in the
 * viewer. It does **not** own document editing — tree, inspector, and save
 * stay in studio UI.
 *
 * Browse page should keep using `createViewer` / `ViewerHost` directly.
 */
export type CreateInteractOptions = Omit<CreateViewerOptions, "viewHelperClick"> & {
  /** Fired when the user clicks geometry (not orbit-drag / ViewHelper / gizmo). */
  onPick?: (path: string | null) => void;
  /** Fired after a TransformControls drag commits a new local matrix. */
  onTransformCommit?: (payload: TransformCommitPayload) => void;
};

export async function createInteract(
  container: HTMLElement,
  options: CreateInteractOptions = {}
): Promise<InteractViewport> {
  const { onPick, onTransformCommit, ...viewerOptions } = options;
  const viewer = await createViewer(container, {
    // Studio edits :root via the style tree — hide overlay Params by default.
    paramsBar: false,
    ...viewerOptions,
    // Interact owns left-click routing (ViewHelper + pick).
    viewHelperClick: false,
  });
  return new InteractViewport(viewer, { onPick, onTransformCommit });
}

function isTransformablePath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (path.startsWith("defs:")) return true;
  if (path.startsWith("model:")) {
    // `model:id.N` is a `<s3dx:use>`; bare `model:id` has no single Object3D.
    const rest = path.slice("model:".length);
    return rest.includes(".");
  }
  return false;
}

/**
 * Prefer the shallowest object whose pick data exactly matches `path`
 * (`treePath` or `defsPath`). Under a model use, remapped meshes share the
 * use path — shallowest is the use root.
 */
function findTransformTarget(
  root: THREE.Object3D,
  path: string
): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  let bestDepth = Infinity;
  root.traverse((obj) => {
    const data = getPickData(obj);
    if (!data) return;
    if (data.treePath !== path && data.defsPath !== path) return;
    let depth = 0;
    for (let p = obj.parent; p; p = p.parent) depth += 1;
    if (depth < bestDepth) {
      bestDepth = depth;
      best = obj;
    }
  });
  return best;
}

export class InteractViewport {
  /** Underlying display viewer; prefer InteractViewport APIs when available. */
  readonly viewer: EmbedViewer;

  private onPick?: (path: string | null) => void;
  private onTransformCommit?: (payload: TransformCommitPayload) => void;
  private highlight: SelectionHighlight;
  private highlightPath: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDown: { x: number; y: number; button: number } | null = null;
  private onPointerDown: (event: PointerEvent) => void;
  private onPointerUp: (event: PointerEvent) => void;
  private onKeyDown: (event: KeyboardEvent) => void;

  private transform: TransformControls;
  private transformHelper: THREE.Object3D;
  private transformDirty = false;
  /** True while TransformControls owns the current left-button gesture. */
  private gizmoGesture = false;
  private transformMode: TransformMode = "translate";

  constructor(
    viewer: EmbedViewer,
    options: {
      onPick?: (path: string | null) => void;
      onTransformCommit?: (payload: TransformCommitPayload) => void;
    } = {}
  ) {
    this.viewer = viewer;
    this.onPick = options.onPick;
    this.onTransformCommit = options.onTransformCommit;
    // Meshes → OutlinePass; curve wires (line/arc/path) get color highlight inside SelectionHighlight.
    this.highlight = new SelectionHighlight((objects) => {
      this.viewer.setSelectedObjects(objects);
    });
    // Thin THREE.Line wires need a wider pick band than the default (1 world unit).
    this.raycaster.params.Line = { threshold: 4 };

    this.transform = new TransformControls(
      this.viewer.camera,
      this.viewer.renderer.domElement
    );
    this.transform.setMode(this.transformMode);
    this.transform.setSpace("world");
    // Default size 1 reads large in CAD views; keep handles usable but less dominant.
    this.transform.setSize(0.65);
    this.transform.enabled = false;
    this.transformHelper = this.transform.getHelper();
    this.transformHelper.name = "studio-transform-controls";
    this.viewer.scene.add(this.transformHelper);
    this.transform.detach();

    this.transform.addEventListener("dragging-changed", (event) => {
      const dragging = Boolean((event as { value?: boolean }).value);
      this.viewer.controls.enabled = !dragging;
    });
    this.transform.addEventListener("mouseDown", () => {
      // Click on a gizmo handle (even without a drag) must not clear selection.
      this.gizmoGesture = true;
    });
    this.transform.addEventListener("objectChange", () => {
      this.transformDirty = true;
    });
    this.transform.addEventListener("mouseUp", () => {
      if (this.transformDirty) {
        this.transformDirty = false;
        this.commitTransform();
      }
      // Keep gizmoGesture through our pick pointerup (same event turn).
      queueMicrotask(() => {
        this.gizmoGesture = false;
      });
    });

    this.onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.pointerDown = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      };
    };
    this.onPointerUp = (event: PointerEvent) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down || down.button !== 0 || event.button !== 0) return;
      if (this.gizmoGesture || this.transform.dragging) return;
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      if (dx * dx + dy * dy > PICK_DRAG_PX * PICK_DRAG_PX) return;
      if (
        this.viewer.viewHelperVisible &&
        this.viewer.viewHelper.handleClick(event)
      ) {
        return;
      }
      this.handlePick(event);
    };
    this.onKeyDown = (event: KeyboardEvent) => {
      if (!this.transform.object) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "w") {
        this.setTransformMode("translate");
        event.preventDefault();
      } else if (key === "e") {
        this.setTransformMode("rotate");
        event.preventDefault();
      } else if (key === "r") {
        this.setTransformMode("scale");
        event.preventDefault();
      }
    };

    const el = this.viewer.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
  }

  async loadSvg(
    svgText: string,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    const result = await this.viewer.loadSvg(svgText, options);
    this.reapplyHighlight();
    return result;
  }

  async applySvg(
    svgText: string,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    const result = await this.viewer.applySvg(svgText, options);
    this.reapplyHighlight();
    return result;
  }

  async setParams(params: ParamMap): Promise<EvaluationResult | null> {
    const result = await this.viewer.setParams(params);
    this.reapplyHighlight();
    return result;
  }

  getParams(): ParamMap {
    return this.viewer.getParams();
  }

  async setModel(
    model: string | undefined,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult | null> {
    const result = await this.viewer.setModel(model, options);
    this.reapplyHighlight();
    return result;
  }

  getResult(): EvaluationResult | null {
    return this.viewer.getResult();
  }

  setBackground(color: number | string): void {
    this.viewer.setBackground(color);
    // Outline + curve colors track background luminance — refresh active pick.
    this.reapplyHighlight();
  }

  /** Highlight geometry matching a Studio tree path (or clear with null). */
  setHighlight(path: string | null | undefined): void {
    this.highlightPath = path || null;
    this.highlight.set(this.viewer.viewer.root, this.highlightPath);
    this.syncTransformTarget();
  }

  getHighlight(): string | null {
    return this.highlightPath;
  }

  /** Whether TransformControls is currently attached to a selection. */
  hasTransformGizmo(): boolean {
    return Boolean(this.transform.object);
  }

  getTransformMode(): TransformMode {
    return this.transformMode;
  }

  setTransformMode(mode: TransformMode): void {
    this.transformMode = mode;
    this.transform.setMode(mode);
  }

  dispose(): void {
    const el = this.viewer.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    this.transform.detach();
    this.transform.dispose();
    this.viewer.scene.remove(this.transformHelper);
    this.highlight.clear();
    this.viewer.setSelectedObjects([]);
    this.viewer.controls.enabled = true;
    this.viewer.dispose();
  }

  private syncTransformTarget(): void {
    const path = this.highlightPath;
    if (!isTransformablePath(path)) {
      this.transform.detach();
      this.transform.enabled = false;
      return;
    }
    const target = findTransformTarget(this.viewer.viewer.root, path!);
    if (!target) {
      this.transform.detach();
      this.transform.enabled = false;
      return;
    }
    this.transform.enabled = true;
    this.transform.attach(target);
  }

  private commitTransform(): void {
    const path = this.highlightPath;
    const obj = this.transform.object;
    if (!path || !obj || !this.onTransformCommit) return;
    obj.updateMatrix();
    const m = matrix4ToMat4x3(obj.matrix);
    this.onTransformCommit({
      path,
      transform: matrix12ToTransformAttr(m),
    });
  }

  private handlePick(event: PointerEvent): void {
    const el = this.viewer.renderer.domElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.viewer.camera);
    // Gizmo lives outside svg3dx root — ignore picks that hit its handles.
    if (
      this.transform.object &&
      this.raycaster.intersectObject(this.transformHelper, true).length > 0
    ) {
      return;
    }
    const hits = this.raycaster.intersectObjects(
      this.viewer.viewer.root.children,
      true
    );
    const path = hits.length ? pickPathFromObject(hits[0]!.object) : null;
    this.setHighlight(path);
    this.onPick?.(path);
  }

  private reapplyHighlight(): void {
    if (this.highlightPath) {
      this.highlight.set(this.viewer.viewer.root, this.highlightPath);
    } else {
      this.highlight.clear();
    }
    this.syncTransformTarget();
  }
}
