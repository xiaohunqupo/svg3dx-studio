/**
 * Geometry / boolean / logic icons from Lucide (`@lucide/vue`).
 * Re-export only — no wrappers, size, or stroke overrides.
 */
export {
  Box as BoxIcon,
  Boxes as DefsSectionIcon,
  BoxesLinked as ModelIcon,
  Cable as PipeIcon,
  ChartPie as SectorCylinderIcon,
  Circle as SphereIcon,
  CircleExclamationPoint as IfNotIcon,
  CircleQuestionMark as IfIcon,
  Cone as ConeIcon,
  Cuboid as ExtrudeIcon,
  Cylinder as CylinderIcon,
  DraftingCompass as CurveCategoryIcon,
  Globe as RootParamsIcon,
  Hexagon as PrismIcon,
  Layers2 as LoftIcon,
  Minus as LineIcon,
  Move3d as TransformMoveIcon,
  Orbit as SweepIcon,
  Pyramid as PyramidIcon,
  Radius as ArcIcon,
  Repeat as LoopIcon,
  Rotate3d as RevolveIcon,
  Rotate3d as ModelingCategoryIcon,
  Rotate3d as TransformRotateIcon,
  Scale3d as TransformScaleIcon,
  Spline as PathIcon,
  SquareDashed as GroupIcon,
  SquaresIntersect as BoolIntersectIcon,
  SquaresSubtract as BoolSubtractIcon,
  SquaresUnite as BoolUnionIcon,
  Torus as TorusIcon,
  Triangle as WedgeIcon,
} from "@lucide/vue";

import { Box, CircleQuestionMark, SquaresUnite } from "@lucide/vue";

export const SolidCategoryIcon = Box;
export const BoolCategoryIcon = SquaresUnite;
export const LogicCategoryIcon = CircleQuestionMark;
