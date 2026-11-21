export interface StudioFile {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
  /** Base URL for resolving relative `s3dx:gltf` hrefs (e.g. official samples). */
  documentBaseUrl?: string;
}

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
