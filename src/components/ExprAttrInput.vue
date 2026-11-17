<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { CheckIcon, CloseCircleFilledIcon } from "tdesign-icons-vue-next";
import { useI18n } from "@/i18n";
import {
  colorizeExprDisplay,
  expandExprInput,
  findParamTokens,
  insertParamAtCaret,
  paramTokenAtCaret,
  replaceParamToken,
  replaceSelectionWithParam,
  simplifyExprDisplay,
} from "@/utils/exprAttr";
import { blankIfEqualsDefault } from "@/utils/attrDefault";
import { previewExprResult } from "@/utils/exprEval";
import type { ParamSourceGroup } from "@/utils/paramScope";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
    paramGroups?: ParamSourceGroup[];
    effectiveNames?: ReadonlySet<string> | Set<string>;
    /** Param bare-name → value, for the numeric preview under the field. */
    paramValues?: ReadonlyMap<string, string> | Map<string, string>;
    /** When false, hide the numeric preview (e.g. VecRgb owns its own). */
    showResult?: boolean;
    clearable?: boolean;
    readonly?: boolean;
    disabled?: boolean;
  }>(),
  {
    modelValue: "",
    placeholder: "",
    paramGroups: () => [],
    showResult: true,
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

const { t } = useI18n();

const focused = ref(false);
const editText = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
const fieldEl = ref<HTMLElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const mirrorEl = ref<HTMLElement | null>(null);
const caret = ref(0);
const selEnd = ref(0);
const activeBare = ref<string | null>(null);
const menuStyle = ref<Record<string, string>>({});
/** Ignore the blur caused by mousedown inside the picker. */
let ignoreBlurOnce = false;
let docListen = false;

const effective = computed(
  () => props.effectiveNames ?? new Set<string>()
);

const emptyParams = new Map<string, string>();

/** Shown text: keep mixed expressions intact; only pure var/calc(var) simplify. */
function toDisplay(stored: string): string {
  return simplifyExprDisplay(stored);
}

const displayText = computed(() =>
  focused.value ? editText.value : toDisplay(props.modelValue ?? "")
);

const colorTokens = computed(() =>
  colorizeExprDisplay(displayText.value, effective.value)
);

/** Numeric preview under the field (same placement as VecRgb result). */
const resultText = computed((): string | null => {
  if (!props.showResult) return null;
  const raw = focused.value
    ? expandExprInput(editText.value, effective.value)
    : (props.modelValue ?? "");
  if (!raw.trim()) return null;
  return previewExprResult(raw, props.paramValues ?? emptyParams);
});

const showClear = computed(
  () =>
    props.clearable &&
    !props.readonly &&
    !props.disabled &&
    !!(focused.value ? editText.value.trim() : (props.modelValue ?? "").trim())
);

const showPicker = computed(
  () => focused.value && !props.readonly && !props.disabled
);

watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) {
      editText.value = toDisplay(v ?? "");
    }
  },
  { immediate: true }
);

/** Keep native input value aligned with the colored mirror. */
watch(displayText, (v) => {
  const el = inputEl.value;
  if (el && el.value !== v) {
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = v;
    if (focused.value && start != null && end != null) {
      const max = v.length;
      el.setSelectionRange(Math.min(start, max), Math.min(end, max));
    }
  }
});

function syncCaretFromInput(): void {
  const el = inputEl.value;
  if (!el) return;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  caret.value = start;
  selEnd.value = end;
  const text = editText.value;
  if (start !== end) {
    // Selection: mark active only when the range sits on one param token.
    const tokens = findParamTokens(text);
    const hit = tokens.find((t) => start >= t.start && end <= t.end);
    activeBare.value = hit?.bare ?? null;
  } else {
    activeBare.value = paramTokenAtCaret(text, start)?.bare ?? null;
  }
}

function bindDocListen(on: boolean): void {
  if (on === docListen) return;
  docListen = on;
  if (on) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
  }
}

function onDocPointerDown(e: PointerEvent): void {
  if (!focused.value) return;
  const t = e.target as Node | null;
  if (!t) return;
  if (fieldEl.value?.contains(t)) return;
  if (menuEl.value?.contains(t)) return;
  // Outside: end edit in one click (don't fight with suppress-blur refocus).
  commitAndClose();
}

function normalizeStored(stored: string): string {
  // Studio rule: equal to placeholder/default → unset.
  return blankIfEqualsDefault(stored, props.placeholder);
}

function commitAndClose(): void {
  const stored = normalizeStored(
    expandExprInput(editText.value, effective.value)
  );
  emit("update:modelValue", stored);
  focused.value = false;
  activeBare.value = null;
  editText.value = toDisplay(stored);
  bindDocListen(false);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
  inputEl.value?.blur();
  emit("blur");
}

