<script setup lang="ts">
import { computed, h } from "vue";
import type { SelectOption } from "tdesign-vue-next";
import { useI18n } from "@/i18n";
import {
  BLEND_VALUES,
  blendSchematicGeom,
  isBlendValue,
  type BlendValue,
} from "@/utils/blendSchematic";

const props = defineProps<{
  modelValue?: string;
  clearable?: boolean;
  placeholder?: string;
  size?: "small" | "medium" | "large";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  clear: [];
}>();

const { attrValueLabel } = useI18n();

const SCH_W = 72;
const SCH_H = 40;

function schematicVNode(kind: BlendValue, className = "blend-schematic") {
  const g = blendSchematicGeom(kind, SCH_W, SCH_H);
  return h(
    "svg",
    {
      class: className,
      viewBox: `0 0 ${SCH_W} ${SCH_H}`,
      width: SCH_W,
      height: SCH_H,
      "aria-hidden": "true",
    },
    [
      h("rect", {
        class: "blend-schematic__frame",
        x: 0.5,
        y: 0.5,
        width: SCH_W - 1,
        height: SCH_H - 1,
        rx: 2,
      }),
      h("path", {
        class: "blend-schematic__body",
        d: g.outline,
      }),
      h("path", {
        class: "blend-schematic__section",
        d: g.startEdge,
        fill: "none",
      }),
      h("path", {
        class: "blend-schematic__section",
        d: g.endEdge,
        fill: "none",
      }),
    ]
  );
}

const options = computed<SelectOption[]>(() =>
  BLEND_VALUES.map((value) => ({
    value,
    label: attrValueLabel("blend", value),
    content: () =>
      h("div", { class: "blend-option" }, [
        schematicVNode(value),
        h(
          "span",
          { class: "blend-option__label" },
          attrValueLabel("blend", value)
        ),
      ]),
  }))
);

/** Explicit selection (empty = unset / default). */
const current = computed(() => {
  const v = (props.modelValue ?? "").trim();
  return isBlendValue(v) ? v : null;
});

const isUnset = computed(() => current.value == null);

/** Schematic to preview: explicit value, else placeholder / linear. */
const effective = computed((): BlendValue => {
  if (current.value) return current.value;
  const ph = (props.placeholder ?? "").trim();
  if (isBlendValue(ph)) return ph;
  return "linear";
});

const currentGeom = computed(() =>
  blendSchematicGeom(effective.value, SCH_W, SCH_H)
);

function onChange(v: unknown): void {
  const next =
    v == null || v === ""
      ? ""
      : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : "";
  emit("update:modelValue", next);
  emit("change", next);
}

function onClear(): void {
  emit("update:modelValue", "");
  emit("change", "");
  emit("clear");
}
</script>

<template>
  <t-select
    :value="effective"
    :options="options"
    :clearable="clearable && !isUnset"
    :size="size || 'medium'"
    :placeholder="placeholder"
    class="blend-attr-select enum-select"
    :class="{ 'is-unset': isUnset }"
    :popup-props="{ overlayClassName: 'blend-attr-select-popup' }"
    @change="onChange"
    @clear="onClear"
  >
    <template #valueDisplay>
      <div class="blend-value" :class="{ 'is-unset': isUnset }">
        <svg
          class="blend-schematic blend-schematic--inline"
          :viewBox="`0 0 ${SCH_W} ${SCH_H}`"
          :width="SCH_W"
          :height="SCH_H"
          aria-hidden="true"
        >
          <rect
            class="blend-schematic__frame"
            x="0.5"
            y="0.5"
            :width="SCH_W - 1"
            :height="SCH_H - 1"
            rx="2"
          />
          <path class="blend-schematic__body" :d="currentGeom.outline" />
          <path
            class="blend-schematic__section"
            :d="currentGeom.startEdge"
            fill="none"
          />
          <path
            class="blend-schematic__section"
            :d="currentGeom.endEdge"
            fill="none"
          />
        </svg>
        <span class="blend-value__label">{{
          attrValueLabel("blend", effective)
        }}</span>
      </div>
    </template>
  </t-select>
</template>

<style scoped>
.blend-attr-select {
  width: 100%;
}

/* Tall enough for the silhouette schematic (default small/medium clips it). */
.blend-attr-select :deep(.t-input),
.blend-attr-select :deep(.t-input__wrap),
.blend-attr-select :deep(.t-select-input),
.blend-attr-select :deep(.t-input__inner) {
  height: auto;
  min-height: 44px;
}

.blend-attr-select :deep(.t-input__inner) {
  padding-top: 4px;
  padding-bottom: 4px;
  align-items: center;
}

.blend-attr-select :deep(.t-select-input .t-input__suffix) {
  align-items: center;
}

.blend-value {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  line-height: 1;
}

.blend-value__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Match other inputs: unset shows placeholder-like muted chrome. */
.blend-value.is-unset .blend-value__label {
  color: var(--td-text-color-placeholder, #999);
}

.blend-schematic {
  flex-shrink: 0;
  display: block;
  overflow: visible;
}

.blend-schematic__frame {
  fill: var(--td-bg-color-secondarycontainer, #f3f3f3);
  stroke: var(--td-component-border, #dcdcdc);
  stroke-width: 1;
}

.blend-schematic__body {
  fill: color-mix(in srgb, var(--td-brand-color, #0052d9) 22%, transparent);
  stroke: var(--td-brand-color, #0052d9);
  stroke-width: 1.4;
  stroke-linejoin: round;
}

.blend-schematic__section {
  stroke: var(--td-brand-color, #0052d9);
  stroke-width: 1.8;
  stroke-linecap: square;
}

.blend-value.is-unset .blend-schematic__body {
  fill: color-mix(
    in srgb,
    var(--td-text-color-placeholder, #999) 18%,
    transparent
  );
  stroke: var(--td-text-color-placeholder, #999);
}

.blend-value.is-unset .blend-schematic__section {
  stroke: var(--td-text-color-placeholder, #999);
}

.blend-attr-select.is-unset :deep(.t-input),
.blend-attr-select.is-unset :deep(.t-input__inner) {
  color: var(--td-text-color-placeholder, #999);
}
</style>

<style>
/* Dropdown options render in a portal — unscoped. */
.blend-attr-select-popup .t-select-option {
  height: auto !important;
  min-height: 48px;
  padding-top: 6px;
  padding-bottom: 6px;
  align-items: center;
}

.blend-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0;
  line-height: 1;
}

.blend-option__label {
  line-height: 1.2;
}

.blend-option .blend-schematic {
  display: block;
  flex-shrink: 0;
  overflow: visible;
}

.blend-option .blend-schematic__frame {
  fill: var(--td-bg-color-secondarycontainer, #f3f3f3);
  stroke: var(--td-component-border, #dcdcdc);
  stroke-width: 1;
}

.blend-option .blend-schematic__body {
  fill: color-mix(in srgb, var(--td-brand-color, #0052d9) 22%, transparent);
  stroke: var(--td-brand-color, #0052d9);
  stroke-width: 1.4;
  stroke-linejoin: round;
}

.blend-option .blend-schematic__section {
  stroke: var(--td-brand-color, #0052d9);
  stroke-width: 1.8;
  stroke-linecap: square;
}
</style>
