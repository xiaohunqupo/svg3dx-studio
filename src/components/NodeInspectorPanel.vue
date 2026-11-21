<script setup lang="ts">
import { computed, h, reactive, ref, watch } from "vue";
import { ChevronDownIcon, ChevronUpIcon } from "tdesign-icons-vue-next";
import { BUILTIN_MATERIALS, type GeometryInstruction } from "svg3dx-viewer";
import {
  DialogPlugin,
  MessagePlugin,
  type SelectOption,
} from "tdesign-vue-next";
import type { TreeSelectPayload } from "@/components/NodeTreePanel.vue";
import StyleParamEditor from "@/components/StyleParamEditor.vue";
import BlendAttrSelect from "@/components/BlendAttrSelect.vue";
import CornerAttrSelect from "@/components/CornerAttrSelect.vue";
import VecRgbInput from "@/components/VecRgbInput.vue";
import ExprAttrInput from "@/components/ExprAttrInput.vue";
import HrefRefInput from "@/components/HrefRefInput.vue";
import { PenToolIcon } from "@/components/icons/lucideIcons";
import { useI18n } from "@/i18n";
import { isSectionEditable } from "@/utils/shapeSvgEditor";
import {
  APPEARANCE_ATTR_NAMES,
  APPEARANCE_FIELDS,
  BOOL_ATTR_VALUES,
  GROUP_BASIC_FIELDS,
  IDENTITY_TRANSFORM_DISPLAY,
  MODEL_MODE_VALUES,
  TRANSFORM_FIELDS,
  TRANSFORM_PART_KEYS,
  TRANSFORM_TRS_KEYS,
  REVOLVE_SECTION_TRANSFORM_DISPLAY,
  convertTransformForm,
  detectTransformForm,
  emptyTransformParts,
  emptyTransformTrs,
  evaluateTransformToMatrix12,
  isIdentityTransformDisplay,
  transformFormSwitchNeedsConfirm,
  looksLikeVecRgbText,
  primitiveAttrFields,
  syncTransformPartsFromDisplay,
  syncTransformTrsFromDisplay,
  transformDisplayFromParts,
  transformDisplayFromTrs,
  transformPartPlaceholder,
  transformToAttr,
  transformToDisplay,
  transformTrsPlaceholder,
  type AttrField,
  type TransformForm,
  type TransformPartKey,
  type TransformParts,
  type TransformTrs,
  type TransformTrsKey,
} from "@/utils/nodeSchema";
import { previewExprResult } from "@/utils/exprEval";
import {
  extractDocumentMaterials,
  normalizeMaterialAttr,
} from "@/utils/documentMaterials";
import {
  DEFAULT_FILL_HEX8,
  DEFAULT_MATERIAL_COLOR_HEX8,
  fillToHex8,
  hex8ToFill,
} from "@/utils/fillColor";
import { nodeKindAtPath, readAttrsAtPath } from "@/utils/nodeXmlEdit";
import { parentTreePath } from "@/interact/sectionProxy";
import {
  collectParamSourceGroups,
  effectiveBareParamNames,
} from "@/utils/paramScope";
import {
  extractDefsGroups,
  isValidStyleCategoryName,
  listStyleCategories,
} from "@/utils/styleClasses";
import { blankIfEqualsDefault } from "@/utils/attrDefault";
import {
  inactiveFormAttrNames,
  inferPrimitiveForm,
  primitiveFormSpec,
} from "@/utils/primitiveForms";

const props = defineProps<{
  selected: TreeSelectPayload | null;
  /** Raw SVG — source of truth for editable attributes. */
  content?: string;
}>();

const emit = defineEmits<{
  styleParamsChange: [propsMap: Record<string, string>];
  styleCategoryRename: [payload: { from: string; to: string }];
  nodeAttrsChange: [payload: { path: string; updates: Record<string, string> }];
  editSection: [payload: { path: string }];
  pickGltfHref: [payload: { path: string }];
}>();

const canEditSectionProfile = computed(() => {
  const sel = props.selected;
  if (!sel || sel.kind !== "geometry" || !props.content) return false;
  return isSectionEditable(props.content, sel.path);
});

function openSectionProfile(): void {
  const sel = props.selected;
  if (!sel || sel.kind !== "geometry") return;
  emit("editSection", { path: sel.path });
}

const isGltfHrefField = computed(() => {
  const sel = props.selected;
  if (!sel || sel.kind !== "geometry") return false;
  return sel.node.type === "primitive" && sel.node.kind === "gltf";
});

function browseGltfHref(): void {
  const sel = props.selected;
  if (!sel || sel.kind !== "geometry") return;
  emit("pickGltfHref", { path: sel.path });
}

const {
  t,
  tagLabel,
  attrLabel,
  attrValueLabel,
  elementLabel,
  materialLabel,
  modeLabel,
} = useI18n();

type FieldRow = AttrField & {
  key: string;
  value: string;
  readonly?: boolean;
  /** Hover tip on the value (e.g. raw XML type / kind). */
  valueTitle?: string;
};

type Section = {
  id: string;
  title: string;
  fields: FieldRow[];
};

/** Local draft values keyed by attr name (per selection). */
const draft = reactive<Record<string, string>>({});
let draftPath = "";

/** Open inspector sections (collapse panel values). */
const openSections = ref<Array<string | number>>([]);
/** Style inspector sections — keep basic + params expanded together. */
const styleOpenSections = ref<Array<string | number>>(["basic", "params"]);
/** Material inspector section. */
const materialOpenSections = ref<Array<string | number>>(["basic"]);
/** Model inspector sections. */
const modelOpenSections = ref<Array<string | number>>(["basic", "transform"]);

/** Color swatch / picker fallback: fill default vs material color default. */
const colorSwatchDefaultHex = computed(() =>
  props.selected?.kind === "material"
    ? DEFAULT_MATERIAL_COLOR_HEX8
    : DEFAULT_FILL_HEX8
);

/** Draft key for the shared color control (`fill` on geometry, `color` on material). */
function colorDraftAttr(): "fill" | "color" {
  return props.selected?.kind === "material" ? "color" : "fill";
}

function nodeTypeLabel(node: GeometryInstruction): string {
  switch (node.type) {
    case "primitive":
      return elementLabel(node.kind);
    case "group":
      return tagLabel("group");
    case "bool_op":
      return elementLabel(`bool-${node.op}`);
    case "instance":
      return tagLabel("use");
    default:
      return "node";
  }
}

/** Raw type token for hover tip (XML / kind id, not localized). */
function nodeTypeRaw(node: GeometryInstruction): string {
  switch (node.type) {
    case "primitive":
      return node.kind;
    case "group":
      return "g";
    case "bool_op":
      return `bool-${node.op}`;
    case "instance":
      return "use";
    default:
      return "node";
  }
}

function withTypeTip(row: FieldRow, raw: string): FieldRow {
  row.valueTitle = raw;
  return row;
}

function fieldDisplayName(name: string): string {
  return attrLabel(name);
}

function attrLookup(
  xmlAttrs: Record<string, string> | null,
  name: string
): string {
  if (!xmlAttrs) return "";
  if (name in xmlAttrs) return xmlAttrs[name] ?? "";
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(xmlAttrs)) {
    if (k.toLowerCase() === lower) return v;
  }
  if (name.includes(":")) {
    const local = name.split(":")[1]!;
    for (const [k, v] of Object.entries(xmlAttrs)) {
      if (k === name || k.endsWith(`:${local}`) || k === local) return v;
    }
  }
  return "";
}

/**
 * Transform shown for a section: XML value, or revolve's effective XY→XOZ
 * default when unset (so the inspector matches the section plane / eval).
 */
function sectionTransformDisplay(
  content: string,
  path: string,
  xmlAttrs: Record<string, string> | null
): string {
  const raw = attrLookup(xmlAttrs, "s3dx:transform");
  if (raw.trim()) return raw;
  const parent = parentTreePath(path);
  if (parent && nodeKindAtPath(content, parent)?.kind === "revolve") {
    return transformToAttr(REVOLVE_SECTION_TRANSFORM_DISPLAY);
  }
  return "";
}

/** HEX8 string shown in the fill text input / swatch (not the XML form). */
const fillHexUi = ref("");

/** Expanded editors for s3dx:transform (axes or TRS). */
const transformExpanded = ref(false);
const transformForm = ref<TransformForm>("matrix");
const transformParts = reactive<TransformParts>(emptyTransformParts());
const transformTrs = reactive<TransformTrs>(emptyTransformTrs());

