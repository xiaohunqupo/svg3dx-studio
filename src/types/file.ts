import type { StudioDocument } from "@/repos/types";

/** @deprecated Prefer StudioDocument — kept as alias for existing imports. */
export type StudioFile = StudioDocument;

/** Insertable geometry kinds (svg3dx draft 0.2). */
export type GeometryKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "cone"
  | "torus"
  | "wedge"
  | "pyramid"
  | "prism"
  | "sector-cylinder"
  | "point"
  | "line"
  | "arc"
  | "path"
  | "extrude"
  | "revolve"
  | "loft"
  | "sweep"
  | "pipe"
  | "gltf";

/** Bool / logic / loop containers (draft §5–7). */
export type ContainerKind =
  | "bool-union"
  | "bool-subtract"
  | "bool-intersect"
  | "if"
  | "if-not"
  | "loop-points"
  | "loop-range";

/** SMIL-shaped animation (draft §10) — insertable under groups / transform hosts. */
export type AnimationKind = "animate" | "animateTransform";

export type AddChildKind =
  | "group"
  | GeometryKind
  | ContainerKind
  | AnimationKind;
