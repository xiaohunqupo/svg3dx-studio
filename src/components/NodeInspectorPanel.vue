<script setup lang="ts">
import { computed } from "vue";
import type { GeometryInstruction, Value } from "svg3dx-viewer";
import type { TreeSelectPayload } from "@/components/NodeTreePanel.vue";
import StyleParamEditor from "@/components/StyleParamEditor.vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  selected: TreeSelectPayload | null;
}>();

const emit = defineEmits<{
  styleParamsChange: [propsMap: Record<string, string>];
}>();

const { t, tagLabel } = useI18n();

type Row = { name: string; value: string };

function formatValue(v: Value | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === "number" || typeof x === "boolean" || typeof x === "string"
          ? String(x)
          : JSON.stringify(x)
      )
      .join(" ");
  }
  return JSON.stringify(v);
}

function entriesOf(record: Record<string, Value> | undefined): Row[] {
  if (!record) return [];
  return Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, value: formatValue(record[name]) }));
}

function nodeTitle(node: GeometryInstruction): string {
  switch (node.type) {
    case "primitive":
      return node.kind;
    case "group":
      return node.id ?? tagLabel("group");
    case "bool_op":
      return `bool-${node.op}`;
    case "instance":
      return `${tagLabel("use")} → #${node.group_id}`;
    default:
      return "node";
  }
}

const styleClassName = computed(() => {
  if (props.selected?.kind !== "style") return "";
  return props.selected.name.split(/\s+/).filter(Boolean)[0] ?? "";
});

const view = computed(() => {
  const sel = props.selected;
  if (!sel || sel.kind === "style") return null;

  if (sel.kind === "geometry") {
    const node = sel.node;
    const meta: Row[] = [
      { name: "type", value: node.type },
      { name: "node_id", value: node.node_id },
    ];
    if (node.type === "primitive") {
      meta.push({ name: "kind", value: node.kind });
    } else if (node.type === "group") {
      meta.push({ name: "id", value: node.id ?? "" });
    } else if (node.type === "bool_op") {
      meta.push({ name: "op", value: node.op });
    } else if (node.type === "instance") {
      meta.push({ name: "group_id", value: node.group_id });
    }

    return {
      title: nodeTitle(node),
      subtitle: "节点参数",
      meta,
      params: node.type === "primitive" ? entriesOf(node.params) : [],
      styles: entriesOf(node.styles),
      showEmptyParams: node.type === "primitive",
      showEmptyStyles: true,
    };
  }

  return {
    title: sel.modelId,
    subtitle: "模型",
    meta: [
      { name: "modelId", value: sel.modelId },
      { name: "path", value: sel.path },
    ],
    params: [] as Row[],
    styles: [] as Row[],
    showEmptyParams: false,
    showEmptyStyles: false,
  };
});

function onStyleChange(map: Record<string, string>): void {
  emit("styleParamsChange", map);
}
</script>

<template>
  <div class="node-inspector">
    <StyleParamEditor
      v-if="selected?.kind === 'style' && styleClassName"
      :class-name="styleClassName"
      :group-id="selected.groupId"
      :model-value="selected.props"
      @change="onStyleChange"
    />

    <div v-else-if="!view" class="muted">{{ t("app.clickNode") }}</div>

    <template v-else>
      <div class="title-row">
        <span class="title">{{ view.title }}</span>
        <span class="subtitle">{{ view.subtitle }}</span>
      </div>

      <section v-if="view.meta.length" class="section">
        <div class="section-head">{{ t("app.attributes") }}</div>
        <div v-for="row in view.meta" :key="'m-' + row.name" class="row">
          <span class="name">{{ row.name }}</span>
          <span class="value">{{ row.value }}</span>
        </div>
      </section>

      <section v-if="view.params.length" class="section">
        <div class="section-head">Params</div>
        <div v-for="row in view.params" :key="'p-' + row.name" class="row">
          <span class="name">{{ row.name }}</span>
          <span class="value">{{ row.value }}</span>
        </div>
      </section>
      <section v-else-if="view.showEmptyParams" class="section">
        <div class="section-head">Params</div>
        <div class="muted">{{ t("app.noNodeParams") }}</div>
      </section>

      <section v-if="view.styles.length" class="section">
        <div class="section-head">{{ tagLabel("style") }}</div>
        <div v-for="row in view.styles" :key="'s-' + row.name" class="row">
          <span class="name">{{ row.name }}</span>
          <span class="value">{{ row.value }}</span>
        </div>
      </section>
      <section v-else-if="view.showEmptyStyles" class="section">
        <div class="section-head">{{ tagLabel("style") }}</div>
        <div class="muted">{{ t("app.noNodeStyles") }}</div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  font-size: 11px;
  color: var(--studio-muted);
  flex-shrink: 0;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-head {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--studio-muted);
  margin-top: 2px;
}

.row {
  display: grid;
  grid-template-columns: 7rem 1fr;
  gap: 8px;
  align-items: start;
  font-size: 13px;
  line-height: 1.4;
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

.muted {
  color: var(--studio-muted);
  font-size: 13px;
}
</style>