function seedDraft(fields: FieldRow[], path: string): void {
  const pathChanged = draftPath !== path;
  draftPath = path;
  for (const k of Object.keys(draft)) delete draft[k];
  const docIds = new Set(
    extractDocumentMaterials(props.content ?? "").map((m) => m.id)
  );
  fillHexUi.value = "";
  // Keep transform split open across content refreshes on the same node
  // (commit → XML update → watch). Only collapse when selection path changes.
  if (pathChanged) {
    transformExpanded.value = false;
  }
  Object.assign(transformParts, emptyTransformParts());
  Object.assign(transformTrs, emptyTransformTrs());
  for (const f of fields) {
    if (f.name === "material") {
      draft[f.name] = normalizeMaterialAttr(f.value, docIds);
    } else if (f.name === "s3dx:transform") {
      draft[f.name] = transformToDisplay(f.value);
      transformForm.value = detectTransformForm(f.value || draft[f.name]);
      Object.assign(transformParts, syncTransformPartsFromDisplay(draft[f.name]));
      Object.assign(transformTrs, syncTransformTrsFromDisplay(draft[f.name]));
    } else if (f.name === "fill" || f.name === "color") {
      draft[f.name] = f.value;
      fillHexUi.value = fillToHex8(f.value);
    } else {
      // Studio rule: value === placeholder/default → show as unset.
      draft[f.name] = blankIfEqualsDefault(f.value, f.placeholder, f.name);
    }
  }
}

const styleIsRoot = computed(
  () => props.selected?.kind === "style" && props.selected.scope === "root"
);

const styleClassName = computed(() => {
  if (props.selected?.kind !== "style") return "";
  if (props.selected.scope === "root") return ":root";
  return props.selected.name.split(/\s+/).filter(Boolean)[0] ?? "";
});

const styleBasicFields = computed((): FieldRow[] => {
  if (props.selected?.kind !== "style" || !styleClassName.value) return [];
  // Touch locale so labels refresh on language switch.
  void attrLabel("class");
  void tagLabel("category");
  if (styleIsRoot.value) {
    return [
      {
        key: "style:type",
        name: "type",
        value: tagLabel("root"),
        readonly: true,
        valueTitle: ":root",
      },
      {
        key: "style:selector",
        name: "selector",
        value: ":root",
        readonly: true,
      },
    ];
  }
  return [
    {
      key: "style:type",
      name: "type",
      value: tagLabel("category"),
      readonly: true,
      valueTitle: "class",
    },
    {
      key: "style:class",
      name: "class",
      value: styleClassName.value,
    },
  ];
});

/** Categories from `<style>` (excl. `:root`) for the class / 分类 picker. */
const styleCategoryNames = computed(() =>
  listStyleCategories(props.content ?? "")
);

function classFieldWithCategories(value: string): AttrField {
  const cur = value.trim();
  const cats = styleCategoryNames.value;
  const enumValues =
    cur && !cats.includes(cur) ? [...cats, cur] : [...cats];
  return { name: "class", enumValues };
}

const materialBasicFields = computed((): FieldRow[] => {
  if (props.selected?.kind !== "material") return [];
  // Touch locale via attrLabel/tagLabel so labels refresh on language switch.
  void attrLabel("type");
  const sel = props.selected;
  const xml = props.content ? readAttrsAtPath(props.content, sel.path) : null;
  return [
    {
      key: "material:type",
      name: "type",
      value: tagLabel("material"),
      readonly: true,
      valueTitle: "material",
    },
    {
      key: "material:id",
      name: "id",
      value: xml?.id ?? sel.materialId,
    },
    {
      key: "material:color",
      name: "color",
      value: xml?.color ?? sel.color ?? "",
      placeholder: DEFAULT_MATERIAL_COLOR_HEX8,
    },
    {
      key: "material:metalness",
      name: "metalness",
      value: xml?.metalness ?? String(sel.metalness ?? ""),
      placeholder: "0",
    },
    {
      key: "material:roughness",
      name: "roughness",
      value: xml?.roughness ?? String(sel.roughness ?? ""),
      placeholder: "0.5",
    },
  ];
});

const modelBasicFields = computed((): FieldRow[] => {
  if (props.selected?.kind !== "model") return [];
  void attrLabel("type");
  void modeLabel("solid");
  const sel = props.selected;
  const xml = props.content ? readAttrsAtPath(props.content, sel.path) : null;
  return [
    {
      key: "model:type",
      name: "type",
      value: tagLabel("model"),
      readonly: true,
      valueTitle: "model",
    },
    {
      key: "model:id",
      name: "id",
      value: xml?.id ?? sel.modelId,
    },
    {
      key: "model:mode",
      name: "mode",
      value: attrLookup(xml, "mode") || "solid",
      placeholder: "solid",
      enumValues: MODEL_MODE_VALUES,
    },
    {
      key: "model:active",
      name: "active",
      value: attrLookup(xml, "active"),
      enumValues: BOOL_ATTR_VALUES,
    },
  ];
});

const modelTransformFields = computed((): FieldRow[] => {
  if (props.selected?.kind !== "model") return [];
  const xml = props.content
    ? readAttrsAtPath(props.content, props.selected.path)
    : null;
  return TRANSFORM_FIELDS.map((f) => ({
    ...f,
    key: `model:${f.name}`,
    value: attrLookup(xml, f.name),
  }));
});

const modelAllFields = computed((): FieldRow[] => [
  ...modelBasicFields.value,
  ...modelTransformFields.value,
]);

const geometryView = computed(() => {
  const sel = props.selected;
  if (!sel || sel.kind !== "geometry") return null;

  const node = sel.node;
  const path = sel.path;
  const xmlAttrs = props.content ? readAttrsAtPath(props.content, path) : null;

  const sections: Section[] = [];
  const allFields: FieldRow[] = [];

  const pushField = (
    sectionId: string,
    field: AttrField,
    value: string,
    readonly = false
  ): FieldRow => {
    const row: FieldRow = {
      ...field,
      key: `${sectionId}:${field.name}`,
      value,
      readonly,
    };
    allFields.push(row);
    return row;
  };

  if (node.type === "group") {
    const basic: FieldRow[] = [
      withTypeTip(
        pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
        nodeTypeRaw(node)
      ),
      ...GROUP_BASIC_FIELDS.map((f) => {
        let value = attrLookup(xmlAttrs, f.name);
        if (!value && f.name === "id") value = node.id ?? "";
        if (!value && f.name === "class" && sel.className) value = sel.className;
        if (f.name === "class") {
          return pushField("basic", classFieldWithCategories(value), value);
        }
        return pushField("basic", f, value);
      }),
    ];
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: basic,
    });

    sections.push({
      id: "appearance",
      title: t("app.appearance"),
      fields: APPEARANCE_FIELDS.map((f) =>
        pushField("appearance", f, attrLookup(xmlAttrs, f.name))
      ),
    });

    const xformVal = attrLookup(xmlAttrs, "s3dx:transform");
    sections.push({
      id: "transform",
      title: t("app.transform"),
      fields: TRANSFORM_FIELDS.map((f) =>
        pushField("transform", f, f.name === "s3dx:transform" ? xformVal : "")
      ),
    });
  } else if (node.type === "primitive") {
    const idVal = attrLookup(xmlAttrs, "id");
    const classVal = attrLookup(xmlAttrs, "class") || sel.className || "";
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: [
        withTypeTip(
          pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
          nodeTypeRaw(node)
        ),
        pushField("basic", { name: "id" }, idVal),
        pushField("basic", classFieldWithCategories(classVal), classVal),
      ],
    });

    const schema = primitiveAttrFields(node.kind);
    const inferredForm = primitiveFormSpec(node.kind)
      ? inferPrimitiveForm(node.kind, xmlAttrs ?? {})
      : "";
    const paramFields = schema.map((f) => {
      let value = attrLookup(xmlAttrs, f.name);
      if (f.name === "form" && !value && inferredForm) value = inferredForm;
      return pushField("params", f, value);
    });
    if (xmlAttrs) {
      const known = new Set([
        ...schema.map((f) => f.name.toLowerCase()),
        "id",
        "class",
        "style",
        "s3dx:transform",
        "transform",
        ...APPEARANCE_ATTR_NAMES,
      ]);
      for (const [name, value] of Object.entries(xmlAttrs)) {
        if (known.has(name.toLowerCase())) continue;
        if (name.startsWith("xmlns")) continue;
        paramFields.push(pushField("params", { name }, value));
      }
    }
    sections.push({
      id: "params",
      title: t("app.basicParams"),
      fields: paramFields,
    });

    sections.push({
      id: "appearance",
      title: t("app.appearance"),
      fields: APPEARANCE_FIELDS.map((f) =>
        pushField("appearance", f, attrLookup(xmlAttrs, f.name))
      ),
    });

    const xformVal =
      node.kind === "section"
        ? sectionTransformDisplay(props.content ?? "", path, xmlAttrs)
        : attrLookup(xmlAttrs, "s3dx:transform");
    sections.push({
      id: "transform",
      title: t("app.transform"),
      fields: TRANSFORM_FIELDS.map((f) =>
        pushField("transform", f, f.name === "s3dx:transform" ? xformVal : "")
      ),
    });
  } else if (node.type === "instance") {
    const idVal = attrLookup(xmlAttrs, "id") || sel.className || "";
    // Prefer XML href only — do not fall back to node.group_id, or clearing
    // the attr would be immediately restored on the next seedDraft.
    const hrefVal = attrLookup(xmlAttrs, "href");
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: [
        withTypeTip(
          pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
          nodeTypeRaw(node)
        ),
        pushField("basic", { name: "id" }, idVal),
        pushField("basic", { name: "href" }, hrefVal),
      ],
    });
    const xformVal = attrLookup(xmlAttrs, "s3dx:transform");
    sections.push({
      id: "transform",
      title: t("app.transform"),
      fields: TRANSFORM_FIELDS.map((f) =>
        pushField("transform", f, f.name === "s3dx:transform" ? xformVal : "")
      ),
    });
  } else {
    const otherClassVal = attrLookup(xmlAttrs, "class");
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: [
        withTypeTip(
          pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
          nodeTypeRaw(node)
        ),
        pushField("basic", { name: "id" }, attrLookup(xmlAttrs, "id")),
        pushField(
          "basic",
          classFieldWithCategories(otherClassVal),
          otherClassVal
        ),
      ],
    });

    sections.push({
      id: "appearance",
      title: t("app.appearance"),
      fields: APPEARANCE_FIELDS.map((f) =>
        pushField("appearance", f, attrLookup(xmlAttrs, f.name))
      ),
    });

    if (xmlAttrs) {
      const skip = new Set([
        "xmlns",
        "type",
        "id",
        "class",
        "style",
        "s3dx:transform",
        "transform",
        ...APPEARANCE_ATTR_NAMES,
      ]);
      const extras = Object.entries(xmlAttrs)
        .filter(
          ([n]) => !n.startsWith("xmlns") && !skip.has(n.toLowerCase())
        )
        .map(([name, value]) => pushField("params", { name }, value));
      if (extras.length) {
        sections.push({
          id: "params",
          title: t("app.basicParams"),
          fields: extras,
        });
      }
    }

    const xformVal = attrLookup(xmlAttrs, "s3dx:transform");
    sections.push({
      id: "transform",
      title: t("app.transform"),
      fields: TRANSFORM_FIELDS.map((f) =>
        pushField("transform", f, f.name === "s3dx:transform" ? xformVal : "")
      ),
    });
  }

  return { path, title: nodeTypeLabel(node), sections, allFields };
});

