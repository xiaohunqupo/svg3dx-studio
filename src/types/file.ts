import type { StudioDocument } from "@/repos/types";

/** @deprecated Prefer StudioDocument — kept as alias for existing imports. */
export type StudioFile = StudioDocument;

/** Insertable geometry kinds (svg3dx draft 0.1). */
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

export type AddChildKind = "group" | GeometryKind | ContainerKind;
