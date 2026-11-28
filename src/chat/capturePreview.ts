import { Vector3 } from "three";
import {
  DEFAULT_EYE_OFFSET,
  TOP_EYE_OFFSET,
  type EmbedViewer,
} from "svg3dx-viewer";

export type PreviewView = "current" | "front" | "side" | "top" | "iso";

export function normalizePreviewView(raw: string): PreviewView | null {
  const v = raw.trim().toLowerCase();
  if (!v || v === "current") return "current";
  if (v === "front") return "front";
  if (v === "side" || v === "right") return "side";
  if (v === "top") return "top";
  if (v === "iso" || v === "isometric") return "iso";
  return null;
}

function eyeFor(view: Exclude<PreviewView, "current">): Vector3 {
  if (view === "top") return TOP_EYE_OFFSET;
  if (view === "iso") return DEFAULT_EYE_OFFSET;
  if (view === "front") return new Vector3(0, -1, 0);
  return new Vector3(1, 0, 0);
}

function jpegFromCanvas(
  source: HTMLCanvasElement,
  maxEdge: number
): { dataUrl: string; width: number; height: number } | null {
  const sw = source.width;
  const sh = source.height;
  if (sw < 2 || sh < 2) return null;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.62),
    width,
    height,
  };
}

type PaintableViewer = EmbedViewer & { renderNow?: () => void };

/**
 * Read the viewport canvas. `renderNow` paints in this turn so the WebGL
 * buffer is still readable. The published viewer falls back to the next frame
 * that `invalidate` already queued.
 */
async function readFrame(
  viewer: PaintableViewer
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (typeof viewer.renderNow === "function") {
    viewer.renderNow();
    return jpegFromCanvas(viewer.renderer.domElement, 640);
  }
  viewer.invalidate();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve(jpegFromCanvas(viewer.renderer.domElement, 640));
    });
  });
}

export async function captureViewerFrame(
  viewer: EmbedViewer,
  view: PreviewView
): Promise<
  | { ok: true; view: PreviewView; dataUrl: string; width: number; height: number; framed: boolean }
  | { ok: false; message: string }
> {
  const camera = viewer.camera;
  const controls = viewer.controls;
  const saved = {
    pos: camera.position.clone(),
    target: controls.target.clone(),
    up: camera.up.clone(),
    near: camera.near,
    far: camera.far,
  };
  let framed = view === "current";
  try {
    if (view !== "current") {
      framed = viewer.viewer.fitCamera(camera, controls, {
        eyeOffset: eyeFor(view),
      });
    }
    const shot = await readFrame(viewer);
    if (!shot) return { ok: false, message: "viewport has no drawable size" };
    return { ok: true, view, ...shot, framed };
  } finally {
    if (view !== "current") {
      camera.position.copy(saved.pos);
      camera.up.copy(saved.up);
      camera.near = saved.near;
      camera.far = saved.far;
      camera.updateProjectionMatrix();
      controls.target.copy(saved.target);
      controls.update();
      const paintable = viewer as PaintableViewer;
      if (typeof paintable.renderNow === "function") paintable.renderNow();
      else paintable.invalidate();
    }
  }
}