watch(
  () =>
    [
      props.selected?.kind,
      props.selected && "path" in props.selected ? props.selected.path : "",
      props.content,
    ] as const,
  () => {
    if (props.selected?.kind === "style") {
      openSections.value = [];
      styleOpenSections.value = ["basic", "params"];
      materialOpenSections.value = ["basic"];
      fillHexUi.value = "";
      transformExpanded.value = false;
      Object.assign(transformParts, emptyTransformParts());
      if (styleIsRoot.value) {
        draftPath = "";
        for (const k of Object.keys(draft)) delete draft[k];
      } else {
        seedDraft(styleBasicFields.value, props.selected.path);
      }
      return;
    }
    if (props.selected?.kind === "material") {
      const path = props.selected.path;
      const samePath = draftPath === path;
      openSections.value = [];
      materialOpenSections.value = ["basic"];
      transformExpanded.value = false;
      Object.assign(transformParts, emptyTransformParts());
      seedDraft(materialBasicFields.value, path);
      if (!samePath) materialOpenSections.value = ["basic"];
      return;
    }
    if (props.selected?.kind === "model") {
      const path = props.selected.path;
      const samePath = draftPath === path;
      openSections.value = [];
      materialOpenSections.value = ["basic"];
      seedDraft(modelAllFields.value, path);
      if (!samePath) modelOpenSections.value = ["basic", "transform"];
      return;
    }
    const view = geometryView.value;
    if (!view) {
      draftPath = "";
      openSections.value = [];
      fillHexUi.value = "";
      transformExpanded.value = false;
      Object.assign(transformParts, emptyTransformParts());
      for (const k of Object.keys(draft)) delete draft[k];
      return;
    }
    const samePath = draftPath === view.path;
    seedDraft(view.allFields, view.path);
    if (!samePath) {
      openSections.value = view.sections.map((s) => s.id);
    }
  },
  { immediate: true }
);

function commitField(name: string): void {
  const view = geometryView.value;
  if (!view || draftPath !== view.path) return;
  if (name === "type") return;
  const updates: Record<string, string> = {};
  let changed = false;
  for (const f of view.allFields) {
    if (f.readonly || f.name === "type") continue;
    // Hidden form-dependent fields are not written; cleared below when form applies.
    if (!isFieldVisible(f) && f.visibleWhen?.name === "form") {
      continue;
    }
    let raw = (draft[f.name] ?? "").trim();
    if (f.name === "s3dx:transform") {
      if (isIdentityTransformDisplay(raw)) raw = "";
    } else {
      raw = blankIfEqualsDefault(raw, f.placeholder, f.name);
    }
    // Keep draft aligned with the unset-default rule.
    if (draft[f.name] !== raw) draft[f.name] = raw;
    const next =
      f.name === "s3dx:transform" ? transformToAttr(raw) : raw;
    const prev =
      f.name === "s3dx:transform"
        ? transformToAttr(f.value ?? "")
        : blankIfEqualsDefault(f.value ?? "", f.placeholder, f.name);
    updates[f.name] = next;
    if (next !== prev) changed = true;
  }

  const sel = props.selected;
  const kind =
    sel?.kind === "geometry" && sel.node?.type === "primitive"
      ? sel.node.kind
      : "";
  if (kind && primitiveFormSpec(kind)) {
    const form =
      (updates.form ?? draft.form ?? "").trim() ||
      inferPrimitiveForm(kind, { ...draft, ...updates });
    if (form) {
      const prevForm =
        view.allFields.find((f) => f.name === "form")?.value?.trim() ?? "";
      updates.form = form;
      draft.form = form;
      if (form !== prevForm) changed = true;
      for (const inactive of inactiveFormAttrNames(kind, form)) {
        const prev =
          view.allFields.find((f) => f.name === inactive)?.value?.trim() ?? "";
        const cur = (updates[inactive] ?? draft[inactive] ?? "").trim();
        if (cur || prev) {
          updates[inactive] = "";
          draft[inactive] = "";
          changed = true;
        }
      }
    }
  }

  if (!changed) return;
  emit("nodeAttrsChange", { path: view.path, updates });
}

/** Commit editable material node attributes (id / color / metalness / roughness). */
function commitMaterialAttrs(_name?: string): void {
  const sel = props.selected;
  if (!sel || sel.kind !== "material" || draftPath !== sel.path) return;
  const fields = materialBasicFields.value;
  const updates: Record<string, string> = {};
  let changed = false;
  for (const f of fields) {
    if (f.readonly || f.name === "type") continue;
    const next = blankIfEqualsDefault(
      draft[f.name] ?? "",
      f.placeholder,
      f.name
    );
    if (draft[f.name] !== next) draft[f.name] = next;
    const prev = blankIfEqualsDefault(f.value ?? "", f.placeholder, f.name);
    updates[f.name] = next;
    if (next !== prev) changed = true;
  }
  if (!changed) return;
  // id is required — restore previous when cleared
  if (!updates.id) {
    draft.id = sel.materialId;
    return;
  }
  emit("nodeAttrsChange", { path: sel.path, updates });
}

/** Commit editable model attrs (id / mode / active / transform). */
function commitModelAttrs(_name?: string): void {
  const sel = props.selected;
  if (!sel || sel.kind !== "model" || draftPath !== sel.path) return;
  const fields = modelAllFields.value;
  const updates: Record<string, string> = {};
  let changed = false;
  for (const f of fields) {
    if (f.readonly || f.name === "type") continue;
    let raw = (draft[f.name] ?? "").trim();
    if (f.name === "s3dx:transform") {
      if (isIdentityTransformDisplay(raw)) raw = "";
    } else {
      raw = blankIfEqualsDefault(raw, f.placeholder, f.name);
    }
    if (draft[f.name] !== raw) draft[f.name] = raw;
    const next =
      f.name === "s3dx:transform" ? transformToAttr(raw) : raw;
    const prev =
      f.name === "s3dx:transform"
        ? transformToAttr(f.value ?? "")
        : blankIfEqualsDefault(f.value ?? "", f.placeholder, f.name);
    updates[f.name] = next;
    if (next !== prev) changed = true;
  }
  if (!changed) return;
  if (!updates.id) {
    draft.id = sel.modelId;
    return;
  }
  if (!updates.mode) {
    draft.mode = "solid";
    updates.mode = "solid";
  }
  emit("nodeAttrsChange", { path: sel.path, updates });
}

