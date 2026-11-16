export interface StudioFile {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
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
  | "pipe";

export type AddChildKind = "group" | GeometryKind;
