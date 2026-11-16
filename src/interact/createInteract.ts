import * as THREE from "three";
import {
  applyWorldUp,
  createViewer,
  pickPathFromObject,
  SelectionHighlight,
  type CreateViewerOptions,
  type EmbedViewer,
  type EvaluationResult,
  type ParamMap,
} from "svg3dx-viewer";

// Match viewer: Z-up before any studio Object3D / raycast helpers.
applyWorldUp();

const PICK_DRAG_PX = 5;

/**
 * Studio-internal viewport interaction layer on top of `svg3dx-viewer`.
 *
 * Owns click-pick / highlight (and later transform / snap). It does **not** own
 * document editing — tree, inspector, and save stay in studio UI.
 *
 * Browse page should keep using `createViewer` / `ViewerHost` directly.
 */
export type CreateInteractOptions = Omit<CreateViewerOptions, "viewHelperClick"> & {
  /** Fired when the user clicks geometry (not orbit-drag / ViewHelper). */
  onPick?: (path: string | null) => void;
};

export async function createInteract(
  container: HTMLElement,
  options: CreateInteractOptions = {}
): Promise<InteractViewport> {
  const { onPick, ...viewerOptions } = options;
  const viewer = await createViewer(container, {
    // Studio edits :root via the style tree — hide overlay Params by default.
    paramsBar: false,
    ...viewerOptions,
    // Interact owns left-click routing (ViewHelper + pick).
    viewHelperClick: false,
  });
  return new InteractViewport(viewer, { onPick });
}

export class InteractViewport {
  /** Underlying display viewer; prefer InteractViewport APIs when available. */
  readonly viewer: EmbedViewer;

  private onPick?: (path: string | null) => void;
  private highlight = new SelectionHighlight();
  private highlightPath: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDown: { x: number; y: number; button: number } | null = null;
  private onPointerDown: (event: PointerEvent) => void;
  private onPointerUp: (event: PointerEvent) => void;

  constructor(
    viewer: EmbedViewer,
    options: { onPick?: (path: string | null) => void } = {}
  ) {
    this.viewer = viewer;
    this.onPick = options.onPick;

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

    const el = this.viewer.renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
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

  /** Highlight geometry matching a Studio tree path (or clear with null). */
  setHighlight(path: string | null | undefined): void {
    this.highlightPath = path || null;
    this.highlight.set(this.viewer.viewer.root, this.highlightPath);
  }

  getHighlight(): string | null {
    return this.highlightPath;
  }

  dispose(): void {
    const el = this.viewer.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    this.highlight.clear();
    this.viewer.dispose();
  }

  private handlePick(event: PointerEvent): void {
    const el = this.viewer.renderer.domElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.viewer.camera);
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
  }
}