function onModelEnumChange(name: string, value: unknown): void {
  if (value == null || value === "") {
    draft[name] = "";
  } else if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    draft[name] = String(value);
  } else {
    return;
  }
  commitModelAttrs(name);
}

let fillCommitTimer: ReturnType<typeof setTimeout> | null = null;

function commitColorAttr(): void {
  if (props.selected?.kind === "material") commitMaterialAttrs("color");
  else commitField("fill");
}

function scheduleFillCommit(): void {
  if (fillCommitTimer) clearTimeout(fillCommitTimer);
  fillCommitTimer = setTimeout(() => {
    fillCommitTimer = null;
    commitColorAttr();
  }, 180);
}

/** Panel / complete pick: write RGBA fill/color and normalize HEX8 UI. */
function applyFillHex(hex: string, immediate = false): void {
  const attr = colorDraftAttr();
  const raw = hex.trim();
  if (!raw) {
    draft[attr] = "";
    fillHexUi.value = "";
    if (immediate) commitColorAttr();
    else scheduleFillCommit();
    return;
  }
  const fill = hex8ToFill(raw);
  if (!fill) return;
  draft[attr] = fill;
  fillHexUi.value = fillToHex8(fill);
  if (immediate) commitColorAttr();
  else scheduleFillCommit();
}

function onFillPanelChange(hex: string): void {
  applyFillHex(hex ?? "");
}

/** Text input: commit only on blur/enter so partial typing is not expanded. */
function commitFillFromUi(): void {
  const attr = colorDraftAttr();
  const raw = fillHexUi.value.trim();
  if (!raw) {
    applyFillHex("", true);
    return;
  }
  if (!hex8ToFill(raw)) {
    // Invalid partial/garbage — restore last committed color.
    fillHexUi.value = fillToHex8(draft[attr] ?? "");
    return;
  }
  applyFillHex(raw, true);
}

function onFillClear(): void {
  if (fillCommitTimer) {
    clearTimeout(fillCommitTimer);
    fillCommitTimer = null;
  }
  draft[colorDraftAttr()] = "";
  fillHexUi.value = "";
  commitColorAttr();
}

function syncExpandedFromCompact(): void {
  const raw = draft["s3dx:transform"] ?? "";
  transformForm.value = detectTransformForm(raw);
  Object.assign(transformParts, syncTransformPartsFromDisplay(raw));
  Object.assign(transformTrs, syncTransformTrsFromDisplay(raw));
}

/** Compact row: when expanded, mirror split editors; identity stays empty. */
const transformCompactShown = computed(() => {
  if (transformExpanded.value) {
    if (transformForm.value === "trs") {
      const next = transformDisplayFromTrs(transformTrs);
      if (!next || isIdentityTransformDisplay(next)) return "";
      return next;
    }
    const next = transformDisplayFromParts(transformParts);
    if (!next || isIdentityTransformDisplay(next)) return "";
    return next;
  }
  return draft["s3dx:transform"] ?? "";
});

function toggleTransformExpand(): void {
  if (!transformExpanded.value) {
    syncExpandedFromCompact();
    transformExpanded.value = true;
    return;
  }
  if (transformForm.value === "trs") {
    const next = transformDisplayFromTrs(transformTrs);
    if (next == null) syncExpandedFromCompact();
    else draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  } else {
    const next = transformDisplayFromParts(transformParts);
    if (next == null) syncExpandedFromCompact();
    else draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  }
  transformExpanded.value = false;
}

function evalTransformToken(tok: string): number | null {
  const preview = previewExprResult(tok, effectiveParamValues.value);
  if (preview == null) return null;
  const n = Number(preview);
  return Number.isFinite(n) ? n : null;
}

function applyTransformDraft(attr: string, commit: "field" | "model"): void {
  draft["s3dx:transform"] = attr;
  transformForm.value = detectTransformForm(attr);
  Object.assign(transformParts, syncTransformPartsFromDisplay(attr));
  Object.assign(transformTrs, syncTransformTrsFromDisplay(attr));
  if (commit === "model") commitModelAttrs("s3dx:transform");
  else commitField("s3dx:transform");
}

function onTransformFormRadio(value: unknown): void {
  const next: TransformForm = value === "trs" ? "trs" : "matrix";
  requestSwitchTransformForm(next);
}

function performTransformFormSwitch(
  next: TransformForm,
  raw: string,
  evaluated: number[]
): void {
  const attr = convertTransformForm(raw, next, evaluated);
  const isModel = props.selected?.kind === "model";
  applyTransformDraft(
    attr === "" ? "" : transformToDisplay(attr),
    isModel ? "model" : "field"
  );
  transformForm.value = next;
  transformExpanded.value = true;
}

function requestSwitchTransformForm(next: TransformForm): void {
  if (next === transformForm.value) return;
  const raw = (draft["s3dx:transform"] ?? "").trim();
  const evaluated = evaluateTransformToMatrix12(raw, evalTransformToken);
  if (!evaluated) {
    MessagePlugin.warning(t("app.switchTransformFormFailed"));
    return;
  }
  const run = () => performTransformFormSwitch(next, raw, evaluated);
  // Only warn when conversion would drop expressions or shear / non-TRS linear part.
  if (!transformFormSwitchNeedsConfirm(raw, evaluated)) {
    run();
    return;
  }
  const dialog = DialogPlugin.confirm({
    header: t("app.switchTransformFormTitle"),
    body: t("app.switchTransformFormBody"),
    confirmBtn: t("app.switchTransformFormConfirm"),
    onConfirm: () => {
      dialog.destroy();
      run();
    },
  });
}

function commitTransformCompact(): void {
  if (transformExpanded.value) return;
  const raw = (draft["s3dx:transform"] ?? "").trim();
  if (raw && isIdentityTransformDisplay(raw)) {
    draft["s3dx:transform"] = "";
  }
  transformForm.value = detectTransformForm(draft["s3dx:transform"] ?? "");
  syncExpandedFromCompact();
  commitField("s3dx:transform");
}

function clearTransform(): void {
  if (transformExpanded.value) return;
  draft["s3dx:transform"] = "";
  transformForm.value = "matrix";
  Object.assign(transformParts, emptyTransformParts());
  Object.assign(transformTrs, emptyTransformTrs());
  commitField("s3dx:transform");
}

function commitTransformParts(): void {
  const next = transformDisplayFromParts(transformParts);
  if (next == null) {
    syncExpandedFromCompact();
    return;
  }
  draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  transformForm.value = "matrix";
  Object.assign(
    transformParts,
    syncTransformPartsFromDisplay(draft["s3dx:transform"])
  );
  commitField("s3dx:transform");
}

function clearTransformPart(key: TransformPartKey): void {
  transformParts[key] = "";
  commitTransformParts();
}

function commitTransformTrs(): void {
  const next = transformDisplayFromTrs(transformTrs);
  if (next == null) {
    syncExpandedFromCompact();
    return;
  }
  draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  transformForm.value = "trs";
  Object.assign(transformTrs, syncTransformTrsFromDisplay(draft["s3dx:transform"]));
  commitField("s3dx:transform");
}

function clearTransformTrsChannel(key: TransformTrsKey): void {
  transformTrs[key] = "";
  commitTransformTrs();
}

function commitModelTransformCompact(): void {
  if (transformExpanded.value) return;
  const raw = (draft["s3dx:transform"] ?? "").trim();
  if (raw && isIdentityTransformDisplay(raw)) {
    draft["s3dx:transform"] = "";
  }
  transformForm.value = detectTransformForm(draft["s3dx:transform"] ?? "");
  syncExpandedFromCompact();
  commitModelAttrs("s3dx:transform");
}

function clearModelTransform(): void {
  if (transformExpanded.value) return;
  draft["s3dx:transform"] = "";
  transformForm.value = "matrix";
  Object.assign(transformParts, emptyTransformParts());
  Object.assign(transformTrs, emptyTransformTrs());
  commitModelAttrs("s3dx:transform");
}

function commitModelTransformParts(): void {
  const next = transformDisplayFromParts(transformParts);
  if (next == null) {
    syncExpandedFromCompact();
    return;
  }
  draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  transformForm.value = "matrix";
  Object.assign(
    transformParts,
    syncTransformPartsFromDisplay(draft["s3dx:transform"])
  );
  commitModelAttrs("s3dx:transform");
}

