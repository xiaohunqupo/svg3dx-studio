<script setup lang="ts">
import { computed, h } from "vue";
import type { SelectOption } from "tdesign-vue-next";
import {
  StrokeLineJoinBevel,
  StrokeLineJoinMiter,
  StrokeLineJoinRound,
  type LucideIcon,
} from "@lucide/vue";
import { useI18n } from "@/i18n";
import { CORNER_VALUE_LABELS, type CornerValueKey } from "@/i18n/vocab";

const CORNER_VALUES = Object.keys(CORNER_VALUE_LABELS) as CornerValueKey[];

/** Lucide stroke-line-join icons for sweep/pipe outerCorner / innerCorner. */
const CORNER_ICONS: Record<CornerValueKey, LucideIcon> = {
  round: StrokeLineJoinRound,
  bevel: StrokeLineJoinBevel,
  miter: StrokeLineJoinMiter,
};

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

function isCornerValue(v: string): v is CornerValueKey {
  return Object.prototype.hasOwnProperty.call(CORNER_VALUE_LABELS, v);
}

function iconVNode(kind: CornerValueKey, className = "corner-icon") {
  return h(CORNER_ICONS[kind], {
    class: className,
    size: 16,
    "aria-hidden": "true",
  });
}

const options = computed<SelectOption[]>(() =>
  CORNER_VALUES.map((value) => ({
    value,
    label: attrValueLabel("outerCorner", value),
    content: () =>
      h("div", { class: "corner-option" }, [
        iconVNode(value),
        h(
          "span",
          { class: "corner-option__label" },
          attrValueLabel("outerCorner", value)
        ),
      ]),
  }))
);

const current = computed(() => {
  const v = (props.modelValue ?? "").trim();
  return isCornerValue(v) ? v : null;
});

const isUnset = computed(() => current.value == null);

const effective = computed((): CornerValueKey => {
  if (current.value) return current.value;
  const ph = (props.placeholder ?? "").trim();
  if (isCornerValue(ph)) return ph;
  return "round";
});

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
    :size="size || 'small'"
    :placeholder="placeholder"
    class="corner-attr-select enum-select"
    :class="{ 'is-unset': isUnset }"
    :popup-props="{ overlayClassName: 'corner-attr-select-popup' }"
    @change="onChange"
    @clear="onClear"
  >
    <template #valueDisplay>
      <div class="corner-value" :class="{ 'is-unset': isUnset }">
        <component
          :is="CORNER_ICONS[effective]"
          class="corner-icon corner-icon--inline"
          :size="16"
          aria-hidden="true"
        />
        <span class="corner-value__label">{{
          attrValueLabel("outerCorner", effective)
        }}</span>
      </div>
    </template>
  </t-select>
</template>

<style scoped>
.corner-attr-select {
  width: 100%;
}

.corner-value {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  line-height: 1;
}

.corner-value__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.corner-value.is-unset .corner-value__label {
  color: var(--td-text-color-placeholder, #999);
}

.corner-icon {
  flex-shrink: 0;
  color: var(--td-text-color-primary);
}

.corner-value.is-unset .corner-icon {
  color: var(--td-text-color-placeholder, #999);
}

.corner-attr-select.is-unset :deep(.t-input),
.corner-attr-select.is-unset :deep(.t-input__inner) {
  color: var(--td-text-color-placeholder, #999);
}
</style>

<style>
.corner-attr-select-popup .t-select-option {
  height: auto !important;
  padding-top: 6px;
  padding-bottom: 6px;
}

.corner-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.corner-option__label {
  line-height: 1.2;
}

.corner-option .corner-icon {
  flex-shrink: 0;
  color: var(--td-text-color-primary);
}
</style>
