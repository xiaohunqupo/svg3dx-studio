/**
 * Official svg3dx vocabulary (draft 0.1).
 * XML / file values stay English identifiers; UI shows locale labels.
 * Keep in sync with docs/svg3dx-vocab-draft-0.1.md.
 */

export type LocalePair = { zh: string; en: string };

/** Built-in material keywords (§8.5) — value saved is the English key. */
export const MATERIAL_LABELS = {
  default: { zh: "默认", en: "Default" },
  steel: { zh: "钢", en: "Steel" },
  stainless: { zh: "不锈钢", en: "Stainless" },
  aluminum: { zh: "铝", en: "Aluminum" },
  copper: { zh: "铜", en: "Copper" },
  brass: { zh: "黄铜", en: "Brass" },
  plastic: { zh: "塑料", en: "Plastic" },
  rubber: { zh: "橡胶", en: "Rubber" },
  concrete: { zh: "混凝土", en: "Concrete" },
  glass: { zh: "玻璃", en: "Glass" },
  wood: { zh: "木材", en: "Wood" },
} as const satisfies Record<string, LocalePair>;

export type MaterialKey = keyof typeof MATERIAL_LABELS;

/** Element / type official names (§3.2). */
export const ELEMENT_LABELS = {
  line: { zh: "直线", en: "Line" },
  arc: { zh: "圆弧", en: "Arc" },
  path: { zh: "路径", en: "Path" },
  box: { zh: "长方体", en: "Box" },
  cylinder: { zh: "圆柱", en: "Cylinder" },
  sphere: { zh: "球体", en: "Sphere" },
  cone: { zh: "圆锥", en: "Cone" },
  torus: { zh: "圆环", en: "Torus" },
  wedge: { zh: "楔体", en: "Wedge" },
  prism: { zh: "棱柱", en: "Prism" },
  "sector-cylinder": { zh: "扇形柱", en: "Sector Cylinder" },
  pyramid: { zh: "棱锥", en: "Pyramid" },
  extrude: { zh: "拉伸体", en: "Extrude" },
  revolve: { zh: "旋转体", en: "Revolve" },
  loft: { zh: "放样体", en: "Loft" },
  sweep: { zh: "扫掠体", en: "Sweep" },
  pipe: { zh: "圆管", en: "Pipe" },
  mesh: { zh: "网格", en: "Mesh" },
  triangles: { zh: "三角面", en: "Triangles" },
  section: { zh: "截面", en: "Section" },
  "bool-union": { zh: "并集", en: "Union" },
  "bool-subtract": { zh: "差集", en: "Subtract" },
  "bool-intersect": { zh: "交集", en: "Intersect" },
  if: { zh: "如果", en: "If" },
  "if-not": { zh: "如果非", en: "If not" },
  "loop-points": { zh: "点列循环", en: "Loop points" },
  "loop-range": { zh: "范围循环", en: "Loop range" },
  use: { zh: "引用", en: "Use" },
  model: { zh: "模型", en: "Model" },
  material: { zh: "材质", en: "Material" },
  materials: { zh: "材质集", en: "Materials" },
  exp: { zh: "表达式", en: "Expression" },
  group: { zh: "组", en: "Group" },
} as const satisfies Record<string, LocalePair>;

export type ElementKey = keyof typeof ELEMENT_LABELS;

/**
 * Standard attribute official names.
 * Keys are XML attribute local names (or `s3dx:transform` / transform parts).
 */