function clearModelTransformPart(key: TransformPartKey): void {
  transformParts[key] = "";
  commitModelTransformParts();
}

function commitModelTransformTrs(): void {
  const next = transformDisplayFromTrs(transformTrs);
  if (next == null) {
    syncExpandedFromCompact();
    return;
  }
  draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  transformForm.value = "trs";
  Object.assign(transformTrs, syncTransformTrsFromDisplay(draft["s3dx:transform"]));
  commitModelAttrs("s3dx:transform");
}

function clearModelTransformTrsChannel(key: TransformTrsKey): void {
  transformTrs[key] = "";
  commitModelTransformTrs();
}

/** Flat rows so transform parts sit as siblings of s3dx:transform. */
type InspectorRow =
  | { kind: "field"; field: FieldRow }
  | { kind: "transform-part"; key: TransformPartKey }
  | { kind: "transform-trs"; key: TransformTrsKey }
  | { kind: "transform-form-toggle" };
/** Whether a schema field should show, given current draft values. */
function isFieldVisible(field: AttrField): boolean {
  const rule = field.visibleWhen;
  if (!rule) return true;
  const raw = (draft[rule.name] ?? "").trim();
  const cur = raw || rule.whenEmpty || "";
  return rule.values.includes(cur);
}

function enumOptionsFor(field: AttrField): SelectOption[] {
  return (field.enumValues ?? []).map((value) => ({
    label:
      field.name === "mode"
        ? modeLabel(value)
        : attrValueLabel(field.name, value),
    value,
  }));
}

function classSelectOptions(current: string): SelectOption[] {
  const cur = current.trim();
  const cats = styleCategoryNames.value;
  const values = cur && !cats.includes(cur) ? [...cats, cur] : cats;
  return values.map((value) => ({ label: value, value }));
}

function onEnumAttrChange(name: string, value: unknown): void {
  if (value == null || value === "") {
    draft[name] = "";
  } else if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    draft[name] = String(value);
  } else {
    return;
  }
  commitField(name);
}

/** Effective checked state for boolean attrs (empty → placeholder default). */
function isBoolAttrChecked(field: AttrField): boolean {
  const raw = (draft[field.name] ?? "").trim().toLowerCase();
  if (!raw) {
    return (field.placeholder ?? "true").trim().toLowerCase() !== "false";
  }
  return raw === "true" || raw === "1" || raw === "yes";
}

function onBoolAttrChange(field: AttrField, checked: unknown): void {
  const on = checked === true || checked === "true" || checked === 1;
  draft[field.name] = on ? "true" : "false";
  commitField(field.name);
}

function rowsForSection(fields: FieldRow[]): InspectorRow[] {
  const rows: InspectorRow[] = [];
  for (const field of fields) {
    rows.push({ kind: "field", field });
    if (field.name === "s3dx:transform" && transformExpanded.value) {
      rows.push({ kind: "transform-form-toggle" });
      if (transformForm.value === "trs") {
        for (const key of TRANSFORM_TRS_KEYS) {
          rows.push({ kind: "transform-trs", key });
        }
      } else {
        for (const key of TRANSFORM_PART_KEYS) {
          rows.push({ kind: "transform-part", key });
        }
      }
    }
  }
  return rows;
}

/** Points / vectors / matrices whose numbers should render as R·G·B segments. */
function isVecRgbField(field: AttrField): boolean {
  if (field.name === "s3dx:transform") {
    return detectTransformForm(draft["s3dx:transform"] ?? "") === "matrix";
  }
  return looksLikeVecRgbText(field.placeholder ?? "");
}

/** Scalar geometry attrs that accept literals / var / calc. */
const EXPR_ATTR_SKIP = new Set([
  "id",
  "class",
  "type",
  "form",
  "href",
  "xlink:href",
  "fill",
  "material",
  "opacity",
  "s3dx:transform",
  "blend",
  "orient",
  "outerCorner",
  "innerCorner",
  "solid",
  "path",
]);

function isExprScalarField(field: AttrField): boolean {
  if (EXPR_ATTR_SKIP.has(field.name)) return false;
  if (isVecRgbField(field)) return false;
  return true;
}

const paramSourceGroups = computed(() => {
  const sel = props.selected;
  if (!sel || sel.kind !== "geometry" || !props.content) return [];
  return collectParamSourceGroups(props.content, sel.path);
});

const effectiveParamNames = computed(() =>
  effectiveBareParamNames(paramSourceGroups.value)
);

/** Top-level `<g id>` under `<defs>` — href targets for `<s3dx:use>`. */
const defsHrefOptions = computed(() =>
  extractDefsGroups(props.content ?? "").map((g) => g.id)
);

/** Effective param bare-name → value, for expression result preview. */
const effectiveParamValues = computed(() => {
  const map = new Map<string, string>();
  for (const g of paramSourceGroups.value) {
    for (const it of g.items) {
      if (!it.overridden) map.set(it.bare, it.value);
    }
  }
  return map;
});

function swatchStyle(colorRaw: string | undefined): Record<string, string> {
  const hex = colorRaw ? fillToHex8(colorRaw) : "";
  return {
    display: "inline-block",
    width: "12px",
    height: "12px",
    borderRadius: "2px",
    flexShrink: "0",
    border: "1px solid var(--td-component-border)",
    background: hex || "transparent",
  };
}

function materialOptionContent(label: string, colorRaw?: string) {
  return () =>
    h(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          minWidth: 0,
        },
      },
      [h("span", { style: swatchStyle(colorRaw) }), h("span", label)]
    );
}

type MaterialOption = {
  label: string;
  value: string;
  content: () => ReturnType<typeof h>;
};

/** TDesign default dropdown is 300px — too short once groups + swatches stack. */
const materialSelectPopupProps = {
  overlayInnerStyle: { maxHeight: "480px" },
};

/** RGBA color for the closed select preview (unset → builtin default). */
const selectedMaterialColor = computed((): string | undefined => {
  const cur = (draft.material ?? "").trim();
  const ref = cur || "default";
  const url = /^url\(\s*#([^)\s]+)\s*\)$/i.exec(ref);
  const docs = extractDocumentMaterials(props.content ?? "");
  if (url) {
    const doc = docs.find((m) => m.id === url[1]);
    return doc?.color;
  }
  const builtin = BUILTIN_MATERIALS[ref];
  if (builtin?.color) return builtin.color.join(" ");
  const bare = docs.find((m) => m.id === ref);
  return bare?.color;
});

const materialSelectOptions = computed((): SelectOption[] => {
  const builtin: MaterialOption[] = Object.entries(BUILTIN_MATERIALS).map(
    ([id, desc]) => {
      const label = materialLabel(id);
      return {
        label,
        value: id,
        content: materialOptionContent(
          label,
          desc.color ? desc.color.join(" ") : undefined
        ),
      };
    }
  );

  const docs = extractDocumentMaterials(props.content ?? "");
  const documentOpts: MaterialOption[] = docs.map((m) => ({
    label: m.id,
    value: `url(#${m.id})`,
    content: materialOptionContent(m.id, m.color),
  }));

  const groups: SelectOption[] = [
    {
      group: t("app.materialBuiltin"),
      children: builtin,
    },
  ];
  if (documentOpts.length) {
    groups.push({
      group: t("app.materialDocument"),
      children: documentOpts,
    });
  }

  const cur = (draft.material ?? "").trim();
  if (cur) {
    const known = new Set([
      ...builtin.map((o) => o.value),
      ...documentOpts.map((o) => o.value),
    ]);
    if (!known.has(cur)) {
      groups.push({
        group: t("app.materialOther"),
        children: [{ label: cur, value: cur }],
      });
    }
  }

  return groups;
});

function onMaterialChange(value: unknown): void {
  if (value == null || value === "") {
    draft.material = "";
  } else if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    draft.material = String(value);
  } else {
    return;
  }
  commitField("material");
}

function onMaterialClear(): void {
  draft.material = "";
  commitField("material");
}

function onStyleChange(map: Record<string, string>): void {
  emit("styleParamsChange", map);
}

function commitStyleCategoryName(): void {
  if (props.selected?.kind !== "style" || styleIsRoot.value) return;
  if (draftPath !== props.selected.path) return;
  const from = styleClassName.value;
  const to = (draft.class ?? "").trim();
  if (!to || to === from) {
    draft.class = from;
    return;
  }
  if (!isValidStyleCategoryName(to)) {
    MessagePlugin.warning(t("app.styleCategoryInvalid"));
    draft.class = from;
    return;
  }
  const taken = styleCategoryNames.value.some(
    (c) => c !== from && c === to
  );
  if (taken) {
    MessagePlugin.warning(t("app.styleCategoryDuplicate"));
    draft.class = from;
    return;
  }
  emit("styleCategoryRename", { from, to });
}
</script>

