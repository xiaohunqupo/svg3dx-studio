<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type { GeometryInstruction } from "svg3dx-viewer";
import type { TreeSelectPayload } from "@/components/NodeTreePanel.vue";
import StyleParamEditor from "@/components/StyleParamEditor.vue";
import { useI18n } from "@/i18n";
import {
  GROUP_BASIC_FIELDS,
  TRANSFORM_FIELDS,
  primitiveAttrFields,
  type AttrField,
} from "@/utils/nodeSchema";
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

function seedDraft(fields: FieldRow[], path: string): void {
  draftPath = path;
  for (const k of Object.keys(draft)) delete draft[k];
  for (const f of fields) {
    draft[f.name] = f.value;
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
        return pushField("basic", f, value, f.name === "id");
      }),
    ];
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: basic,
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
    const classVal = attrLookup(xmlAttrs, "class") || sel.className || "";
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: [
        pushField("basic", { name: "type" }, node.kind, true),
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
    const basic: FieldRow[] = [
      pushField("basic", { name: "type" }, nodeTypeLabel(node), true),
    ];
    sections.push({
      id: "basic",
      title: t("app.basicInfo"),
      fields: basic,
    });
    if (xmlAttrs) {
      const skip = new Set(["xmlns", "type"]);
      const extras = Object.entries(xmlAttrs)
        .filter(([n]) => !n.startsWith("xmlns") && !skip.has(n))
        .map(([name, value]) => pushField("params", { name }, value));
      if (extras.length) {
        sections.push({
          id: "params",
          title: t("app.basicParams"),
          fields: extras,
        });
      }
    }
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
      for (const k of Object.keys(draft)) delete draft[k];
      return;
    }
    seedDraft(view.allFields, view.path);
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
    const next = (draft[f.name] ?? "").trim();
    const prev = (f.value ?? "").trim();
    updates[f.name] = next;
    if (next !== prev) changed = true;
  }
  if (!changed) return;
  emit("nodeAttrsChange", { path: view.path, updates });
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

    <div v-else-if="!geometryView" class="muted">{{ t("app.clickNode") }}</div>

    <!-- Geometry / group -->
    <template v-else>
      <t-list
        v-for="sec in geometryView.sections"
        :key="sec.id"
        :header="sec.title"
        :split="true"
        size="small"
        class="param-list"
      >
        <t-list-item v-for="field in sec.fields" :key="field.key">
          <div class="param-row" :class="{ 'readonly-row': field.readonly }">
            <span class="name" :title="field.name">{{ field.name }}</span>
            <span v-if="field.readonly" class="value">{{
              draft[field.name] ?? field.value
            }}</span>
            <t-input
              v-else
              v-model="draft[field.name]"
              size="small"
              :placeholder="field.placeholder || t('app.unsetHint')"
              class="value-input"
              @blur="commitField(field.name)"
              @enter="commitField(field.name)"
            />
          </div>
        </t-list-item>
      </t-list>
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

.param-list {
  border: 1px solid var(--studio-line);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.param-row {
  display: grid;
  grid-template-columns: minmax(0, 7rem) minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  width: 100%;
  font-size: 13px;
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

.muted {
  color: var(--studio-muted);
  font-size: 13px;
}

:deep(.t-list__header) {
  font-size: 12px;
  font-weight: 600;
  color: var(--studio-muted);
  padding: 8px 10px;
  background: #f7f8fa;
}

:deep(.t-list-item) {
  padding: 8px 10px;
}

:deep(.t-list-item .t-list-item__content) {
  width: 100%;
}
</style>
