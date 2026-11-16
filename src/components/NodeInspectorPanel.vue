<script setup lang="ts">
import { computed, h, reactive, ref, watch } from "vue";
import { ChevronDownIcon, ChevronUpIcon } from "tdesign-icons-vue-next";
import { BUILTIN_MATERIALS, type GeometryInstruction } from "svg3dx-viewer";
import type { SelectOption } from "tdesign-vue-next";
import type { TreeSelectPayload } from "@/components/NodeTreePanel.vue";
import StyleParamEditor from "@/components/StyleParamEditor.vue";
import VecRgbInput from "@/components/VecRgbInput.vue";
import { useI18n } from "@/i18n";
import {
  APPEARANCE_ATTR_NAMES,
  APPEARANCE_FIELDS,
  GROUP_BASIC_FIELDS,
  IDENTITY_TRANSFORM_DISPLAY,
  TRANSFORM_FIELDS,
  TRANSFORM_PART_KEYS,
  emptyTransformParts,
  isIdentityTransformDisplay,
  looksLikeVecRgbText,
  primitiveAttrFields,
  syncTransformPartsFromDisplay,
  transformDisplayFromParts,
  transformPartPlaceholder,
  transformToAttr,
  transformToDisplay,
  type AttrField,
  type TransformPartKey,
  type TransformParts,
} from "@/utils/nodeSchema";
import {
  extractDocumentMaterials,
  normalizeMaterialAttr,
} from "@/utils/documentMaterials";
import { fillToHex8, hex8ToFill } from "@/utils/fillColor";
import { readAttrsAtPath } from "@/utils/nodeXmlEdit";

const props = defineProps<{
  selected: TreeSelectPayload | null;
  /** Raw SVG — source of truth for editable attributes. */
  content?: string;
}>();

const emit = defineEmits<{
  styleParamsChange: [propsMap: Record<string, string>];
  nodeAttrsChange: [payload: { path: string; updates: Record<string, string> }];
}>();

const { t, tagLabel } = useI18n();