<template>
  <div class="node-inspector">
    <!-- Style -->
    <template v-if="selected?.kind === 'style' && styleClassName">
      <t-collapse
        v-model="styleOpenSections"
        expand-icon-placement="left"
        class="param-collapse"
      >
        <t-collapse-panel value="basic" :header="t('app.basicInfo')">
          <div class="param-fields">
            <div
              v-for="field in styleBasicFields"
              :key="field.key"
              class="param-row"
              :class="{ 'readonly-row': field.readonly }"
            >
              <span class="name" :title="field.name">{{
                fieldDisplayName(field.name)
              }}</span>
              <span
                v-if="field.readonly"
                class="value"
                :title="field.valueTitle || undefined"
                >{{ draft[field.name] ?? field.value }}</span
              >
              <div v-else class="value-cell">
                <t-input
                  v-model="draft[field.name]"
                  size="small"
                  class="value-input"
                  @blur="commitStyleCategoryName"
                  @enter="commitStyleCategoryName"
                />
              </div>
            </div>
          </div>
        </t-collapse-panel>
        <t-collapse-panel value="params" :header="t('app.paramDefs')">
          <StyleParamEditor
            :class-name="styleClassName"
            :model-value="selected.props"
            embedded
            @change="onStyleChange"
          />
        </t-collapse-panel>
      </t-collapse>
    </template>

    <!-- Model -->
    <template v-else-if="selected?.kind === 'model'">
      <t-collapse
        v-model="modelOpenSections"
        expand-icon-placement="left"
        class="param-collapse"
      >
        <t-collapse-panel value="basic" :header="t('app.basicInfo')">
          <div class="param-fields">
            <div
              v-for="field in modelBasicFields"
              :key="field.key"
              class="param-row"
              :class="{ 'readonly-row': field.readonly }"
            >
              <span class="name" :title="field.name">{{
                fieldDisplayName(field.name)
              }}</span>
              <span
                v-if="field.readonly"
                class="value"
                :title="field.valueTitle || undefined"
                >{{ draft[field.name] ?? field.value }}</span
              >
              <div v-else class="value-cell">
                <t-select
                  v-if="field.enumValues"
                  :value="draft[field.name] || undefined"
                  :options="enumOptionsFor(field)"
                  clearable
                  size="small"
                  :placeholder="
                    field.placeholder
                      ? field.name === 'mode'
                        ? modeLabel(field.placeholder)
                        : attrValueLabel(field.name, field.placeholder)
                      : t('app.unsetHint')
                  "
                  class="enum-select"
                  @change="(v: unknown) => onModelEnumChange(field.name, v)"
                  @clear="() => onModelEnumChange(field.name, '')"
                />
                <t-input
                  v-else
                  v-model="draft[field.name]"
                  size="small"
                  clearable
                  :placeholder="field.placeholder || undefined"
                  class="value-input"
                  @blur="commitModelAttrs(field.name)"
                  @enter="commitModelAttrs(field.name)"
                  @clear="
                    () => {
                      draft[field.name] = '';
                      commitModelAttrs(field.name);
                    }
                  "
                />
              </div>
            </div>
          </div>
        </t-collapse-panel>
        <t-collapse-panel value="transform" :header="t('app.transform')">
          <div class="param-fields">
            <div
              v-for="field in modelTransformFields"
              :key="field.key"
              class="param-row"
            >
              <span
                class="name"
                :title="
                  fieldDisplayName(field.name) !== field.name
                    ? field.name
                    : undefined
                "
              >
                <span class="name-label">{{
                  fieldDisplayName(field.name)
                }}</span>
                <t-button
                  size="small"
                  variant="text"
                  shape="square"
                  class="name-action"
                  :title="
                    transformExpanded
                      ? t('app.collapseTransform')
                      : t('app.expandTransform')
                  "
                  @click="toggleTransformExpand"
                >
                  <template #icon>
                    <ChevronUpIcon v-if="transformExpanded" />
                    <ChevronDownIcon v-else />
                  </template>
                </t-button>
              </span>
              <div class="value-cell">
                <ExprAttrInput
                  :model-value="transformCompactShown"
                  :readonly="transformExpanded"
                  :clearable="!transformExpanded"
                  class="value-input"
                  :placeholder="
                    transformForm === 'trs'
                      ? 'translate(0 0 0) rotate(0 0 0) scale(1 1 1)'
                      : IDENTITY_TRANSFORM_DISPLAY
                  "
                  :param-groups="paramSourceGroups"
                  :effective-names="effectiveParamNames"
                  :param-values="effectiveParamValues"
                  @update:model-value="
                    (v: string) => {
                      if (!transformExpanded)
                        draft['s3dx:transform'] = String(v ?? '');
                    }
                  "
                  @blur="commitModelTransformCompact"
                  @enter="commitModelTransformCompact"
                  @clear="clearModelTransform"
                />
              </div>
            </div>
            <div
              v-if="transformExpanded"
              class="param-row transform-form-row"
            >
              <span class="name">{{ t("app.transformFormMode") }}</span>
              <div class="value-cell">
                <t-radio-group
                  :value="transformForm"
                  size="small"
                  variant="default-filled"
                  @change="onTransformFormRadio"
                >
                  <t-radio-button value="matrix">{{
                    t("app.transformFormAxes")
                  }}</t-radio-button>
                  <t-radio-button value="trs">{{
                    t("app.transformFormTrs")
                  }}</t-radio-button>
                </t-radio-group>
              </div>
            </div>
            <div
              v-for="key in transformExpanded && transformForm === 'matrix'
                ? TRANSFORM_PART_KEYS
                : []"
              :key="key"
              class="param-row"
            >
              <span class="name">{{ fieldDisplayName(key) }}</span>
              <div class="value-cell">
                <VecRgbInput
                  v-model="transformParts[key]"
                  clearable
                  class="value-input"
                  :placeholder="transformPartPlaceholder(key)"
                  :max-components="3"
                  :param-groups="paramSourceGroups"
                  :effective-names="effectiveParamNames"
                  :param-values="effectiveParamValues"
                  @blur="commitModelTransformParts"
                  @enter="commitModelTransformParts"
                  @clear="() => clearModelTransformPart(key)"
                />
              </div>
            </div>
            <div
              v-for="key in transformExpanded && transformForm === 'trs'
                ? TRANSFORM_TRS_KEYS
                : []"
              :key="key"
              class="param-row"
            >
              <span class="name">{{ fieldDisplayName(key) }}</span>
              <div class="value-cell">
                <VecRgbInput
                  v-model="transformTrs[key]"
                  clearable
                  class="value-input"
                  :placeholder="transformTrsPlaceholder(key)"
                  :max-components="3"
                  :param-groups="paramSourceGroups"
                  :effective-names="effectiveParamNames"
                  :param-values="effectiveParamValues"
                  @blur="commitModelTransformTrs"
                  @enter="commitModelTransformTrs"
                  @clear="() => clearModelTransformTrsChannel(key)"
                />
              </div>
            </div>
          </div>
        </t-collapse-panel>
      </t-collapse>
    </template>

    <!-- Material -->
    <template v-else-if="selected?.kind === 'material'">
      <t-collapse
        v-model="materialOpenSections"
        expand-icon-placement="left"
        class="param-collapse"
      >
        <t-collapse-panel value="basic" :header="t('app.basicInfo')">
          <div class="param-fields">
            <div
              v-for="field in materialBasicFields"
              :key="field.key"
              class="param-row"
              :class="{ 'readonly-row': field.readonly }"
            >
              <span class="name" :title="field.name">{{
                fieldDisplayName(field.name)
              }}</span>
              <span
                v-if="field.readonly"
                class="value"
                :title="field.valueTitle || undefined"
                >{{ draft[field.name] ?? field.value }}</span
              >
              <div v-else class="value-cell">
                <div
                  v-if="field.name === 'color'"
                  class="fill-color-field"
                >
                  <t-popup
                    trigger="click"
                    placement="bottom-left"
                    :overlay-inner-style="{ padding: '0' }"
                  >
                    <button
                      type="button"
                      class="fill-swatch"
                      :class="{ 'is-default': !fillHexUi }"
                      :style="{
                        background: fillHexUi || colorSwatchDefaultHex,
                      }"
                      :aria-label="field.name"
                    />
                    <template #content>
                      <t-color-picker-panel
                        :model-value="fillHexUi || colorSwatchDefaultHex"
                        format="HEX8"
                        enable-alpha
                        :color-modes="['monochrome']"
                        @change="(v: string) => onFillPanelChange(v)"
                      />
                    </template>
                  </t-popup>
                  <t-input
                    v-model="fillHexUi"
                    size="small"
                    clearable
                    :placeholder="
                      field.placeholder || colorSwatchDefaultHex
                    "
                    class="fill-hex-input"
                    @blur="commitFillFromUi"
                    @enter="commitFillFromUi"
                    @clear="onFillClear"
                  />
                </div>
                <t-input
                  v-else
                  v-model="draft[field.name]"
                  size="small"
                  clearable
                  :placeholder="field.placeholder || undefined"
                  class="value-input"
                  @blur="commitMaterialAttrs(field.name)"
                  @enter="commitMaterialAttrs(field.name)"
                  @clear="
                    () => {
                      draft[field.name] = '';
                      commitMaterialAttrs(field.name);
                    }
                  "
                />
              </div>
            </div>
          </div>
        </t-collapse-panel>
      </t-collapse>
    </template>

    <div v-else-if="!geometryView" class="muted">{{ t("app.clickNode") }}</div>

    <!-- Geometry / group -->
    <template v-else>
      <div v-if="canEditSectionProfile" class="section-profile-action">
        <t-button
          size="small"
          variant="outline"
          @click="openSectionProfile"
        >
          <template #icon>
            <PenToolIcon :size="14" :stroke-width="1.75" />
          </template>
          {{ t("app.editSectionProfile") }}
        </t-button>
      </div>
      <t-collapse
        v-model="openSections"
        expand-icon-placement="left"
        class="param-collapse"
      >
        <t-collapse-panel
          v-for="sec in geometryView.sections"
          :key="sec.id"
          :value="sec.id"
          :header="sec.title"
        >
          <div class="param-fields">
            <template
              v-for="row in rowsForSection(sec.fields)"
              :key="
                row.kind === 'field'
                  ? row.field.key
                  : row.kind === 'transform-form-toggle'
                    ? 'xform:form'
                    : `xform:${row.key}`
              "
            >
              <!-- Form toggle: axes vs TRS -->
              <div
                v-if="row.kind === 'transform-form-toggle'"
                class="param-row transform-form-row"
              >
                <span class="name">{{ t("app.transformFormMode") }}</span>
                <div class="value-cell">
                  <t-radio-group
                    :value="transformForm"
                    size="small"
                    variant="default-filled"
                    @change="onTransformFormRadio"
                  >
                    <t-radio-button value="matrix">{{
                      t("app.transformFormAxes")
                    }}</t-radio-button>
                    <t-radio-button value="trs">{{
                      t("app.transformFormTrs")
                    }}</t-radio-button>
                  </t-radio-group>
                </div>
              </div>

              <!-- Transform axis parts: peer rows of s3dx:transform -->
              <div
                v-else-if="row.kind === 'transform-part'"
                class="param-row transform-part-row"
              >
                <span class="name" :title="row.key">{{
                  fieldDisplayName(row.key)
                }}</span>
                <div class="value-cell">
                  <VecRgbInput
                    v-model="transformParts[row.key]"
                    clearable
                    class="value-input"
                    :placeholder="transformPartPlaceholder(row.key)"
                    :max-components="3"
                    :param-groups="paramSourceGroups"
                    :effective-names="effectiveParamNames"
                    :param-values="effectiveParamValues"
                    @blur="commitTransformParts"
                    @enter="commitTransformParts"
                    @clear="() => clearTransformPart(row.key)"
                  />
                </div>
              </div>

              <!-- TRS channels -->
              <div
                v-else-if="row.kind === 'transform-trs'"
                class="param-row transform-part-row"
              >
                <span class="name" :title="row.key">{{
                  fieldDisplayName(row.key)
                }}</span>
                <div class="value-cell">
                  <VecRgbInput
                    v-model="transformTrs[row.key]"
                    clearable
                    class="value-input"
                    :placeholder="transformTrsPlaceholder(row.key)"
                    :max-components="3"
                    :param-groups="paramSourceGroups"
                    :effective-names="effectiveParamNames"
                    :param-values="effectiveParamValues"
                    @blur="commitTransformTrs"
                    @enter="commitTransformTrs"
                    @clear="() => clearTransformTrsChannel(row.key)"
                  />
                </div>
              </div>

              <div
                v-else-if="row.kind === 'field' && isFieldVisible(row.field)"
                class="param-row"
                :class="{ 'readonly-row': row.field.readonly }"
              >
                <span
                  class="name"
                  :class="{
                    'name--with-action': row.field.name === 's3dx:transform',
                  }"
                  :title="
                    row.field.description ||
                    (fieldDisplayName(row.field.name) !== row.field.name
                      ? row.field.name
                      : undefined)
                  "
                >
                  <span class="name-label">{{
                    fieldDisplayName(row.field.name)
                  }}</span>
                  <t-button
                    v-if="row.field.name === 's3dx:transform'"
                    size="small"
                    variant="text"
                    shape="square"
                    class="name-action"
                    :title="
                      transformExpanded
                        ? t('app.collapseTransform')
                        : t('app.expandTransform')
                    "
                    @click="toggleTransformExpand"
                  >
                    <template #icon>
                      <ChevronUpIcon v-if="transformExpanded" />
                      <ChevronDownIcon v-else />
                    </template>
                  </t-button>
                </span>
                <span
                  v-if="row.field.readonly"
                  class="value"
                  :title="row.field.valueTitle || undefined"
                  >{{ draft[row.field.name] ?? row.field.value }}</span
                >
                <div v-else class="value-cell">
                  <div
                    v-if="row.field.name === 'fill'"
                    class="fill-color-field"
                  >
                    <t-popup
                      trigger="click"
                      placement="bottom-left"
                      :overlay-inner-style="{ padding: '0' }"
                    >
                      <button
                        type="button"
                        class="fill-swatch"
                        :class="{ 'is-default': !fillHexUi }"
                        :style="{
                          background: fillHexUi || colorSwatchDefaultHex,
                        }"
                        :aria-label="row.field.name"
                      />
                      <template #content>
                        <t-color-picker-panel
                          :model-value="fillHexUi || colorSwatchDefaultHex"
                          format="HEX8"
                          enable-alpha
                          :color-modes="['monochrome']"
                          @change="(v: string) => onFillPanelChange(v)"
                        />
                      </template>
                    </t-popup>
                    <t-input
                      v-model="fillHexUi"
                      size="small"
                      clearable
                      :placeholder="
                        row.field.placeholder || colorSwatchDefaultHex
                      "
                      class="fill-hex-input"
                      @blur="commitFillFromUi"
                      @enter="commitFillFromUi"
                      @clear="onFillClear"
                    />
                  </div>
                  <t-checkbox
                    v-else-if="row.field.boolean"
                    :checked="isBoolAttrChecked(row.field)"
                    class="bool-check"
                    @change="(v: unknown) => onBoolAttrChange(row.field, v)"
                  />
                  <BlendAttrSelect
                    v-else-if="row.field.name === 'blend'"
                    :model-value="draft[row.field.name]"
                    clearable
                    :placeholder="
                      row.field.placeholder
                        ? attrValueLabel('blend', row.field.placeholder)
                        : t('app.unsetHint')
                    "
                    @change="(v: string) => onEnumAttrChange('blend', v)"
                    @clear="() => onEnumAttrChange('blend', '')"
                  />
                  <CornerAttrSelect
                    v-else-if="
                      row.field.name === 'outerCorner' ||
                      row.field.name === 'innerCorner'
                    "
                    :model-value="draft[row.field.name]"
                    clearable
                    :placeholder="
                      row.field.placeholder
                        ? attrValueLabel(row.field.name, row.field.placeholder)
                        : t('app.unsetHint')
                    "
                    @change="(v: string) => onEnumAttrChange(row.field.name, v)"
                    @clear="() => onEnumAttrChange(row.field.name, '')"
                  />
                  <t-select
                    v-else-if="
                      row.field.enumValues || row.field.name === 'class'
                    "
                    :value="draft[row.field.name] || undefined"
                    :options="
                      row.field.name === 'class'
                        ? classSelectOptions(draft[row.field.name] ?? '')
                        : enumOptionsFor(row.field)
                    "
                    clearable
                    size="small"
                    :placeholder="
                      row.field.name === 'class'
                        ? ''
                        : row.field.placeholder
                          ? attrValueLabel(
                              row.field.name,
                              row.field.placeholder
                            )
                          : t('app.unsetHint')
                    "
                    class="enum-select"
                    @change="(v: unknown) => onEnumAttrChange(row.field.name, v)"
                    @clear="() => onEnumAttrChange(row.field.name, '')"
                  />
                  <div
                    v-else-if="row.field.name === 'material'"
                    class="material-select-field"
                  >
                    <span
                      class="fill-swatch material-preview-swatch"
                      :class="{
                        'is-default': !(draft.material ?? '').trim(),
                      }"
                      :style="{
                        background:
                          fillToHex8(selectedMaterialColor ?? '') ||
                          'transparent',
                      }"
                      aria-hidden="true"
                    />
                    <t-select
                      :value="draft[row.field.name] || undefined"
                      :options="materialSelectOptions"
                      clearable
                      filterable
                      size="small"
                      :placeholder="materialLabel('default')"
                      class="material-select"
                      :popup-props="materialSelectPopupProps"
                      @change="onMaterialChange"
                      @clear="onMaterialClear"
                    />
                  </div>
                  <ExprAttrInput
                    v-else-if="
                      row.field.name === 's3dx:transform' &&
                      transformForm === 'trs'
                    "
                    :model-value="transformCompactShown"
                    :readonly="transformExpanded"
                    :clearable="!transformExpanded"
                    placeholder="translate(0 0 0) rotate(0 0 0) scale(1 1 1)"
                    class="value-input"
                    :param-groups="paramSourceGroups"
                    :effective-names="effectiveParamNames"
                    :param-values="effectiveParamValues"
                    @update:model-value="
                      (v: string) => {
                        if (!transformExpanded)
                          draft['s3dx:transform'] = String(v ?? '');
                      }
                    "
                    @blur="commitTransformCompact"
                    @enter="commitTransformCompact"
                    @clear="clearTransform"
                  />
                  <VecRgbInput
                    v-else-if="row.field.name === 's3dx:transform'"
                    :model-value="transformCompactShown"
                    :readonly="transformExpanded"
                    :clearable="!transformExpanded"
                    :placeholder="IDENTITY_TRANSFORM_DISPLAY"
                    class="value-input"
                    :param-groups="paramSourceGroups"
                    :effective-names="effectiveParamNames"
                    :param-values="effectiveParamValues"
                    @update:model-value="
                      (v: string) => {
                        if (!transformExpanded)
                          draft['s3dx:transform'] = String(v ?? '');
                      }
                    "
                    @blur="commitTransformCompact"
                    @enter="commitTransformCompact"
                    @clear="clearTransform"
                  />
                  <VecRgbInput
                    v-else-if="isVecRgbField(row.field)"
                    v-model="draft[row.field.name]"
                    clearable
                    class="value-input"
                    :placeholder="
                      row.field.placeholder || t('app.unsetHint')
                    "
                    :param-groups="paramSourceGroups"
                    :effective-names="effectiveParamNames"
                    :param-values="effectiveParamValues"
                    @blur="commitField(row.field.name)"
                    @enter="commitField(row.field.name)"
                    @clear="
                      () => {
                        draft[row.field.name] = '';
                        commitField(row.field.name);
                      }
                    "
                  />
                  <div
                    v-else-if="
                      isGltfHrefField &&
                      (row.field.name === 'href' ||
                        row.field.name === 'xlink:href')
                    "
                    class="value-input-row"
                  >
                    <t-input
                      v-model="draft[row.field.name]"
                      clearable
                      class="value-input"
                      :placeholder="
                        row.field.placeholder || 'assets/model.glb'
                      "
                      @blur="commitField(row.field.name)"
                      @enter="commitField(row.field.name)"
                      @clear="
                        () => {
                          draft[row.field.name] = '';
                          commitField(row.field.name);
                        }
                      "
                    />
                    <t-button
                      size="small"
                      variant="outline"
                      @click="browseGltfHref"
                    >
                      {{ t("app.browseGltf") }}
                    </t-button>
                  </div>
                  <HrefRefInput
                    v-else-if="
                      row.field.name === 'href' ||
                      row.field.name === 'xlink:href'
                    "
                    :model-value="draft[row.field.name]"
                    clearable
                    class="value-input"
                    :options="defsHrefOptions"
                    :placeholder="row.field.placeholder || '#groupId'"
                    @update:model-value="
                      (v: string) => {
                        draft[row.field.name] = v ?? '';
                        commitField(row.field.name);
                      }
                    "
                    @blur="commitField(row.field.name)"
                    @enter="commitField(row.field.name)"
                    @clear="
                      () => {
                        draft[row.field.name] = '';
                        commitField(row.field.name);
                      }
                    "
                  />
                  <div
                    v-else-if="isExprScalarField(row.field)"
                    class="value-input-row"
                  >
                    <ExprAttrInput
                      v-model="draft[row.field.name]"
                      clearable
                      class="value-input"
                      :placeholder="
                        row.field.placeholder || t('app.unsetHint')
                      "
                      :param-groups="paramSourceGroups"
                      :effective-names="effectiveParamNames"
                      :param-values="effectiveParamValues"
                      @blur="commitField(row.field.name)"
                      @enter="commitField(row.field.name)"
                      @clear="
                        () => {
                          draft[row.field.name] = '';
                          commitField(row.field.name);
                        }
                      "
                    />
                  </div>
                  <t-input
                    v-else
                    v-model="draft[row.field.name]"
                    clearable
                    size="small"
                    :placeholder="
                      row.field.name === 'class'
                        ? ''
                        : row.field.placeholder || t('app.unsetHint')
                    "
                    class="value-input"
                    @blur="commitField(row.field.name)"
                    @enter="commitField(row.field.name)"
                    @clear="
                      () => {
                        draft[row.field.name] = '';
                        commitField(row.field.name);
                      }
                    "
                  />
                  <div v-if="row.field.description" class="field-desc">
                    {{ row.field.description }}
                  </div>
                </div>
              </div>
            </template>
          </div>
        </t-collapse-panel>
      </t-collapse>
    </template>
  </div>
