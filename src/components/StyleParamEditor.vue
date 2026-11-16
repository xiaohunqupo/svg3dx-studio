<script setup lang="ts">
import { ref, watch } from "vue";
import { AddIcon, DeleteIcon } from "tdesign-icons-vue-next";
import { useI18n } from "@/i18n";
import { normalizePropName } from "@/utils/styleClasses";

const { t } = useI18n();

export type StyleParamRow = {
  key: string;
  name: string;
  value: string;
};

const props = defineProps<{
  className: string;
  groupId?: string;
  /** Class rule properties (e.g. --D → 200). */
  modelValue: Record<string, string>;
  /** Optional list header (grouped list). */
  header?: string;
  /** Hide the .className title row. */
  hideTitle?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [Record<string, string>];
  change: [Record<string, string>];
}>();

const rows = ref<StyleParamRow[]>([]);
let seq = 0;

function toRows(map: Record<string, string>): StyleParamRow[] {
  return Object.keys(map)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      key: `p-${seq++}-${name}`,
      name,
      value: map[name] ?? "",
    }));
}

function toMap(list: StyleParamRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of list) {
    const name = normalizePropName(row.name);
    if (!name) continue;
    out[name] = row.value;
  }
  return out;
}

watch(
  () => props.modelValue,
  (map) => {
    const incoming = map ?? {};
    const current = toMap(rows.value);
    const same =
      Object.keys(incoming).length === Object.keys(current).length &&
      Object.keys(incoming).every((k) => incoming[k] === current[k]);
    if (same && rows.value.length > 0) return;
    rows.value = toRows(incoming);
  },
  { immediate: true, deep: true }
);

function commit(): void {
  const next = toMap(rows.value);
  emit("update:modelValue", next);
  emit("change", next);
}

function onAdd(): void {
  const used = new Set(rows.value.map((r) => normalizePropName(r.name)));
  let n = 1;
  let name = "--New";
  while (used.has(name)) {
    name = `--New${n++}`;
  }
  rows.value = [...rows.value, { key: `p-${seq++}-new`, name, value: "0" }];
}

function onRemove(key: string): void {
  rows.value = rows.value.filter((r) => r.key !== key);
  commit();
}

function displayName(name: string): string {
  return name.startsWith("--") ? name.slice(2) : name;
}

function onNameInput(row: StyleParamRow, raw: string): void {
  row.name = raw.startsWith("--")
    ? raw
    : raw.trim()
      ? `--${raw.replace(/^-+/, "")}`
      : raw;
}

function onNameBlur(row: StyleParamRow): void {
  row.name = normalizePropName(row.name) || row.name;
  commit();
}
</script>

<template>
  <div class="style-param-editor" :class="{ 'has-header': !!header }">
    <div v-if="!hideTitle" class="head">
      <div class="title-row">
        <span class="title">.{{ className }}</span>
        <span v-if="groupId" class="subtitle">{{ groupId }}</span>
      </div>
      <t-button size="small" variant="outline" @click="onAdd">
        <template #icon><AddIcon /></template>
        {{ t("app.addParam") }}
      </t-button>
    </div>

    <t-list
      :header="header"
      :split="true"
      size="small"
      class="param-list"
    >
      <t-list-item v-for="row in rows" :key="row.key">
        <div class="param-row">
          <t-input
            :model-value="displayName(row.name)"
            size="small"
            :placeholder="t('app.paramName')"
            class="name-input"
            @update:model-value="(v) => onNameInput(row, String(v ?? ''))"
            @blur="onNameBlur(row)"
            @enter="onNameBlur(row)"
          />
          <t-input
            v-model="row.value"
            size="small"
            :placeholder="t('app.paramValue')"
            class="value-input"
            @blur="commit"
            @enter="commit"
          />
          <t-button
            size="small"
            variant="text"
            theme="danger"
            shape="square"
            :aria-label="t('app.deleteParamNamed', { name: row.name })"
            @click="onRemove(row.key)"
          >
            <template #icon><DeleteIcon /></template>
          </t-button>
        </div>
      </t-list-item>
      <t-list-item v-if="!rows.length">
        <div class="empty">{{ t("app.noParams") }}</div>
      </t-list-item>
      <t-list-item v-if="hideTitle">
        <t-button size="small" variant="outline" @click="onAdd">
          <template #icon><AddIcon /></template>
          {{ t("app.addParam") }}
        </t-button>
      </t-list-item>
    </t-list>
  </div>
</template>

<style scoped>
.style-param-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.has-header {
  gap: 0;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
  color: var(--td-text-color-secondary);
  flex-shrink: 0;
}

.param-list {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
  background: var(--td-bg-color-container);
}

.param-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
  gap: 6px;
  align-items: center;
  width: 100%;
}

.name-input :deep(.t-input),
.value-input :deep(.t-input) {
  font-variant-numeric: tabular-nums;
}

.empty {
  color: var(--td-text-color-secondary);
  font-size: 13px;
  padding: 2px 0;
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
