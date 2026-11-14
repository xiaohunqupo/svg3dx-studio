export interface StudioFile {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
}

/** Basic solids from svg3dx draft 0.1 §3.2.2. */
export type GeometryKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "cone"
  | "torus"
  | "wedge"
  | "pyramid"
  | "prism"
  | "cutcylinder";

export type AddChildKind = "group" | GeometryKind;