</template>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.param-collapse {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
  background: var(--td-bg-color-container);
}

.param-collapse :deep(.t-collapse-panel__header) {
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
}

.param-collapse :deep(.t-collapse-panel__body) {
  background: var(--td-bg-color-container);
}

.param-collapse :deep(.t-collapse-panel__content) {
  padding: 0;
}

.param-fields {
  display: flex;
  flex-direction: column;
}

.section-profile-action {
  padding: 8px 10px 4px;
}

.param-fields .param-row {
  padding: 8px 10px;
  border-bottom: 1px solid var(--td-component-border);
}

.param-fields .param-row:last-child {
  border-bottom: none;
}

.param-list {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
  background: var(--td-bg-color-container);
}

.param-row {
  display: grid;
  grid-template-columns: minmax(0, 5.5rem) minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  width: 100%;
  font-size: 13px;
  box-sizing: border-box;
}

.param-row.readonly-row {
  align-items: center;
}

.value-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.value-input-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.value-input-row .value-input {
  flex: 1;
  min-width: 0;
}

.value-action {
  flex-shrink: 0;
}

.field-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--td-text-color-secondary);
}

.name {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  width: 100%;
  font-weight: 600;
  overflow: hidden;
}

.name--with-action {
  align-items: center;
  gap: 2px;
}

