<script setup lang="ts">
import { computed, ref } from "vue";
import { CloseCircleFilledIcon } from "tdesign-icons-vue-next";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    clearable?: boolean;
    readonly?: boolean;
    disabled?: boolean;
  }>(),
  {
    modelValue: "",
    placeholder: "",
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

const focused = ref(false);
const mirrorEl = ref<HTMLElement | null>(null);

type AxisToken = {
  text: string;
  /** 0=R, 1=G, 2=B; undefined = whitespace / punctuation */
  axis?: 0 | 1 | 2;
};

/** Keep separators so mirror stays glyph-aligned with the native input. */
function tokenizeVecRgb(raw: string): AxisToken[] {
  const out: AxisToken[] = [];
  let axis = 0;
  const re = /(\s+)|([^\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1]) {
      out.push({ text: m[1] });
    } else {
      out.push({ text: m[2]!, axis: (axis % 3) as 0 | 1 | 2 });
      axis += 1;
    }
  }
  return out;
}

const valueText = computed(() => props.modelValue ?? "");
const isEmpty = computed(() => !valueText.value.trim());

const mirrorTokens = computed(() =>
  tokenizeVecRgb(isEmpty.value ? props.placeholder || "" : valueText.value)
);

const showClear = computed(
  () =>
    props.clearable &&
    !props.readonly &&
    !props.disabled &&
    !!valueText.value &&
    !isEmpty.value
);

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  emit("update:modelValue", el.value);
}

function syncMirrorScroll(e: Event): void {
  const el = e.target as HTMLInputElement;
  if (mirrorEl.value) mirrorEl.value.scrollLeft = el.scrollLeft;
}

function onClear(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  emit("update:modelValue", "");
  emit("clear");
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    emit("enter");
  }
}

function axisClass(axis: 0 | 1 | 2 | undefined): string {
  if (axis === 0) return "axis-r";
  if (axis === 1) return "axis-g";
  if (axis === 2) return "axis-b";
  return "axis-sep";
}
</script>

<template>
  <div
    class="vec-rgb-input"
    :class="{
      focused,
      readonly,
      disabled,
      empty: isEmpty,
      'has-clear': showClear,
    }"
  >
    <div ref="mirrorEl" class="mirror" aria-hidden="true">
      <span
        v-for="(tok, i) in mirrorTokens"
        :key="i"
        :class="axisClass(tok.axis)"
        >{{ tok.text }}</span
      >
    </div>
    <input
      class="native"
      :value="valueText"
      :readonly="readonly"
      :disabled="disabled"
      :placeholder="''"
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
      @scroll="syncMirrorScroll"
      @focus="focused = true"
      @blur="
        focused = false;
        emit('blur');
      "
      @keydown="onKeydown"
    />
    <button
      v-if="showClear"
      type="button"
      class="clear-btn"
      tabindex="-1"
      aria-label="clear"
      @mousedown="onClear"
    >
      <CloseCircleFilledIcon />
    </button>
  </div>
</template>

<style scoped>
.vec-rgb-input {
  --vec-r: #e53935;
  --vec-g: #43a047;
  --vec-b: #1e88e5;
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: var(--td-comp-size-xs, 24px);
  box-sizing: border-box;
  border: 1px solid var(--td-border-level-2-color, var(--td-component-border));
  border-radius: var(--td-radius-default, var(--td-radius-small));
  background: var(--td-bg-color-specialcomponent, var(--td-bg-color-container));
  transition: border-color 0.15s ease;
  overflow: hidden;
}

.vec-rgb-input.focused {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px var(--td-brand-color-focus, transparent);
}

.vec-rgb-input.readonly,
.vec-rgb-input.disabled {
  background: var(--td-bg-color-component-disabled, var(--td-bg-color-secondarycontainer));
  cursor: default;
}

.vec-rgb-input.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.mirror,
.native {
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: var(--td-comp-size-xs, 24px);
  letter-spacing: normal;
  white-space: pre;
}

.mirror {
  position: absolute;
  inset: 0;
  display: block;
  overflow: hidden;
  padding: 0 8px;
  pointer-events: none;
  color: var(--td-text-color-primary);
}

.has-clear .mirror {
  padding-right: 28px;
}

.vec-rgb-input.empty .mirror {
  opacity: 0.55;
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

.axis-sep {
  color: var(--td-text-color-secondary);
}

.native {
  position: relative;
  z-index: 1;
  /* Kill intrinsic <input size=20> min-width that blows out flex layouts. */
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  max-width: 100%;
  height: 100%;
  margin: 0;
  padding: 0 8px;
  border: 0;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--td-text-color-primary);
  overflow-x: auto;
}

.has-clear .native {
  padding-right: 28px;
}

.native::selection {
  background: color-mix(in srgb, var(--td-brand-color) 35%, transparent);
}

.clear-btn {
  position: absolute;
  right: 4px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--td-text-color-placeholder);
  cursor: pointer;
  font-size: 14px;
}

.clear-btn:hover {
  color: var(--td-text-color-secondary);
}
</style>