export const ATTR_LABELS = {
  // common / identity
  id: { zh: "标识", en: "id" },
  class: { zh: "分类", en: "class" },
  type: { zh: "类型", en: "type" },
  href: { zh: "引用", en: "href" },
  mode: { zh: "模式", en: "mode" },
  form: { zh: "形式", en: "form" },
  test: { zh: "条件", en: "test" },
  active: { zh: "激活", en: "active" },
  svg3d: { zh: "三维开关", en: "svg3d" },

  // appearance §8
  fill: { zh: "填充", en: "fill" },
  material: { zh: "材质", en: "material" },
  opacity: { zh: "不透明度", en: "opacity" },
  color: { zh: "颜色", en: "color" },
  metalness: { zh: "金属度", en: "metalness" },
  roughness: { zh: "粗糙度", en: "roughness" },

  // transform
  "s3dx:transform": { zh: "变换", en: "transform" },
  transform: { zh: "变换", en: "transform" },
  xdir: { zh: "X 轴方向", en: "xdir" },
  ydir: { zh: "Y 轴方向", en: "ydir" },
  zdir: { zh: "Z 轴方向", en: "zdir" },
  /** Inspector expand part — SVG/CSS translate / spec tx ty tz. */
  translation: { zh: "平移", en: "translation" },

  // geometry
  length: { zh: "长度", en: "length" },
  width: { zh: "宽度", en: "width" },
  height: { zh: "高度", en: "height" },
  lengthVec: { zh: "长度方向", en: "lengthVec" },
  widthVec: { zh: "宽度方向", en: "widthVec" },
  diameter: { zh: "直径", en: "diameter" },
  bottomCenterPt: { zh: "底面圆心", en: "bottomCenterPt" },
  topCenterPt: { zh: "顶面圆心", en: "topCenterPt" },
  radius: { zh: "半径", en: "radius" },
  center: { zh: "中心", en: "center" },
  bottomDiameter: { zh: "底面直径", en: "bottomDiameter" },
  topDiameter: { zh: "顶面直径", en: "topDiameter" },
  diameter1: { zh: "主直径", en: "diameter1" },
  diameter2: { zh: "圆管直径", en: "diameter2" },
  angle: { zh: "角度", en: "angle" },
  torusCenterPt: { zh: "环心", en: "torusCenterPt" },
  normal: { zh: "法向", en: "normal" },
  topLength: { zh: "顶边长度", en: "topLength" },
  topWidth: { zh: "顶边宽度", en: "topWidth" },
  points: { zh: "点列", en: "points" },
  from: { zh: "起点", en: "from" },
  to: { zh: "终点", en: "to" },
  xDir: { zh: "X 方向", en: "xDir" },
  startAngle: { zh: "起始角", en: "startAngle" },
  origin: { zh: "原点", en: "origin" },
  dir: { zh: "方向", en: "dir" },
  solid: { zh: "实体", en: "solid" },
  blend: { zh: "混合", en: "blend" },
  orient: { zh: "姿态", en: "orient" },
  refDir: { zh: "参考方向", en: "refDir" },
  corner: { zh: "转角", en: "corner" },
  cornerRadius: { zh: "转角半径", en: "cornerRadius" },
  path: { zh: "路径", en: "path" },
  innerRadius: { zh: "内半径", en: "innerRadius" },
  start: { zh: "起点值", en: "start" },
  end: { zh: "终点值", en: "end" },
  step: { zh: "步长", en: "step" },
} as const satisfies Record<string, LocalePair>;

export type AttrKey = keyof typeof ATTR_LABELS;

/** `orient` enum values (§3.2 sweep). */
export const ORIENT_VALUE_LABELS = {
  frenet: { zh: "平行搬运", en: "Frenet" },
  fixed: { zh: "固定参考", en: "Fixed" },
  parallel: { zh: "平行朝上", en: "Parallel" },
} as const satisfies Record<string, LocalePair>;

export type OrientValueKey = keyof typeof ORIENT_VALUE_LABELS;

/** `corner` enum values (§3.2 sweep / pipe). */
export const CORNER_VALUE_LABELS = {
  arc: { zh: "圆弧弯", en: "Arc" },
  chamfer: { zh: "倒角弯", en: "Chamfer" },
  sharp: { zh: "尖角", en: "Sharp" },
  miter: { zh: "斜接", en: "Miter" },
} as const satisfies Record<string, LocalePair>;

export type CornerValueKey = keyof typeof CORNER_VALUE_LABELS;

/**
 * Shared `form` enum values (§3.2).
 * Not every primitive uses every value — see `primitiveForms.ts`.
 */
export const FORM_VALUE_LABELS = {
  angles: { zh: "角参数", en: "Angles" },
  ends: { zh: "起终点", en: "Endpoints" },
  polyline: { zh: "折线", en: "Polyline" },
  segments: { zh: "曲线段", en: "Segments" },
  /** Pipe trajectory shorthand only (`sweep` is always child path). */
  inline: { zh: "内联", en: "Inline" },
  child: { zh: "子路径", en: "Child path" },
} as const satisfies Record<string, LocalePair>;

export type FormValueKey = keyof typeof FORM_VALUE_LABELS;

/** `blend` enum values (§3.2 loft approach law). */
export const BLEND_VALUE_LABELS = {
  linear: { zh: "线性", en: "Linear" },
  sine: { zh: "正弦", en: "Sine" },
  cosine: { zh: "余弦", en: "Cosine" },
  tan: { zh: "正切", en: "Tan" },
  cotan: { zh: "余切", en: "Cotan" },
} as const satisfies Record<string, LocalePair>;

export type BlendValueKey = keyof typeof BLEND_VALUE_LABELS;