function updateMenuPosition(): void {
  const el = fieldEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const maxH = 200;
  const spaceBelow = window.innerHeight - r.bottom - 8;
  const openUp = spaceBelow < 120 && r.top > spaceBelow;
  menuStyle.value = {
    position: "fixed",
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(r.width)}px`,
    maxHeight: `${maxH}px`,
    zIndex: "4000",
    ...(openUp
      ? { bottom: `${Math.round(window.innerHeight - r.top + 4)}px`, top: "auto" }
      : { top: `${Math.round(r.bottom + 4)}px`, bottom: "auto" }),
  };
}

function onScrollOrResize(): void {
  if (showPicker.value) updateMenuPosition();
}

function commitFromEdit(): void {
  const stored = normalizeStored(
    expandExprInput(editText.value, effective.value)
  );
  emit("update:modelValue", stored);
}

function onFocus(): void {
  if (!focused.value) {
    editText.value = toDisplay(props.modelValue ?? "");
  }
  focused.value = true;
  bindDocListen(true);
  nextTick(() => {
    const el = inputEl.value;
    if (el && el.value !== editText.value) el.value = editText.value;
    syncCaretFromInput();
    updateMenuPosition();
  });
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
}

function onBlur(): void {
  if (ignoreBlurOnce) {
    ignoreBlurOnce = false;
    nextTick(() => inputEl.value?.focus());
    return;
  }
  // Real blur (e.g. Tab). Outside click is handled by onDocPointerDown.
  if (!focused.value) return;
  commitAndClose();
}

function onInput(e: Event): void {
  focused.value = true;
  editText.value = (e.target as HTMLInputElement).value;
  syncCaretFromInput();
}

function onSelectOrKeyup(): void {
  syncCaretFromInput();
}

function syncMirrorScroll(e: Event): void {
  const el = e.target as HTMLInputElement;
  if (mirrorEl.value) mirrorEl.value.scrollLeft = el.scrollLeft;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    commitFromEdit();
    emit("enter");
    commitAndClose();
  } else if (e.key === "Escape") {
    editText.value = toDisplay(props.modelValue ?? "");
    commitAndClose();
  } else {
    nextTick(syncCaretFromInput);
  }
}

function onClear(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  editText.value = "";
  activeBare.value = null;
  emit("update:modelValue", "");
  emit("clear");
}

function applyEdit(next: string, nextCaret: number): void {
  editText.value = next;
  nextTick(() => {
    const el = inputEl.value;
    if (el) {
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    }
    caret.value = nextCaret;
    const token = paramTokenAtCaret(next, nextCaret);
    activeBare.value = token?.bare ?? null;
  });
}

function pickParam(bare: string, overridden: boolean): void {
  if (overridden) return;
  const text = editText.value;
  const el = inputEl.value;
  const start = el?.selectionStart ?? caret.value;
  const end = el?.selectionEnd ?? selEnd.value;
  // 1) Explicit selection → replace the selected range.
  if (start !== end) {
    const { text: next, caret: nextCaret } = replaceSelectionWithParam(
      text,
      start,
      end,
      bare
    );
    applyEdit(next, nextCaret);
    return;
  }
  // 2) Caret on a param token → replace that token.
  const token = paramTokenAtCaret(text, start);
  if (token) {
    const { text: next, caret: nextCaret } = replaceParamToken(
      text,
      token,
      bare
    );
    applyEdit(next, nextCaret);
    return;
  }
  // 3) Otherwise insert at caret.
  const { text: next, caret: nextCaret } = insertParamAtCaret(
    text,
    start,
    bare
  );
  applyEdit(next, nextCaret);
}

function onPickerMouseDown(e: MouseEvent): void {
  // Keep caret/selection in the input; don't steal focus.
  e.preventDefault();
  ignoreBlurOnce = true;
}

function tokenClass(k: string): string {
  if (k === "param-ok") return "text-ok";
  if (k === "param-bad") return "text-bad";
  return "text-literal";
}

onBeforeUnmount(() => {
  bindDocListen(false);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
});
</script>

<template>
  <div
    class="expr-attr"
    :class="{ focused, readonly, disabled, 'has-clear': showClear }"
  >
    <div ref="fieldEl" class="expr-field" @focusin="onFocus">
      <div ref="mirrorEl" class="mirror" aria-hidden="true">
        <template v-if="displayText">
          <span
            v-for="(tok, i) in colorTokens"
            :key="i"
            :class="tokenClass(tok.kind)"
            >{{ tok.text }}</span
          >
        </template>
        <span v-else-if="placeholder" class="ph">{{ placeholder }}</span>
      </div>
      <input
        ref="inputEl"
        class="native"
        :value="displayText"
        :readonly="readonly"
        :disabled="disabled"
        :placeholder="''"
        spellcheck="false"
        autocomplete="off"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @scroll="syncMirrorScroll"
        @keydown="onKeydown"
        @keyup="onSelectOrKeyup"
        @click="onSelectOrKeyup"
        @select="onSelectOrKeyup"
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
    <div v-if="resultText" class="expr-result" aria-hidden="true">{{
      resultText
    }}</div>

    <Teleport to="body">
      <div
        v-if="showPicker"
        ref="menuEl"
        class="expr-param-menu"
        :style="menuStyle"
        @mousedown="onPickerMouseDown"
      >
        <div v-if="!paramGroups.length" class="picker-empty">
          {{ t("app.noParamsAvailable") }}
        </div>
        <div
          v-for="group in paramGroups"
          :key="group.id"
          class="picker-group"
        >
          <div class="picker-group-title">{{ group.label }}</div>
          <button
            v-for="item in group.items"
            :key="`${group.id}:${item.bare}`"
            type="button"
            class="picker-item"
            :class="{
              overridden: item.overridden,
              current: !item.overridden && activeBare === item.bare,
            }"
            :disabled="item.overridden"
            @mousedown.prevent="pickParam(item.bare, item.overridden)"
          >
            <span class="picker-check-slot" aria-hidden="true">
              <CheckIcon
                v-if="!item.overridden && activeBare === item.bare"
                class="picker-check"
              />
            </span>
            <span class="picker-name">{{ item.bare }}</span>
            <span class="picker-value">{{ item.value }}</span>
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.expr-attr {
  --expr-purple: #7c4dff;
  --expr-blue: #448aff;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.expr-field {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: var(--td-comp-size-xs, 24px);
  box-sizing: border-box;
  border: 0;
  border-radius: var(--td-radius-default, var(--td-radius-small));
  /* Opaque fill only — gradient lives on ::before ring (dark-mode safe). */
  background: var(--td-input-bg-color, var(--td-bg-color-container));
  transition: box-shadow 0.15s ease;
  isolation: isolate;
  overflow: hidden;
}

.expr-result {
  min-width: 0;
  padding: 0 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.3;
  color: var(--td-text-color-secondary);
}

.expr-field::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  border-radius: inherit;
  /* 1px only — fractional widths look uneven on top/left vs bottom/right. */
  padding: 1px;
  background: linear-gradient(120deg, var(--expr-purple), var(--expr-blue));
  pointer-events: none;
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
}

.expr-attr.focused .expr-field {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--expr-purple) 28%, transparent);
}

.expr-attr.readonly .expr-field,
.expr-attr.disabled .expr-field {
  opacity: 0.75;
}

.mirror,
.native {
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: var(--td-comp-size-xs, 24px);
  white-space: pre;
}

.mirror {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  padding: 0 8px;
  pointer-events: none;
  white-space: pre;
}

.has-clear .mirror {
  padding-right: 28px;
}

.ph {
  color: var(--td-text-color-placeholder);
  opacity: 0.7;
}

.text-ok {
  color: var(--expr-purple);
  font-weight: 600;
}

.text-bad {
  color: #e53935;
  font-weight: 600;
}

.text-literal {
  color: var(--td-text-color-primary);
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

<!-- Menu is teleported to body — unscoped surface styles -->
<style>
.expr-param-menu {
  --expr-purple: #7c4dff;
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default, 6px);
  background: var(--td-bg-color-container);
  box-shadow: var(--td-shadow-2, 0 6px 16px rgba(0, 0, 0, 0.12));
}

.expr-param-menu .picker-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.expr-param-menu .picker-group + .picker-group {
  border-top: 1px solid var(--td-component-border);
}

.expr-param-menu .picker-group-title {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
}

.expr-param-menu .picker-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.expr-param-menu .picker-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--expr-purple) 12%, transparent);
}

.expr-param-menu .picker-item.overridden,
.expr-param-menu .picker-item:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  color: var(--td-text-color-disabled, var(--td-text-color-placeholder));
}

.expr-param-menu .picker-name {
  color: var(--expr-purple);
  font-weight: 600;
}

.expr-param-menu .picker-item.overridden .picker-name {
  color: inherit;
  font-weight: 500;
}

.expr-param-menu .picker-value {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--td-text-color-secondary);
}

/* Fixed slot so checkmark never shifts name/value columns. */
.expr-param-menu .picker-check-slot {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.expr-param-menu .picker-check {
  font-size: 14px;
  color: var(--expr-purple);
}
</style>
