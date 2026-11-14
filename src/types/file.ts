export interface StudioFile {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
}

export type GeometryKind =
  | "box"
  | "cylinder"
  | "sphere"
  | "cone"
  | "torus"
  | "wedge"
  | "pyramid"
  | "prism";
