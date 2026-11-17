<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { CheckIcon, CloseCircleFilledIcon } from "tdesign-icons-vue-next";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** Defs top-level group ids (without `#`). */
    options?: string[];
    placeholder?: string;
    clearable?: boolean;
    readonly?: boolean;
    disabled?: boolean;
  }>(),
  {
    modelValue: "",
    options: () => [],
    placeholder: "#groupId",
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
const menuStyle = ref<Record<string, string>>({});
let ignoreBlurOnce = false;
let docListen = false;

const optionSet = computed(() => new Set(props.options));

/** Strip leading `#` for id matching. */
function bareId(raw: string): string {
  return raw.trim().replace(/^#/, "");
}

/** Persist as `#id` when non-empty. */
function normalizeHref(raw: string): string {
  const id = bareId(raw);
  return id ? `#${id}` : "";
}

const displayText = computed(() =>
  focused.value ? editText.value : props.modelValue ?? ""
);

const currentBare = computed(() => bareId(displayText.value));

const isValid = computed(() => {
  const id = currentBare.value;
  if (!id) return true; // empty = unset, not an error
  return optionSet.value.has(id);
});

const showClear = computed(
  () =>
    props.clearable &&
    !props.readonly &&
    !props.disabled &&
    !!displayText.value.trim()
);

const showPicker = computed(
  () => focused.value && !props.readonly && !props.disabled
);

watch(
  () => props.modelValue,
  (v) => {
    if (!focused.value) editText.value = v ?? "";
  },
  { immediate: true }
);

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

function bindDocListen(on: boolean): void {
  if (on === docListen) return;
  docListen = on;
  if (on) document.addEventListener("pointerdown", onDocPointerDown, true);
  else document.removeEventListener("pointerdown", onDocPointerDown, true);
}

function onDocPointerDown(e: PointerEvent): void {
  if (!focused.value) return;
  const t = e.target as Node | null;
  if (!t) return;
  if (fieldEl.value?.contains(t)) return;
  if (menuEl.value?.contains(t)) return;
  commitAndClose();
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

function commitAndClose(): void {
  const stored = normalizeHref(editText.value);
  emit("update:modelValue", stored);
  focused.value = false;
  editText.value = stored;
  bindDocListen(false);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
  inputEl.value?.blur();
  emit("blur");
}

function onFocus(): void {
  if (!focused.value) editText.value = props.modelValue ?? "";
  focused.value = true;
  bindDocListen(true);
  nextTick(() => {
    const el = inputEl.value;
    if (el && el.value !== editText.value) el.value = editText.value;
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
  if (!focused.value) return;
  commitAndClose();
}

function onInput(e: Event): void {
  focused.value = true;
  editText.value = (e.target as HTMLInputElement).value;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter") {
    emit("enter");
    commitAndClose();
  } else if (e.key === "Escape") {
    editText.value = props.modelValue ?? "";
    commitAndClose();
  }
}

function onClear(e: MouseEvent): void {
  e.preventDefault();
  e.stopPropagation();
  editText.value = "";
  emit("update:modelValue", "");
  emit("clear");
}

function pickId(id: string): void {
  const next = normalizeHref(id);
  editText.value = next;
  emit("update:modelValue", next);
  nextTick(() => {
    const el = inputEl.value;
    if (el) {
      el.focus();
      el.setSelectionRange(next.length, next.length);
    }
  });
}

function onPickerMouseDown(e: MouseEvent): void {
  e.preventDefault();
  ignoreBlurOnce = true;
}

onBeforeUnmount(() => {
  bindDocListen(false);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
});
</script>

<template>
  <div
    class="href-ref"
    :class="{
      focused,
      readonly,
      disabled,
      'has-clear': showClear,
      invalid: !isValid && !!displayText.trim(),
    }"
  >
    <div ref="fieldEl" class="href-field" @focusin="onFocus">
      <div class="mirror" aria-hidden="true">
        <span v-if="displayText" :class="isValid ? 'text-ok' : 'text-bad'">{{
          displayText
        }}</span>
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

    <Teleport to="body">
      <div
        v-if="showPicker"
        ref="menuEl"
        class="href-ref-menu"
        :style="menuStyle"
        @mousedown="onPickerMouseDown"
      >
        <div v-if="!options.length" class="picker-empty">
          {{ t("app.noHrefTargets") }}
        </div>
        <button
          v-for="id in options"
          :key="id"
          type="button"
          class="picker-item"
          :class="{ current: currentBare === id }"
          @mousedown.prevent="pickId(id)"
        >
          <span class="picker-check-slot" aria-hidden="true">
            <CheckIcon v-if="currentBare === id" class="picker-check" />
          </span>
          <span class="picker-name">#{{ id }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.href-ref {
  --href-accent: #7c4dff;
  position: relative;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

.href-field {
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
  background: var(--td-input-bg-color, var(--td-bg-color-container));
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.href-ref.focused .href-field {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 2px var(--td-brand-color-focus, transparent);
}

.href-ref.invalid .href-field {
  border-color: #e53935;
}

.href-ref.readonly .href-field,
.href-ref.disabled .href-field {
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
}

.has-clear .mirror {
  padding-right: 28px;
}

.ph {
  color: var(--td-text-color-placeholder);
  opacity: 0.7;
}

.text-ok {
  color: var(--td-text-color-primary);
}

.text-bad {
  color: #e53935;
  font-weight: 600;
}

.native {
  position: relative;
  z-index: 1;
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

<style>
.href-ref-menu {
  --href-accent: #7c4dff;
  overflow: auto;
  box-sizing: border-box;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-default, 6px);
  background: var(--td-bg-color-container);
  box-shadow: var(--td-shadow-2, 0 6px 16px rgba(0, 0, 0, 0.12));
}

.href-ref-menu .picker-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--td-text-color-placeholder);
}

.href-ref-menu .picker-item {
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

.href-ref-menu .picker-item:hover {
  background: color-mix(in srgb, var(--href-accent) 12%, transparent);
}

.href-ref-menu .picker-check-slot {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

.href-ref-menu .picker-check {
  font-size: 14px;
  color: var(--href-accent);
}

.href-ref-menu .picker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--td-text-color-primary);
}
</style>
