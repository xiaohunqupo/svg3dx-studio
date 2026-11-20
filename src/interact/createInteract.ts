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
  detectTransformForm,
  matrix4ToMat4x3,
  matrix12ToTransformAttr,
} from "@/utils/nodeSchema";
import { nodeKindAtPath, readAttrsAtPath } from "@/utils/nodeXmlEdit";
import {
  documentChain,
  modelUseGroupId,
  withModelCrumb,
  type DocStep,
} from "./documentChain";
import {
  emptyClickAction,
  levelAfterSelect,
  mergeLocationChain,
  sectionPathsToShow as sectionPathsForOverlay,
} from "./drillNav";
import {
  createSectionProxy,
  isSectionPath,
  parentTreePath,
  sectionAncestorPath,
  SectionProxy,
} from "./sectionProxy";

// Match viewer: Z-up before any studio Object3D / raycast helpers.
applyWorldUp();

const PICK_DRAG_PX = 5;
const DBLCLICK_MS = 500;
const DBLCLICK_PX = 8;

export type TransformMode = "translate" | "rotate" | "scale";

/** One step of the drill breadcrumb. `path` walks the scene; `nodePath` is the document node. */
export type DrillCrumb = {
  path: string;
  nodePath: string;
  /** Entered the previous level and nothing inside it is selected. */
  pending?: boolean;
};

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
  /**
   * Breadcrumb for the current selection, including the entered level.
   * Empty when nothing is selected and the view is not drilled in.
   */
  onDrillChange?: (crumbs: DrillCrumb[]) => void;
};

export async function createInteract(
  container: HTMLElement,
  options: CreateInteractOptions = {}
): Promise<InteractViewport> {
  const { onPick, onTransformCommit, onDrillChange, ...viewerOptions } = options;
  const viewer = await createViewer(container, {
    // Studio edits :root via the style tree — hide overlay Params by default.
    paramsBar: false,
    ...viewerOptions,
    // Interact owns left-click routing (ViewHelper + pick).
    viewHelperClick: false,
  });
  return new InteractViewport(viewer, { onPick, onTransformCommit, onDrillChange });
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

function isShown(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

/** Loop copies drawn faded are marked so picks pass through them. */
function isGhost(obj: THREE.Object3D): boolean {
  // Profile wires stay pickable even when the parent solid is ghosted.
  if (obj.userData?.sectionProfile) return false;
  // Ghosted section plane: pass through so empty / profile picks work.
  if (obj.userData?.sectionProxy && obj.userData?.drillGhost) return true;
  // Solid section plane under a ghosted construct: still pickable.
  if (obj.userData?.sectionProxy) return false;
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur.userData?.drillGhost) return true;
    cur = cur.parent;
  }
  return false;
}

function modelPathOf(obj: THREE.Object3D): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const path = getPickData(cur)?.treePath;
    if (path?.startsWith("model:") && path.includes(".")) return path;
    cur = cur.parent;
  }
  return null;
}

/** Group id of a definition placed at its own transform, not under a model use. */
function defsWorldGroupId(obj: THREE.Object3D): string | null {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const id = cur.userData?.defsWorld;
    if (typeof id === "string" && id) return id;
    cur = cur.parent;
  }
  return null;
}

function longestNodeId(obj: THREE.Object3D): string | null {
  let best: string | null = null;
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    const id = getPickData(cur)?.nodeId;
    if (id && (!best || id.length > best.length)) best = id;
    cur = cur.parent;
  }
  return best;
}

export class InteractViewport {
  /** Underlying display viewer; prefer InteractViewport APIs when available. */
  readonly viewer: EmbedViewer;

  private onPick?: (path: string | null) => void;
  private onTransformCommit?: (payload: TransformCommitPayload) => void;
  private onDrillChange?: (crumbs: DrillCrumb[]) => void;
  /** Isolated node. Null = whole model, axes at the world origin. */
  private scopePath: string | null = null;
  /** Document node currently selected. May equal `scopePath` after a double-click. */
  private selection: string | null = null;
  /**
   * Full document chain of the last viewport hit, root → leaf.
   * Breadcrumbs show the prefix through the selection or the entered level.
   */
  private locationChain: DocStep[] = [];
  /** Latest svg text, used to walk uses / loops that the scene flattens. */
  private document = "";
  private chainCache = new Map<string, DocStep[]>();
  /**
   * Tree selection echoes the viewport pick. Ignore that echo so it does not
   * replace the hit chain with a shorter ancestor list.
   */
  private echoSelection: string | null = null;
  /** Outermost node entered by the first double-click. Esc selects this. */
  private entryPath: string | null = null;
  /** Defs group currently framed. Null while the model is showing. */
  private framedDef: string | null = null;
  private ghostBackups: {
    object: THREE.Mesh | THREE.Line;
    material: THREE.Material | THREE.Material[];
    clones: THREE.Material[];
  }[] = [];
  private lastClickAt = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private lastRightClickAt = 0;
  private lastRightClickX = 0;
  private lastRightClickY = 0;
  private highlight: SelectionHighlight;
  private highlightPath: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDown: { x: number; y: number; button: number } | null = null;
  private onPointerDown: (event: PointerEvent) => void;
  private onPointerUp: (event: PointerEvent) => void;
  private onContextMenu: (event: Event) => void;
  private onKeyDown: (event: KeyboardEvent) => void;

  private transform: TransformControls;
  private transformHelper: THREE.Object3D;
  /** Separate from main scene so OutlinePass does not outline the gizmo. */
  private overlayScene: THREE.Scene;
  private transformDirty = false;
  /** True while TransformControls owns the current left-button gesture. */
  private gizmoGesture = false;
  private transformMode: TransformMode = "translate";
  /** Light-green XOY plane proxies for visible `<s3dx:section>` nodes. */
  private sectionProxies = new Map<string, SectionProxy>();