.name-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-action {
  flex-shrink: 0;
}

.value {
  min-width: 0;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
}

.value-input {
  max-width: 100%;
  min-width: 0;
}

.value-input :deep(.t-input) {
  font-variant-numeric: tabular-nums;
}

.fill-color-field {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.fill-swatch {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-small);
  cursor: pointer;
  background-clip: padding-box;
}

.fill-swatch.is-default {
  /* Unset fill still previews the §8.2 default; dashed border marks “not written”. */
  border-style: dashed;
}

.fill-swatch:hover {
  border-color: var(--td-brand-color);
}

.fill-hex-input {
  flex: 1;
  min-width: 0;
}

.fill-hex-input :deep(.t-input) {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.material-select-field {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.material-select {
  flex: 1;
  min-width: 0;
}

.material-preview-swatch {
  cursor: default;
  pointer-events: none;
}

.transform-form-row :deep(.t-radio-group) {
  flex-wrap: wrap;
}

/* Mode + axis/TRS channels share the indented sub-row label column. */
.transform-form-row .name,
.transform-part-row .name {
  color: var(--td-text-color-secondary);
  font-weight: 500;
  padding-left: 8px;
  align-items: center;
  min-height: 28px;
}

.muted {
  color: var(--td-text-color-secondary);
  font-size: 13px;
}

:deep(.t-list__header) {
  font-size: 12px;
  font-weight: 600;
  color: var(--td-text-color-secondary);
  padding: 8px 10px;
  background: var(--td-bg-color-secondarycontainer);
}

:deep(.t-list-item) {
  padding: 8px 10px;
}

:deep(.t-list-item .t-list-item__content) {
  width: 100%;
}
</style>