type FieldRow = AttrField & {
  key: string;
  value: string;
  readonly?: boolean;
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

function nodeTypeLabel(node: GeometryInstruction): string {
  switch (node.type) {
    case "primitive":
      return node.kind;
    case "group":
      return tagLabel("group");
    case "bool_op":
      return `bool-${node.op}`;
    case "instance":
      return tagLabel("use");
    default:
      return "node";
  }
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

/** HEX8 string shown in the fill text input / swatch (not the XML form). */
const fillHexUi = ref("");

/** Expanded position / xdir / ydir / zdir editors for s3dx:transform. */
const transformExpanded = ref(false);
const transformParts = reactive<TransformParts>(emptyTransformParts());

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
  for (const f of fields) {
    if (f.name === "material") {
      draft[f.name] = normalizeMaterialAttr(f.value, docIds);
    } else if (f.name === "s3dx:transform") {
      draft[f.name] = transformToDisplay(f.value);
      Object.assign(transformParts, syncTransformPartsFromDisplay(draft[f.name]));
    } else if (f.name === "fill") {
      draft[f.name] = f.value;
      fillHexUi.value = fillToHex8(f.value);
    } else {
      draft[f.name] = f.value;
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
  if (styleIsRoot.value) {
    return [
      {
        key: "style:type",
        name: "type",
        value: tagLabel("style"),
        readonly: true,
      },
      {
        key: "style:selector",
        name: "selector",
        value: ":root",
        readonly: true,
      },
      {
        key: "style:label",
        name: "label",
        value: tagLabel("root"),
        readonly: true,
      },
    ];
  }
  return [
    {
      key: "style:type",
      name: "type",
      value: tagLabel("style"),
      readonly: true,
    },
    {
      key: "style:class",
      name: "class",
      value: `.${styleClassName.value}`,
      readonly: true,
    },
    {
      key: "style:group",
      name: t("app.paramDefGroup"),
      value: props.selected.groupId || "—",
      readonly: true,
    },
  ];
});

const materialBasicFields = computed((): FieldRow[] => {
  if (props.selected?.kind !== "material") return [];
  const sel = props.selected;
  return [
    {
      key: "material:type",
      name: "type",
      value: tagLabel("material"),
      readonly: true,
    },
    {
      key: "material:id",
      name: "id",
      value: sel.materialId,
      readonly: true,
    },
    {
      key: "material:color",
      name: "color",
      value: sel.color ?? "",
      readonly: true,
    },
    {
      key: "material:metalness",
      name: "metalness",
      value: sel.metalness ?? "",
      readonly: true,
    },
    {
      key: "material:roughness",
      name: "roughness",
      value: sel.roughness ?? "",
      readonly: true,
    },
  ];
});

const modelBasicFields = computed((): FieldRow[] => {
  if (props.selected?.kind !== "model") return [];
  return [
    {
      key: "model:type",
      name: "type",
      value: tagLabel("model"),
      readonly: true,
    },
    {
      key: "model:id",
      name: "id",
      value: props.selected.modelId,
      readonly: true,
    },
  ];
});

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
      pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
      ...GROUP_BASIC_FIELDS.map((f) => {
        let value = attrLookup(xmlAttrs, f.name);
        if (!value && f.name === "id") value = node.id ?? "";
        if (!value && f.name === "class" && sel.className) value = sel.className;
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
        pushField("basic", { name: "type" }, node.kind, true),
        pushField("basic", { name: "id" }, idVal),
        pushField("basic", { name: "class" }, classVal),
      ],
    });

    const schema = primitiveAttrFields(node.kind);
    const paramFields = schema.map((f) =>
      pushField("params", f, attrLookup(xmlAttrs, f.name))
    );
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

    const xformVal = attrLookup(xmlAttrs, "s3dx:transform");
    sections.push({
      id: "transform",
      title: t("app.transform"),
      fields: TRANSFORM_FIELDS.map((f) =>
        pushField("transform", f, f.name === "s3dx:transform" ? xformVal : "")
      ),
    });
  } else if (node.type === "instance") {
    const idVal = attrLookup(xmlAttrs, "id") || sel.className || "";
    const hrefVal =
      attrLookup(xmlAttrs, "href") ||
      (node.group_id ? `#${node.group_id}` : "");
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: [
        pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
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
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: [
        pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
        pushField("basic", { name: "id" }, attrLookup(xmlAttrs, "id")),
        pushField("basic", { name: "class" }, attrLookup(xmlAttrs, "class")),
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
    const raw = (draft[f.name] ?? "").trim();
    const next =
      f.name === "s3dx:transform" ? transformToAttr(raw) : raw;
    const prev =
      f.name === "s3dx:transform"
        ? transformToAttr(f.value ?? "")
        : (f.value ?? "").trim();
    updates[f.name] = next;
    if (next !== prev) changed = true;
  }
  if (!changed) return;
  emit("nodeAttrsChange", { path: view.path, updates });
}

let fillCommitTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFillCommit(): void {
  if (fillCommitTimer) clearTimeout(fillCommitTimer);
  fillCommitTimer = setTimeout(() => {
    fillCommitTimer = null;
    commitField("fill");
  }, 180);
}

/** Panel / complete pick: write RGBA fill and normalize HEX8 UI. */
function applyFillHex(hex: string, immediate = false): void {
  const raw = hex.trim();
  if (!raw) {
    draft.fill = "";
    fillHexUi.value = "";
    if (immediate) commitField("fill");
    else scheduleFillCommit();
    return;
  }
  const fill = hex8ToFill(raw);
  if (!fill) return;
  draft.fill = fill;
  fillHexUi.value = fillToHex8(fill);
  if (immediate) commitField("fill");
  else scheduleFillCommit();
}

function onFillPanelChange(hex: string): void {
  applyFillHex(hex ?? "");
}

/** Text input: commit only on blur/enter so partial typing is not expanded. */
function commitFillFromUi(): void {
  const raw = fillHexUi.value.trim();
  if (!raw) {
    applyFillHex("", true);
    return;
  }
  if (!hex8ToFill(raw)) {
    // Invalid partial/garbage — restore last committed color.
    fillHexUi.value = fillToHex8(draft.fill ?? "");
    return;
  }
  applyFillHex(raw, true);
}

function onFillClear(): void {
  if (fillCommitTimer) {
    clearTimeout(fillCommitTimer);
    fillCommitTimer = null;
  }
  draft.fill = "";
  fillHexUi.value = "";
  commitField("fill");
}

function syncPartsFromCompact(): void {
  Object.assign(
    transformParts,
    syncTransformPartsFromDisplay(draft["s3dx:transform"] ?? "")
  );
}

/** Compact row: when expanded, mirror split parts; identity stays empty (placeholder). */
const transformCompactShown = computed(() => {
  if (transformExpanded.value) {
    const next = transformDisplayFromParts(transformParts);
    if (!next || isIdentityTransformDisplay(next)) return "";
    return next;
  }
  return draft["s3dx:transform"] ?? "";
});

function toggleTransformExpand(): void {
  if (!transformExpanded.value) {
    syncPartsFromCompact();
    transformExpanded.value = true;
    return;
  }
  const next = transformDisplayFromParts(transformParts);
  if (next == null) {
    syncPartsFromCompact();
  } else {
    draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
  }
  transformExpanded.value = false;
}

function commitTransformCompact(): void {
  if (transformExpanded.value) return;
  const raw = (draft["s3dx:transform"] ?? "").trim();
  if (raw && isIdentityTransformDisplay(raw)) {
    draft["s3dx:transform"] = "";
  }
  syncPartsFromCompact();
  commitField("s3dx:transform");
}

function clearTransform(): void {
  if (transformExpanded.value) return;
  draft["s3dx:transform"] = "";
  Object.assign(transformParts, emptyTransformParts());
  commitField("s3dx:transform");
}

function commitTransformParts(): void {
  const next = transformDisplayFromParts(transformParts);
  if (next == null) {
    syncPartsFromCompact();
    return;
  }
  // Identity ≡ unset (unit transform). Keep part editors empty for identity axes.
  draft["s3dx:transform"] = isIdentityTransformDisplay(next) ? "" : next;
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

/** Flat rows so transform parts sit as siblings of s3dx:transform. */
type InspectorRow =
  | { kind: "field"; field: FieldRow }
  | { kind: "transform-part"; key: TransformPartKey };

function rowsForSection(fields: FieldRow[]): InspectorRow[] {
  const rows: InspectorRow[] = [];
  for (const field of fields) {
    rows.push({ kind: "field", field });
    if (field.name === "s3dx:transform" && transformExpanded.value) {
      for (const key of TRANSFORM_PART_KEYS) {
        rows.push({ kind: "transform-part", key });
      }
    }
  }
  return rows;
}

/** Points / vectors / matrices whose numbers should render as R·G·B segments. */
function isVecRgbField(field: AttrField): boolean {
  if (field.name === "s3dx:transform") return true;
  return looksLikeVecRgbText(field.placeholder ?? "");
}

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

const materialSelectOptions = computed((): SelectOption[] => {
  const builtin: MaterialOption[] = Object.entries(BUILTIN_MATERIALS).map(
    ([id, desc]) => ({
      label: id,
      value: id,
      content: materialOptionContent(
        id,
        desc.color ? desc.color.join(" ") : undefined
      ),
    })
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
</script>

<template>
  <div class="node-inspector">
    <!-- Style -->
    <template v-if="selected?.kind === 'style' && styleClassName">
      <t-list
        :header="t('app.basicInfo')"
        :split="true"
        size="small"
        class="param-list"
      >
        <t-list-item v-for="field in styleBasicFields" :key="field.key">
          <div class="param-row readonly-row">
            <span class="name" :title="field.name">{{ field.name }}</span>
            <span class="value">{{ field.value }}</span>
          </div>
        </t-list-item>
      </t-list>

      <StyleParamEditor
        :class-name="styleClassName"
        :group-id="styleIsRoot ? undefined : selected.groupId"
        :model-value="selected.props"
        :header="t('app.paramDefs')"
        :hide-title="true"
        @change="onStyleChange"
      />
    </template>

    <!-- Model -->
    <template v-else-if="selected?.kind === 'model'">
      <t-list
        :header="t('app.basicInfo')"
        :split="true"
        size="small"
        class="param-list"
      >
        <t-list-item v-for="field in modelBasicFields" :key="field.key">
          <div class="param-row readonly-row">
            <span class="name" :title="field.name">{{ field.name }}</span>
            <span class="value">{{ field.value }}</span>
          </div>
        </t-list-item>
      </t-list>
    </template>

    <!-- Material -->
    <template v-else-if="selected?.kind === 'material'">
      <t-list
        :header="t('app.basicInfo')"
        :split="true"
        size="small"
        class="param-list"
      >
        <t-list-item v-for="field in materialBasicFields" :key="field.key">
          <div class="param-row readonly-row">
            <span class="name" :title="field.name">{{ field.name }}</span>
            <span class="value">{{ field.value || "—" }}</span>
          </div>
        </t-list-item>
      </t-list>
    </template>

    <div v-else-if="!geometryView" class="muted">{{ t("app.clickNode") }}</div>

    <!-- Geometry / group -->
    <template v-else>
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
                row.kind === 'field' ? row.field.key : `xform:${row.key}`
              "
            >
              <!-- Transform split parts: peer rows of s3dx:transform -->
              <div
                v-if="row.kind === 'transform-part'"
                class="param-row transform-part-row"
              >
                <span class="name">{{ row.key }}</span>
                <div class="value-cell">
                  <VecRgbInput
                    v-model="transformParts[row.key]"
                    clearable
                    class="value-input"
                    :placeholder="transformPartPlaceholder(row.key)"
                    @blur="commitTransformParts"
                    @enter="commitTransformParts"
                    @clear="() => clearTransformPart(row.key)"
                  />
                </div>
              </div>

              <div
                v-else
                class="param-row"
                :class="{ 'readonly-row': row.field.readonly }"
              >
                <span
                  class="name"
                  :title="row.field.description || row.field.name"
                  >{{ row.field.name }}</span
                >
                <span v-if="row.field.readonly" class="value">{{
                  draft[row.field.name] ?? row.field.value
                }}</span>
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
                        :style="{ background: fillHexUi || 'transparent' }"
                        :aria-label="row.field.name"
                      />
                      <template #content>
                        <t-color-picker-panel
                          :model-value="fillHexUi || '#87ABCCFF'"
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
                      :placeholder="row.field.placeholder || '#RRGGBBAA'"
                      class="fill-hex-input"
                      @blur="commitFillFromUi"
                      @enter="commitFillFromUi"
                      @clear="onFillClear"
                    />
                  </div>
                  <t-select
                    v-else-if="row.field.name === 'material'"
                    :value="draft[row.field.name] || undefined"
                    :options="materialSelectOptions"
                    clearable
                    filterable
                    size="small"
                    :placeholder="
                      row.field.placeholder || t('app.unsetHint')
                    "
                    class="material-select"
                    @change="onMaterialChange"
                    @clear="onMaterialClear"
                  />
                  <div
                    v-else-if="row.field.name === 's3dx:transform'"
                    class="transform-compact"
                  >
                    <VecRgbInput
                      :model-value="transformCompactShown"
                      :readonly="transformExpanded"
                      :clearable="!transformExpanded"
                      :placeholder="IDENTITY_TRANSFORM_DISPLAY"
                      class="value-input"
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
                    <t-button
                      size="small"
                      variant="text"
                      shape="square"
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
                  </div>
                  <VecRgbInput
                    v-else-if="isVecRgbField(row.field)"
                    v-model="draft[row.field.name]"
                    clearable
                    class="value-input"
                    :placeholder="
                      row.field.placeholder || t('app.unsetHint')
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
  border-radius: var(--td-radius-medium);
  overflow: hidden;
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
  grid-template-columns: minmax(0, 7rem) minmax(0, 1fr);
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

.field-desc {
  font-size: 11px;
  line-height: 1.4;
  color: var(--td-text-color-secondary);
}

.name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value {
  min-width: 0;
  word-break: break-word;
  font-variant-numeric: tabular-nums;
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

.material-select {
  width: 100%;
  min-width: 0;
}

.transform-compact {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: 100%;
}

.transform-compact .value-input {
  flex: 1;
  min-width: 0;
}

.transform-part-row .name {
  color: var(--td-text-color-secondary);
  font-weight: 500;
  padding-left: 8px;
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
