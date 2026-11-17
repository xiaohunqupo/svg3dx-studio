<script setup lang="ts">
import { computed } from "vue";
import ExprAttrInput from "@/components/ExprAttrInput.vue";
import { previewExprResult } from "@/utils/exprEval";
import { blankIfEqualsDefault } from "@/utils/attrDefault";
import { clampVecTokens, splitVecTokens } from "@/utils/nodeSchema";
import type { ParamSourceGroup } from "@/utils/paramScope";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    paramGroups?: ParamSourceGroup[];
    effectiveNames?: ReadonlySet<string> | Set<string>;
    /** Param bare-name → value, for the numeric preview under the field. */
    paramValues?: ReadonlyMap<string, string> | Map<string, string>;
    /** Max components; 0 = derive from placeholder (default 3). */
    maxComponents?: number;
    clearable?: boolean;
    readonly?: boolean;
    disabled?: boolean;
  }>(),
  {
    modelValue: "",
    placeholder: "",
    paramGroups: () => [],
    maxComponents: 0,
    clearable: false,
    readonly: false,
    disabled: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  blur: [];
  enter: [];
  clear: [];
}>();

const emptyParams = new Map<string, string>();

/** Expected arity from prop or placeholder (vec3 / mat12 / point list). */
const arity = computed(() => {
  if (props.maxComponents > 0) return props.maxComponents;
  const n = splitVecTokens(props.placeholder ?? "").length;
  return n > 0 ? n : 3;
});

function clampValue(raw: string): string {
  return clampVecTokens(raw, arity.value);
}

/** Value equal to placeholder/default → unset (so clear sticks, X goes away). */
function normalizeValue(raw: string): string {
  return blankIfEqualsDefault(clampValue(raw ?? ""), props.placeholder);
}

function onUpdate(raw: string): void {
  emit("update:modelValue", normalizeValue(raw ?? ""));
}

type ResultPart = {
  text: string;
  axis: 0 | 1 | 2;
  ok: boolean;
};

/** Prefer committed value; fall back to placeholder (transform identity defaults). */
const previewSource = computed(() => {
  const raw = clampValue(props.modelValue ?? "");
  if (raw.trim()) return raw;
  return clampValue(props.placeholder ?? "");
});

const resultParts = computed((): ResultPart[] => {
  const toks = splitVecTokens(previewSource.value);
  if (!toks.length) return [];
  const params = props.paramValues ?? emptyParams;
  return toks.map((tok, i) => {
    const preview = previewExprResult(tok, params);
    return {
      text: preview ?? "?",
      axis: (i % 3) as 0 | 1 | 2,
      ok: preview != null,
    };
  });
});

const showResult = computed(
  () =>
    resultParts.value.length > 0 && resultParts.value.some((p) => p.ok)
);

const resultFromPlaceholder = computed(
  () => !(props.modelValue ?? "").trim() && !!(props.placeholder ?? "").trim()
);

function axisClass(axis: 0 | 1 | 2): string {
  if (axis === 0) return "axis-r";
  if (axis === 1) return "axis-g";
  return "axis-b";
}
</script>

<template>
  <div class="vec-rgb-input" :class="{ readonly, disabled }">
    <ExprAttrInput
      class="vec-expr"
      :model-value="modelValue"
      :placeholder="placeholder"
      :param-groups="paramGroups"
      :effective-names="effectiveNames"
      :param-values="paramValues"
      :show-result="false"
      :clearable="clearable"
      :readonly="readonly"
      :disabled="disabled"
      @update:model-value="onUpdate"
      @blur="emit('blur')"
      @enter="emit('enter')"
      @clear="emit('clear')"
    />
    <div
      v-if="showResult"
      class="vec-result"
      :class="{ placeholder: resultFromPlaceholder }"
      aria-hidden="true"
    >
      <span
        v-for="(part, i) in resultParts"
        :key="i"
        :class="[axisClass(part.axis), { bad: !part.ok }]"
        >{{ i > 0 ? "\u00a0" : "" }}{{ part.text }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.vec-rgb-input {
  --vec-r: #e53935;
  --vec-g: #43a047;
  --vec-b: #1e88e5;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.vec-rgb-input.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.vec-expr {
  min-width: 0;
  width: 100%;
}

.vec-result {
  min-width: 0;
  padding: 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.3;
}

.axis-r {
  color: var(--vec-r);
}

.axis-g {
  color: var(--vec-g);
}

.axis-b {
  color: var(--vec-b);
}

.vec-result .bad {
  color: var(--td-text-color-placeholder);
}

.vec-result.placeholder {
  opacity: 0.55;
}
</style>