  constructor(
    viewer: EmbedViewer,
    options: {
      onPick?: (path: string | null) => void;
      onTransformCommit?: (payload: TransformCommitPayload) => void;
      onDrillChange?: (crumbs: DrillCrumb[]) => void;
    } = {}
  ) {
    this.viewer = viewer;
    this.viewer.viewer.includeDefsWorld = true;
    this.onPick = options.onPick;
    this.onTransformCommit = options.onTransformCommit;
    this.onDrillChange = options.onDrillChange;
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
    // Keep gizmo out of the composer scene — OutlinePass would otherwise treat
    // its depth as part of the selection silhouette ("gizmo gets highlighted").
    this.overlayScene = new THREE.Scene();
    this.overlayScene.add(this.transformHelper);
    this.viewer.addOverlayScene(this.overlayScene);
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
      if (event.button !== 0 && event.button !== 2) return;
      this.pointerDown = {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
      };
    };
    this.onPointerUp = (event: PointerEvent) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down || down.button !== event.button) return;
      if (this.gizmoGesture || this.transform.dragging) return;
      const dx = event.clientX - down.x;
      const dy = event.clientY - down.y;
      if (dx * dx + dy * dy > PICK_DRAG_PX * PICK_DRAG_PX) return;

      // Right double-click → go up one drill / selection level.
      if (event.button === 2) {
        const now = performance.now();
        const ddx = event.clientX - this.lastRightClickX;
        const ddy = event.clientY - this.lastRightClickY;
        const isDouble =
          this.lastRightClickAt > 0 &&
          now - this.lastRightClickAt <= DBLCLICK_MS &&
          ddx * ddx + ddy * ddy <= DBLCLICK_PX * DBLCLICK_PX;
        this.lastRightClickAt = now;
        this.lastRightClickX = event.clientX;
        this.lastRightClickY = event.clientY;
        if (isDouble) {
          this.lastRightClickAt = 0;
          this.exitOneLevel();
        }
        return;
      }

      if (event.button !== 0) return;
      if (
        this.viewer.viewHelperVisible &&
        this.viewer.viewHelper.handleClick(event)
      ) {
        this.lastClickAt = 0;
        return;
      }
      const now = performance.now();
      const ddx = event.clientX - this.lastClickX;
      const ddy = event.clientY - this.lastClickY;
      const isDouble =
        this.lastClickAt > 0 &&
        now - this.lastClickAt <= DBLCLICK_MS &&
        ddx * ddx + ddy * ddy <= DBLCLICK_PX * DBLCLICK_PX;
      this.lastClickAt = now;
      this.lastClickX = event.clientX;
      this.lastClickY = event.clientY;
      if (isDouble) {
        this.lastClickAt = 0;
        this.handleDrill(event);
      } else {
        this.handlePick(event);
      }
    };
    this.onContextMenu = (event: Event) => {
      event.preventDefault();
    };
    this.onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const hasDrill =
          !!this.scopePath ||
          !!this.selection ||
          !!this.highlightPath ||
          this.locationChain.length > 0;
        if (hasDrill) {
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
          const dialog = document.querySelector<HTMLElement>(".t-dialog");
          if (dialog && dialog.getClientRects().length > 0) return;
          if (this.transform.dragging) return;
          event.preventDefault();
          // Esc always leaves every drill level and clears the pick.
          this.exitDrill({ select: null });
          return;
        }
      }
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
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Keep the svg used to map picks onto document nodes (uses, loops, groups). */
  setDocument(content: string): void {
    if (content === this.document) return;
    this.document = content;
    this.chainCache.clear();
  }

  async loadSvg(
    svgText: string,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    this.transform.detach();
    this.clearSectionProxies();
    this.restoreGhosts();
    this.setDocument(svgText);
    this.viewer.setHelperFrame(null);
    const result = await this.viewer.loadSvg(svgText, options);
    this.reapplyHighlight();
    this.reapplyDrill();
    return result;
  }

  async applySvg(
    svgText: string,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    this.transform.detach();
    this.clearSectionProxies();
    this.restoreGhosts();
    this.setDocument(svgText);
    this.viewer.setHelperFrame(null);
    const result = await this.viewer.applySvg(svgText, options);
    this.reapplyHighlight();
    this.reapplyDrill();
    return result;
  }

  async setParams(params: ParamMap): Promise<EvaluationResult | null> {
    this.transform.detach();
    this.clearSectionProxies();
    this.restoreGhosts();
    this.viewer.setHelperFrame(null);
    const result = await this.viewer.setParams(params);
    this.reapplyHighlight();
    this.reapplyDrill();
    return result;
  }

  getParams(): ParamMap {
    return this.viewer.getParams();
  }

  async setModel(
    model: string | undefined,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult | null> {
    this.clearSectionProxies();
    this.restoreGhosts();
    this.scopePath = null;
    this.entryPath = null;
    this.selection = null;
    this.locationChain = [];
    this.framedDef = null;
    this.viewer.setHelperFrame(null);
    const result = await this.viewer.setModel(model, options);
    this.reapplyHighlight();
    this.emitDrill();
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

  /**
   * Highlight from the node tree (or pick echo).
   * Still on the model-entry branch (path ancestors, defs root / siblings under
   * that root): keep `locationChain` prefix, only move the tip.
   * True branch switch (other defs group / 定义集): defs-only chain.
   */
  setHighlight(path: string | null | undefined): void {
    const next = path || null;
    if (next && next === this.echoSelection) {
      this.echoSelection = null;
      return;
    }
    this.echoSelection = null;
    this.highlightPath = next;
    this.selection = next;
    if (!next) {
      if (!this.scopePath) this.locationChain = [];
      this.applyVisibility();
      this.applyHighlight();
      this.syncTransformTarget();
      this.emitDrill();
      return;
    }
    if (this.staysOnEntryBranch(next)) {
      this.locationChain = mergeLocationChain(
        next,
        this.locationChain,
        this.locationChain
      );
    } else {
      this.scopePath = null;
      this.entryPath = null;
      this.locationChain = mergeLocationChain(next, [], []);
    }
    this.ensureLevelForSelection(next);
    this.applyVisibility();
    this.applyHighlight();
    this.syncTransformTarget();
    this.emitDrill();
  }

  /**
   * Tree pick stays on the current entry when `next` is on the breadcrumb, an
   * ancestor/descendant of the formal scope, or still under the same defs root
   * reached via the model use (incl. other children of `main`).
   */
  private staysOnEntryBranch(path: string): boolean {
    if (this.pathInScope(path)) return true;
    if (!this.locationChain[0]?.path.startsWith("model:")) return false;
    if (!path.startsWith("defs:")) return false;
    return this.onModelEntryDefsBranch(path);
  }

  /** Same href-target definition subtree as the active model-entry chain. */
  private onModelEntryDefsBranch(path: string): boolean {
    if (!path.startsWith("defs:")) return false;
    const defsRoot = this.locationChain.find((s) => s.path.startsWith("defs:"));
    if (defsRoot) {
      const root = defsRoot.path;
      return (
        path === root ||
        path.startsWith(`${root}.`) ||
        root.startsWith(`${path}.`)
      );
    }
    if (!this.document) return false;
    const useStep = [...this.locationChain]
      .reverse()
      .find((s) => s.path.startsWith("model:") && s.path.includes("."));
    if (!useStep) return false;
    const gid = modelUseGroupId(this.document, useStep.path);
    if (!gid) return false;
    const root = `defs:${gid}`;
    return (
      path === root ||
      path.startsWith(`${root}.`) ||
      root.startsWith(`${path}.`)
    );
  }

  /**
   * Leave isolation.
   * No argument selects the node the drill started from.
   * `{ select: null }` clears the highlight. `{ select: path }` selects `path`.
   */
  exitDrill(options?: { select?: string | null }): void {
    const explicit = options !== undefined && "select" in options;
    const select = explicit ? options.select : this.entryPath;
    this.scopePath = null;
    this.entryPath = null;
    if (select) {
      this.highlightPath = select;
      this.selection = select;
      this.locationChain = this.chainToPath(select);
      this.echoSelection = select;
    } else {
      this.highlightPath = null;
      this.selection = null;
      this.locationChain = [];
      this.echoSelection = null;
    }
    this.applyVisibility();
    this.applyHighlight();
    this.syncTransformTarget();
    this.emitDrill();
    this.onPick?.(select ?? null);
  }

  /** Breadcrumb: enter `path` without selecting a child. The top crumb leaves isolation. */
  focusDrill(path: string): void {
    if (!path) return;
    const crumbs = this.visibleCrumbs();
    const idx = crumbs.findIndex((c) => c.path === path);
    if (idx < 0 || crumbs[idx]?.pending) return;
    if (this.scopePath === path && !this.selection) return;
    if (idx === 0) {
      this.exitDrill({ select: path });
      return;
    }
    this.enterLevel(path, this.locationChain);
  }

  /**
   * Empty click: clear entity pick.
   * Formal drill (`enterLevel`) leaves `selection == null` and keeps `scopePath`.
   * Soft pick can set `scopePath === selection` (e.g. model use, so refs stay
   * solid) — clearing that pick must drop the soft level too, or empty click
   * becomes `model/引用/?`.
   */
  private clearCurrentSelection(): void {
    const sel = this.selection ?? this.highlightPath;
    const action = emptyClickAction(sel);
    if (action.type === "noop") {
      this.applyHighlight();
      this.syncTransformTarget();
      this.emitDrill();
      this.onPick?.(null);
      return;
    }
    const softLevel = !!sel && sel === this.scopePath;
    this.selection = null;
    this.highlightPath = null;
    this.echoSelection = null;
    if (softLevel) {
      // Drop the soft tip only — keep a formal parent (e.g. use under model).
      const idx = this.locationChain.findIndex((s) => s.path === sel);
      const parentStep = idx > 0 ? this.locationChain[idx - 1]!.path : null;
      if (parentStep && !(parentStep.startsWith("model:") && !parentStep.includes("."))) {
        this.scopePath = parentStep;
        this.locationChain = this.locationChain.slice(0, idx);
      } else {
        // Top soft pick (model use under bare model) → back to model/?
        this.scopePath = null;
        this.entryPath = null;
        this.locationChain = [];
      }
    } else if (!this.scopePath) {
      this.locationChain = [];
    }
    this.applyVisibility();
    this.applyHighlight();
    this.syncTransformTarget();
    this.emitDrill();
    this.onPick?.(null);
  }

  /** After a pick, ensure `scopePath` is the level empty-click should keep. */
  private ensureLevelForSelection(path: string): void {
    this.scopePath = levelAfterSelect(path, this.scopePath);
    if (!this.entryPath) this.entryPath = path;
  }

  /**
   * Go up one level (right double-click):
   * - child selected under a formal drill → stay at the entered level, clear pick
   * - otherwise focus the parent crumb (top crumb leaves isolation)
   */
  exitOneLevel(): void {
    if (this.transform.dragging) return;
    const crumbs = this.visibleCrumbs().filter((c) => !c.pending && c.path);
    if (
      this.scopePath &&
      this.selection &&
      this.selection !== this.scopePath
    ) {
      this.enterLevel(this.scopePath, this.locationChain);
      return;
    }
    const current =
      this.scopePath ?? this.selection ?? this.highlightPath ?? null;
    if (!current) return;
    const idx = crumbs.findIndex((c) => c.path === current);
    if (idx > 0) {
      this.focusDrill(crumbs[idx - 1]!.path);
      return;
    }
    if (this.scopePath) {
      // Top crumb while drilled, or current missing from crumbs — leave isolation.
      this.exitDrill({ select: crumbs[0]?.path ?? this.entryPath ?? null });
      return;
    }
    // Top of breadcrumb, not entered — clear pick.
    this.highlightPath = null;
    this.selection = null;
    this.echoSelection = null;
    this.locationChain = [];
    this.applyVisibility();
    this.applyHighlight();
    this.syncTransformTarget();
    this.emitDrill();
    this.onPick?.(null);
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
    el.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    this.clearSectionProxies();
    this.transform.detach();
    this.transform.dispose();
    this.overlayScene.remove(this.transformHelper);
    this.viewer.removeOverlayScene(this.overlayScene);
    this.restoreGhosts();
    this.highlight.clear();
    this.viewer.setSelectedObjects([]);
    this.viewer.controls.enabled = true;
    this.viewer.dispose();
  }

  private clearSectionProxies(): void {
    for (const proxy of this.sectionProxies.values()) {
      if (this.transform.object === proxy.root) this.transform.detach();
      this.restoreGhostsUnder(proxy.root);
      proxy.setDrillDim(false);
      proxy.dispose();
    }
    this.sectionProxies.clear();
  }

  private resolveSectionParent(parentPath: string): THREE.Object3D | null {
    let parent = this.objectFor(parentPath);
    if (!parent) {
      parent = findTransformTarget(this.viewer.viewer.root, parentPath);
    }
    return parent;
  }

  /**
   * @param refresh when true (default), rebuild pose/profiles from the document.
   *   Pass false after highlight — rebuilding would dispose the highlighted lines.
   */
  private ensureSectionProxy(path: string, refresh = true): THREE.Object3D | null {
    if (!this.document || !isSectionPath(this.document, path)) return null;
    const parentPath = parentTreePath(path);
    if (!parentPath) return null;
    const parent = this.resolveSectionParent(parentPath);
    if (!parent) return null;
    let proxy = this.sectionProxies.get(path);
    if (proxy && proxy.root.parent === parent) {
      if (refresh) {
        // Profiles are rebuilt — drop ghost backups first or restore hits disposed lines.
        this.restoreGhostsUnder(proxy.root);
        proxy.syncFromDocument(this.document, parent);
      }
    } else {
      if (proxy) {
        this.restoreGhostsUnder(proxy.root);
        proxy.setDrillDim(false);
        proxy.dispose();
      }
      proxy = createSectionProxy(this.document, path, parent);
      this.sectionProxies.set(path, proxy);
    }
    return proxy.root;
  }

  /** Create / refresh / prune section planes for the current drill or selection. */
  private syncSectionProxies(): void {
    if (!this.document) {
      this.clearSectionProxies();
      return;
    }
    const want = new Set(
      sectionPathsForOverlay(
        this.document,
        this.scopePath,
        this.highlightPath ?? this.selection,
        this.isolationScope()
      )
    );
    for (const [path, proxy] of [...this.sectionProxies]) {
      if (!want.has(path)) {
        if (this.transform.object === proxy.root) this.transform.detach();
        this.restoreGhostsUnder(proxy.root);
        proxy.setDrillDim(false);
        proxy.dispose();
        this.sectionProxies.delete(path);
      }
    }
    for (const path of want) this.ensureSectionProxy(path, true);
  }

  private syncTransformTarget(): void {
    const path = this.highlightPath;
    // Do not syncSectionProxies here — that rebuilds profile Lines and clears
    // SelectionHighlight colors. applyVisibility already refreshed overlays.
    if (!isTransformablePath(path)) {
      this.transform.detach();
      this.transform.enabled = false;
      return;
    }

    // Section has no evaluated mesh — attach gizmo to its XOY plane proxy.
    if (isSectionPath(this.document, path)) {
      const proxy =
        this.sectionProxies.get(path!)?.root ??
        this.ensureSectionProxy(path!, false);
      if (!proxy) {
        this.transform.detach();
        this.transform.enabled = false;
        return;
      }
      // Local space so gizmo axes match inspector xdir/ydir/zdir (section frame).
      this.transform.setSpace("local");
      this.transform.enabled = true;
      this.transform.attach(proxy);
      return;
    }

    // Section 2D children are attr-driven overlays — no Object3D transform gizmo.
    if (sectionAncestorPath(this.document, path)) {
      this.transform.detach();
      this.transform.enabled = false;
      return;
    }

    let target = this.objectFor(path!);
    if (
      !target &&
      !this.locationChain.some((step) => step.path === path)
    ) {
      target = findTransformTarget(this.viewer.viewer.root, path!);
    }
    if (!target) {
      this.transform.detach();
      this.transform.enabled = false;
      return;
    }
    this.transform.setSpace("world");
    this.transform.enabled = true;
    this.transform.attach(target);
  }

  private commitTransform(): void {
    const path = this.highlightPath;
    const obj = this.transform.object;
    if (!path || !obj || !this.onTransformCommit) return;
    const form = detectTransformForm(
      this.document
        ? (readAttrsAtPath(this.document, path)?.["s3dx:transform"] ?? "")
        : ""
    );
    const section = this.sectionProxies.get(path);
    if (section && obj === section.root) {
      this.onTransformCommit({
        path,
        transform: section.commitTransformAttr(form),
      });
      return;
    }
    obj.updateMatrix();
    const m = matrix4ToMat4x3(obj.matrix);
    this.onTransformCommit({
      path,
      transform: matrix12ToTransformAttr(m, form),
    });
  }

  private handlePick(event: PointerEvent): void {
    const hit = this.pickHit(event);
    if (!hit) {
      // Empty click: deselect only — never unwind the drill stack (Esc / right-dbl).
      this.clearCurrentSelection();
      // Avoid empty-click + quick object-click being treated as a double-drill.
      this.lastClickAt = 0;
      return;
    }
    const chain = this.chainFromHit(hit);
    if (!chain.length) {
      this.clearCurrentSelection();
      this.lastClickAt = 0;
      return;
    }
    // Always one document step under the current level (section = solid).
    const node = this.stepUnder(chain);
    if (!node) {
      const path = pickPathFromObject(hit);
      if (!path) return;
      this.selectLevel(path, [{ path }]);
      return;
    }
    if (node.path === this.scopePath) {
      this.clearCurrentSelection();
      this.lastClickAt = 0;
      return;
    }
    this.selectLevel(node.path, chain);
  }

  /**
   * Enter one level. Click1 of a double already ran `handlePick`:
   * - Soft pick may set `scopePath === selection` (model use). Formalize that
   *   level (tip `?`) — do not `stepUnder` again or we skip into `main`.
   * - Otherwise enter the selected direct child, or one step under the hit.
   */
  private handleDrill(event: PointerEvent): void {
    if (this.selection && this.selection === this.scopePath) {
      if (!this.entryPath) this.entryPath = this.selection;
      this.enterLevel(this.selection, this.locationChain);
      return;
    }
    if (
      this.selection &&
      this.scopePath &&
      (parentTreePath(this.selection) === this.scopePath ||
        this.isUseContentSelection(this.selection, this.scopePath))
    ) {
      if (!this.entryPath) this.entryPath = this.selection;
      this.enterLevel(
        this.selection,
        mergeLocationChain(
          this.selection,
          this.locationChain,
          this.locationChain
        )
      );
      return;
    }

    const hit = this.pickHit(event);
    if (!hit) return;
    const chain = this.chainFromHit(hit);
    if (!chain.length) return;
    const node = this.stepUnder(chain);
    if (!node || node.path === this.scopePath) return;
    if (!this.entryPath) this.entryPath = node.path;
    this.enterLevel(node.path, chain);
  }

  /** `defs:group` tip while scope is the model use that references it. */
  private isUseContentSelection(
    selection: string,
    scopePath: string | null
  ): boolean {
    if (!scopePath?.startsWith("model:") || !scopePath.includes(".")) {
      return false;
    }
    if (!selection.startsWith("defs:")) return false;
    const rest = selection.slice("defs:".length);
    return !rest.includes(".");
  }

  private chainFromHit(hit: THREE.Object3D): DocStep[] {
    if (hit.userData?.sectionProxy) {
      let path = pickPathFromObject(hit);
      if (!path) return [];
      // Profile wires are not main-tree leaves — select the owning section.
      if (hit.userData?.sectionProfile && this.document) {
        path =
          sectionAncestorPath(this.document, path) ??
          parentTreePath(path) ??
          path;
      }
      return mergeLocationChain(path, this.locationChain, []);
    }
    return this.chainFor(hit);
  }

  private pickHit(event: PointerEvent): THREE.Object3D | null {
    const el = this.viewer.renderer.domElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.viewer.camera);
    // Do not raycast TransformControls here: its drag plane fills the view and
    // would swallow empty-space clicks. Handle hits are gated by gizmoGesture.
    const hits = this.raycaster.intersectObjects(
      this.viewer.viewer.root.children,
      true
    );
    let profile: THREE.Object3D | null = null;
    let sectionPlane: THREE.Object3D | null = null;
    let fallback: THREE.Object3D | null = null;
    for (const hit of hits) {
      if (!isShown(hit.object) || isGhost(hit.object)) continue;
      // Prefer 2D profile wires over the large section fill plane.
      if (hit.object.userData?.sectionProfile) {
        profile = hit.object;
        break;
      }
      if (hit.object.userData?.sectionProxy) {
        if (!sectionPlane) sectionPlane = hit.object;
        continue;
      }
      if (!fallback) fallback = hit.object;
    }
    return profile ?? sectionPlane ?? fallback;
  }

  private showAll(): void {
    this.viewer.viewer.root.traverse((obj) => {
      obj.visible = true;
    });
  }

  /** Node a click selects: one document step below the entered level. */
  private stepUnder(chain: DocStep[]): DocStep | null {
    if (!chain.length) return null;
    if (!this.scopePath) return chain[0]!;
    const idx = chain.findIndex((step) => step.path === this.scopePath);
    if (idx < 0) return null;
    return chain[idx + 1] ?? chain[idx]!;
  }

  private selectLevel(path: string, chain: DocStep[]): void {
    this.locationChain = mergeLocationChain(path, this.locationChain, chain);
    this.selection = path;
    this.highlightPath = path;
    this.echoSelection = path;
    this.ensureLevelForSelection(path);
    this.applyVisibility();
    this.applyHighlight();
    this.syncTransformTarget();
    this.emitDrill();
    this.onPick?.(path);
  }

  /** Isolate `path` and leave the selection empty, so the breadcrumb ends with “?”. */
  private enterLevel(path: string, chain: DocStep[]): void {
    this.scopePath = path;
    this.locationChain = mergeLocationChain(path, this.locationChain, chain);
    this.selection = null;
    this.highlightPath = null;
    this.echoSelection = null;
    this.applyVisibility();
    this.applyHighlight();
    this.syncTransformTarget();
    this.emitDrill();
    this.onPick?.(null);
  }

  /** Defs-only or model-only chain when not extending an active entry. */
  private chainToPath(path: string): DocStep[] {
    return mergeLocationChain(path, [], []);
  }

  private visibleCrumbs(): DocStep[] {
    let steps: DocStep[] = [];
    if (this.selection) {
      const at = this.locationChain.findIndex((step) => step.path === this.selection);
      if (at >= 0) {
        steps = this.locationChain.slice(0, at + 1);
      } else {
        steps = this.chainToPath(this.selection);
      }
    } else if (this.scopePath) {
      const at = this.locationChain.findIndex((step) => step.path === this.scopePath);
      steps =
        at >= 0
          ? this.locationChain.slice(0, at + 1)
          : this.chainToPath(this.scopePath);
    }
    // If the visible tip is under defs, drop any model/use prefix — defs branch
    // is a peer of the model, not nested under the active use.
    steps = this.defsBranchOnly(steps);
    steps = withModelCrumb(steps);
    if (!steps.length) {
      const modelPath = this.currentModelPath();
      if (modelPath) steps = [{ path: modelPath }];
    }
    if (!this.selection && steps.length && !steps[steps.length - 1]?.pending) {
      steps = [...steps, { path: "", pending: true }];
    }
    return steps;
  }

  /**
   * Defs tree / defs-world crumbs stay on the defs branch (定义集/…).
   * Keep a model/use prefix only when `locationChain` itself came from a
   * model-use viewport hit that still contains the selection.
   */
  private defsBranchOnly(steps: DocStep[]): DocStep[] {
    const tip = this.selection ?? this.scopePath;
    if (!tip?.startsWith("defs:")) return steps;
    const viaModelUse =
      !!this.locationChain[0]?.path.startsWith("model:") &&
      this.locationChain.some((s) => s.path === tip);
    if (viaModelUse) return steps;
    const defsAt = steps.findIndex((s) => s.path.startsWith("defs:"));
    if (defsAt <= 0) return steps;
    return steps.slice(defsAt);
  }

  private currentModelPath(): string | null {
    const result = this.viewer.getResult();
    const id = result?.active_model ?? result?.models[0]?.id;
    return id ? `model:${id}` : null;
  }

  private emitDrill(): void {
    const crumbs = this.visibleCrumbs().map((step) => ({
      path: step.path,
      nodePath: step.pending ? "" : step.path,
      pending: step.pending,
    }));
    this.onDrillChange?.(crumbs);
  }

  private pathInScope(path: string): boolean {
    if (this.locationChain.some((step) => step.path === path)) return true;
    if (!this.scopePath) return false;
    if (path === this.scopePath || path.startsWith(`${this.scopePath}.`)) {
      return true;
    }
    // Ancestor of the formal level (e.g. click `main` while inside 路径/?)
    if (this.scopePath.startsWith(`${path}.`)) return true;
    const idx = this.locationChain.findIndex(
      (step) => step.path === this.scopePath
    );
    if (idx < 0) return false;
    return this.locationChain
      .slice(idx)
      .some(
        (step) => step.path === path || path.startsWith(`${step.path}.`)
      );
  }

  private chainFor(obj: THREE.Object3D): DocStep[] {
    if (!this.document) return [];
    const worldGroup = defsWorldGroupId(obj);
    const modelPath = worldGroup ? null : modelPathOf(obj);
    const nodeId = longestNodeId(obj);
    if (!modelPath && !worldGroup) return [];
    const key = `${worldGroup ? `def:${worldGroup}` : modelPath}|${nodeId ?? ""}`;
    const cached = this.chainCache.get(key);
    if (cached) return cached;
    const chain = documentChain(this.document, modelPath, nodeId, worldGroup);
    this.chainCache.set(key, chain);
    return chain;
  }

  /** Defs group on display. Null while a model use chain is showing. */
  private viewingDef(): string | null {
    const head = this.locationChain[0]?.path;
    if (!head?.startsWith("defs:")) return null;
    const id = head.slice("defs:".length).split(".")[0];
    return id || null;
  }

  /** Model instances and definition copies of the same group must not mix. */
  private inCurrentView(chain: DocStep[]): boolean {
    if (!chain.length) return false;
    const defId = this.viewingDef();
    if (defId) return chain[0]?.path === `defs:${defId}`;
    return chain[0]?.path.startsWith("model:") === true;
  }

  /**
   * Canonical loop copy is the one that stays solid.
   * Other copies stay in the scene, but this returns false once the scope has
   * reached that loop so they can be drawn faded instead of hidden.
   */
  private iterationVisible(chain: DocStep[], scope: string | null): boolean {
    if (!scope) return true;
    const scopeIdx = chain.findIndex((step) => step.path === scope);
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i]!;
      if (step.loopIndex === undefined) continue;
      if (scopeIdx >= 0 && i < scopeIdx && step.loopIndex !== 0) return false;
    }
    return true;
  }

  /** Highlight stays on the canonical copy once a loop has been entered. */
  private includeInHighlight(chain: DocStep[], path: string): boolean {
    if (!this.inCurrentView(chain)) return false;
    if (!chain.some((step) => step.path === path)) return false;
    const root = this.locationChain[0]?.path;
    if (root?.startsWith("model:") && chain[0]?.path !== root) return false;
    if (!this.iterationVisible(chain, this.scopePath)) return false;
    if (!this.scopePath) return true;
    const scopeIdx = this.locationChain.findIndex(
      (step) => step.path === this.scopePath
    );
    if (scopeIdx < 0) return true;
    for (const step of chain) {
      if (step.loopIndex === undefined || step.loopIndex === 0) continue;
      const loopIdx = this.locationChain.findIndex((item) => item.path === step.path);
      if (loopIdx >= 0 && scopeIdx >= loopIdx) return false;
    }
    return true;
  }

  /**
   * Current isolation level: formal `scopePath`, or a nested defs selection
   * (same for every kind — section is not special). Never isolate bare
   * `model:id.N` uses — those paths are not prefixes of child defs paths.
   */
  private isolationScope(): string | null {
    if (this.scopePath) return this.scopePath;
    const sel = this.highlightPath ?? this.selection;
    if (!sel?.startsWith("defs:")) return null;
    // `defs:groupId.child…` only — bare `defs:groupId` stays unisolated.
    const rest = sel.slice("defs:".length);
    if (!rest.includes(".")) return null;
    return sel;
  }

  private applyVisibility(): void {
    this.restoreGhosts();
    this.showAll();
    // Rebuild section planes before the visibility pass so they can be picked
    // while drilled into / soft-selecting a revolve.
    this.syncSectionProxies();
    if (
      this.scopePath &&
      this.document &&
      !nodeKindAtPath(this.document, this.scopePath)
    ) {
      this.scopePath = null;
      this.entryPath = null;
    }
    const scope = this.isolationScope();
    if (!scope) {
      this.viewer.setHelperFrame(null);
    } else {
      const root = this.viewer.viewer.root;
      root.traverse((obj) => {
        if (obj === root) return;
        // Section XOY proxy / profile wires: keep under the current branch.
        if (obj.userData?.sectionProxy) {
          // Visibility for overlays is finalized in `revealSectionOverlays`
          // (empty-chain parents must not stay hidden or profiles disappear).
          return;
        }
        const chain = this.chainFor(obj);
        if (!chain.length) {
          // Keep structural groups visible so section overlays parented under
          // them still render; only hide empty-chain leaves.
          if (obj.children.length === 0) obj.visible = false;
          return;
        }
        const role = this.drillRole(chain, scope);
        if (role.kind === "hidden") {
          obj.visible = false;
          return;
        }
        obj.visible = true;
        if (role.kind === "ghost") {
          this.ghostOne(obj, this.ancestorGhostOpacity(role.depth));
        }
      });
      // Other loop iterations stay on screen (faded) once that loop is entered,
      // including after a child of the loop body is edited and the view refreshes.
      if (this.scopePath) this.ghostIterations(this.scopePath);
    }
    this.revealSectionOverlays(scope);
    this.applySectionProxyDims(scope);
    // After overlays exist: section / path levels use the section XOY frame,
    // not the parent construct (revolve) solid matrix.
    this.viewer.setHelperFrame(scope ? this.frameFor(scope) : null);
    this.applyDefView();
    this.maybeFrameDef();
  }

  /**
   * Section plane + profile wires are editor overlays (not eval meshes).
   * While the section overlay is shown, the plane and **all** profile paths stay
   * opaque together — never ghost profiles with the construct solid. Selection
   * / highlight picks which path is active; visibility stays shared.
   */
  private revealSectionOverlays(scope: string | null): void {
    if (!scope) return;
    for (const [path, proxy] of this.sectionProxies) {
      const sectionKeep =
        path === scope ||
        path.startsWith(`${scope}.`) ||
        scope.startsWith(`${path}.`) ||
        parentTreePath(path) === scope ||
        parentTreePath(scope) === path;
      if (!sectionKeep) {
        proxy.root.visible = false;
        continue;
      }
      for (
        let p: THREE.Object3D | null = proxy.root;
        p && p !== this.viewer.viewer.root;
        p = p.parent
      ) {
        p.visible = true;
      }
      // Whole overlay subtree on — paths share display with the section.
      proxy.root.traverse((obj) => {
        obj.visible = true;
      });
    }
  }

  /**
   * Fade the section XOY plane when formally entered, or when the isolation
   * scope is a child under that section (selected 2D shape).
   */
  private applySectionProxyDims(scope: string | null): void {
    for (const [path, proxy] of this.sectionProxies) {
      const under =
        !!scope && (scope === path || scope.startsWith(`${path}.`));
      const dimmed =
        under &&
        (!!this.scopePath || (!!scope && scope.startsWith(`${path}.`)));
      proxy.setDrillDim(dimmed);
    }
  }

  /** Show the definition in world space, or the model uses when no def is open. */
  private applyDefView(): void {
    const defId = this.viewingDef();
    const root = this.viewer.viewer.root;
    for (const child of root.children) {
      const id = child.userData?.defsWorld;
      const worldId = typeof id === "string" ? id : "";
      if (defId) child.visible = worldId === defId;
      else if (worldId) child.visible = false;
    }
  }

  /**
   * Keep the camera where it is when the definition is already in frame,
   * so its world position stays comparable. Frame it only when it is off screen.
   */
  private maybeFrameDef(): void {
    const id = this.viewingDef();
    if (id === this.framedDef) return;
    this.framedDef = id;
    if (!id) return;
    const target = this.viewer.viewer.root.children.find(
      (child) => child.userData?.defsWorld === id
    );
    if (!target || this.objectInView(target)) return;
    this.viewer.viewer.fitCamera(this.viewer.camera, this.viewer.controls, {
      object: target,
    });
  }

  private objectInView(obj: THREE.Object3D): boolean {
    this.viewer.camera.updateMatrixWorld();
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return false;
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        this.viewer.camera.projectionMatrix,
        this.viewer.camera.matrixWorldInverse
      )
    );
    return frustum.intersectsBox(box);
  }

  private ghostIterations(scope: string): void {
    this.viewer.viewer.root.traverse((obj) => {
      // Section plane / profile overlays must stay opaque editor colors.
      if (obj.userData?.sectionProxy) return;
      const chain = this.chainFor(obj);
      if (!this.inCurrentView(chain)) return;
      if (this.iterationVisible(chain, scope)) return;
      if (!chain.some((step) => step.path === scope)) return;
      this.ghostOne(obj);
    });
  }

  /**
   * Opacity for an ancestor ghost by distance above the entered level.
   * depth 1 = entered node / parent of current children; higher = farther up.
   */
  private ancestorGhostOpacity(depth: number): number {
    const d = Math.max(1, depth);
    return Math.max(0.1, 0.36 * Math.pow(0.62, d - 1));
  }

  /**
   * Classify a scene object while drilled into `scope`:
   * - solid: current-level content (or everything under a model use)
   * - ghost: the entered node itself or a proper ancestor that has real mesh/line
   * - hidden: everything else
   * Shapeless groups never produce a mesh here — no invented outline.
   */
  private drillRole(
    chain: DocStep[],
    scope: string
  ): { kind: "solid" } | { kind: "ghost"; depth: number } | { kind: "hidden" } {
    if (!chain.length || !this.inCurrentView(chain)) return { kind: "hidden" };
    const last = chain[chain.length - 1]?.path;
    if (!last) return { kind: "hidden" };

    const scopeIdx = chain.findIndex((step) => step.path === scope);
    if (scopeIdx >= 0) {
      // Object lies on / under the entered node in the document chain.
      if (scopeIdx === chain.length - 1) {
        // Selected entity at this level stays solid; empty level ghosts it.
        if (this.highlightPath === scope || this.selection === scope) {
          return { kind: "solid" };
        }
        return { kind: "ghost", depth: 1 };
      }
      // Model `<s3dx:use>`: child geometry is tagged with defs paths, not
      // `model:id.N.*` — keep the whole referenced body solid.
      if (scope.startsWith("model:") && scope.includes(".")) {
        return { kind: "solid" };
      }
      // defs drill: only direct children of scope are the current level.
      if (parentTreePath(last) === scope) return { kind: "solid" };
      return { kind: "hidden" };
    }

    // Current-level child by path prefix (scope not present on mesh chains,
    // e.g. section / 2D under revolve).
    if (parentTreePath(last) === scope) return { kind: "solid" };

    // Deeper than current level under a defs path scope.
    if (last.startsWith(`${scope}.`)) return { kind: "hidden" };

    // Entered node’s own drawable when chains use matching defs paths.
    if (last === scope) {
      if (this.highlightPath === scope || this.selection === scope) {
        return { kind: "solid" };
      }
      return { kind: "ghost", depth: 1 };
    }

    // Proper ancestor of scope (revolve while inside section / 2D shape).
    if (scope.startsWith(`${last}.`)) {
      const depth = scope.slice(last.length).split(".").filter(Boolean).length;
      return { kind: "ghost", depth: Math.max(1, depth) };
    }

    return { kind: "hidden" };
  }

  private ghostOne(obj: THREE.Object3D, opacity = 0.16): void {
    // Never fade section overlays — they would pick up the construct ghost look.
    if (obj.userData?.sectionProxy) return;
    const drawable = obj as THREE.Mesh & THREE.Line;
    // Groups / empties have no drawable — do not invent a silhouette.
    if (!drawable.isMesh && !drawable.isLine) return;
    if (obj.userData.drillGhost) return;
    const source = drawable.material;
    const list = Array.isArray(source) ? source : [source];
    const clones = list.map((mat) => {
      const clone = mat.clone();
      const faded = clone as THREE.Material & {
        opacity?: number;
        transparent?: boolean;
        depthWrite?: boolean;
      };
      const base =
        typeof faded.opacity === "number" && Number.isFinite(faded.opacity)
          ? faded.opacity
          : 1;
      faded.transparent = true;
      faded.opacity = Math.min(base, opacity);
      faded.depthWrite = false;
      faded.needsUpdate = true;
      return clone;
    });
    this.ghostBackups.push({ object: drawable, material: source, clones });
    drawable.material = Array.isArray(source) ? clones : clones[0]!;
    obj.userData.drillGhost = true;
  }

  private restoreGhosts(): void {
    for (const backup of this.ghostBackups) {
      backup.object.material = backup.material;
      backup.object.userData.drillGhost = false;
      for (const clone of backup.clones) clone.dispose();
    }
    this.ghostBackups = [];
  }

  /** Restore ghost materials for drawables under `root` before disposing/rebuilding them. */
  private restoreGhostsUnder(root: THREE.Object3D): void {
    const under = new Set<THREE.Object3D>();
    root.traverse((obj) => under.add(obj));
    const kept: typeof this.ghostBackups = [];
    for (const backup of this.ghostBackups) {
      if (!under.has(backup.object)) {
        kept.push(backup);
        continue;
      }
      backup.object.material = backup.material;
      backup.object.userData.drillGhost = false;
      for (const clone of backup.clones) clone.dispose();
    }
    this.ghostBackups = kept;
  }

  private frameFor(scope: string): THREE.Object3D | null {
    // Section and its 2D children have no eval mesh — use the section pose frame.
    const sectionPath = sectionAncestorPath(this.document, scope);
    if (sectionPath) {
      this.ensureSectionProxy(sectionPath, false);
      const frame = this.sectionProxies.get(sectionPath)?.helperFrame;
      if (frame) return frame;
    }

    const root = this.viewer.viewer.root;
    let best: THREE.Object3D | null = null;
    let bestDepth = Infinity;
    root.traverse((obj) => {
      if (obj.userData?.sectionProxy) return;
      const chain = this.chainFor(obj);
      if (!this.inCurrentView(chain)) return;
      if (!chain.some((step) => step.path === scope)) return;
      const loop = chain.find((step) => step.path === scope);
      if (loop?.loopIndex !== undefined && loop.loopIndex !== 0) return;
      if (!this.iterationVisible(chain, scope)) return;
      let depth = 0;
      for (let parent = obj.parent; parent; parent = parent.parent) depth += 1;
      if (depth < bestDepth) {
        best = obj;
        bestDepth = depth;
      }
    });
    if (!best) return null;
    const last = this.chainFor(best)[this.chainFor(best).length - 1]?.path;
    const parent = (best as THREE.Object3D).parent;
    if (last !== scope && parent && parent !== root) return parent;
    return best;
  }

  /** Shallowest object whose chain ends on `path` (the node the gizmo should edit). */
  private objectFor(path: string): THREE.Object3D | null {
    const root = this.viewer.viewer.root;
    let best: THREE.Object3D | null = null;
    let bestDepth = Infinity;
    root.traverse((obj) => {
      const chain = this.chainFor(obj);
      if (!chain.length || !this.includeInHighlight(chain, path)) return;
      const last = chain[chain.length - 1]?.path;
      const modelUseRoot =
        path.startsWith("model:") && chain[0]?.path === path && chain.length <= 2;
      if (last !== path && !modelUseRoot) return;
      let depth = 0;
      for (let parent = obj.parent; parent; parent = parent.parent) depth += 1;
      if (depth < bestDepth) {
        best = obj;
        bestDepth = depth;
      }
    });
    return best;
  }

  private applyHighlight(): void {
    const path = this.highlightPath;
    if (!path) {
      this.highlight.clear();
      return;
    }
    // Section / its 2D children: overlay plane + profile wires (no eval mesh).
    const sectionPath = sectionAncestorPath(this.document, path);
    if (sectionPath) {
      // refresh=false: keep existing profile Lines so line-color highlight sticks.
      this.ensureSectionProxy(sectionPath, false);
      const objects =
        this.sectionProxies.get(sectionPath)?.highlightObjects(path) ?? [];
      if (objects.length) {
        this.highlight.setObjects(objects, path);
        return;
      }
    }
    const objects: THREE.Object3D[] = [];
    this.viewer.viewer.root.traverse((obj) => {
      if (obj.userData?.sectionProxy) return;
      const chain = this.chainFor(obj);
      if (!this.includeInHighlight(chain, path)) return;
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) objects.push(mesh);
      const line = obj as THREE.Line & { isLineSegments?: boolean };
      if (line.isLine && !line.isLineSegments) objects.push(line);
    });
    if (objects.length) {
      this.highlight.setObjects(objects, path);
      return;
    }
    const defId = this.viewingDef();
    if (defId) {
      const root = this.viewer.viewer.root.children.find(
        (child) => child.userData?.defsWorld === defId
      );
      if (root) this.highlight.set(root, path);
      else this.highlight.clear();
      return;
    }
    this.highlight.set(this.viewer.viewer.root, path);
  }

  private reapplyDrill(): void {
    if (
      this.scopePath &&
      this.document &&
      !nodeKindAtPath(this.document, this.scopePath)
    ) {
      this.scopePath = null;
      this.entryPath = null;
    }
    this.applyVisibility();
    this.emitDrill();
  }

  private reapplyHighlight(): void {
    this.applyHighlight();
    this.syncTransformTarget();
  }
}
