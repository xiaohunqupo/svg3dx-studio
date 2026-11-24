<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Link1Icon } from "tdesign-icons-vue-next";
import VecRgbInput from "@/components/VecRgbInput.vue";
import { useI18n } from "@/i18n";
import type { ParamSourceGroup } from "@/utils/paramScope";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    /** Document `<s3dx:point id>` values (without `#`). */
    pointIds?: string[];
    placeholder?: string;
    clearable?: boolean;
    readonly?: boolean;
    disabled?: boolean;
    paramGroups?: ParamSourceGroup[];
    effectiveNames?: ReadonlySet<string> | Set<string>;
    paramValues?: ReadonlyMap<string, string> | Map<string, string>;
    /** Whether viewport pick mode is armed for this field. */
    pickArmed?: boolean;
  }>(),
  {
    modelValue: "",
    pointIds: () => [],
    placeholder: "0 0 0",
    clearable: true,
    readonly: false,
    disabled: false,
    paramGroups: () => [],
    pickArmed: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  blur: [];
  enter: [];
  clear: [];
  /** Request viewport pick of an `<s3dx:point>`. */
  pickViewport: [];
}>();

const { t } = useI18n();

const REF_RE = /^ref\(\s*#([^)]+)\s*\)$/i;

function isRefValue(raw: string): boolean {
  return REF_RE.test(raw.trim());
}

function bareFromRef(raw: string): string {
  const m = REF_RE.exec(raw.trim());
  return (m?.[1] ?? "").trim();
}

function toRef(id: string): string {
  const bare = id.trim().replace(/^#/, "");
  return bare ? `ref(#${bare})` : "";
}

const isRef = computed(() => isRefValue(props.modelValue ?? ""));

const selectOptions = computed(() =>
  props.pointIds.map((id) => ({ label: id, value: id }))
);

const refSelectValue = computed(() =>
  isRef.value ? bareFromRef(props.modelValue ?? "") : undefined
);

function onSelectPoint(id: unknown): void {
  const bare = String(id ?? "").trim();
  if (!bare) return;
  emit("update:modelValue", toRef(bare));
  emit("enter");
}

function clearRefToLiteral(): void {
  emit("update:modelValue", "");
  emit("clear");
}

const menuOpen = ref(false);

watch(
  () => props.modelValue,
  () => {
    /* keep select in sync via computed */
  }
);
</script>

<template>
  <div class="point-attr">
    <div v-if="isRef" class="point-attr__ref-row">
      <t-select
        :value="refSelectValue"
        :options="selectOptions"
        filterable
        clearable
        size="small"
        class="point-attr__select"
        :placeholder="t('app.pickPointRef')"
        :disabled="readonly || disabled"
        @change="onSelectPoint"
        @clear="clearRefToLiteral"
      />
      <t-input
        :model-value="modelValue"
        size="small"
        class="point-attr__raw"
        :readonly="readonly"
        :disabled="disabled"
        :placeholder="t('app.pointRefPlaceholder')"
        @update:model-value="(v: string) => emit('update:modelValue', v ?? '')"
        @blur="emit('blur')"
        @enter="emit('enter')"
      />
    </div>
    <VecRgbInput
      v-else
      :model-value="modelValue"
      :clearable="clearable"
      :readonly="readonly"
      :disabled="disabled"
      :placeholder="placeholder"
      class="point-attr__vec"
      :param-groups="paramGroups"
      :effective-names="effectiveNames"
      :param-values="paramValues"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
      @blur="emit('blur')"
      @enter="emit('enter')"
      @clear="emit('clear')"
    />
    <div class="point-attr__actions">
      <t-popup
        v-model="menuOpen"
        trigger="click"
        placement="bottom-right"
        :disabled="readonly || disabled || pointIds.length === 0"
      >
        <t-button
          size="small"
          variant="outline"
          :disabled="readonly || disabled || pointIds.length === 0"
        >
          <template #icon><Link1Icon /></template>
          {{ t("app.pickPointRef") }}
        </t-button>
        <template #content>
          <div class="point-attr__menu">
            <button
              v-for="id in pointIds"
              :key="id"
              type="button"
              class="point-attr__menu-item"
              @click="
                () => {
                  onSelectPoint(id);
                  menuOpen = false;
                }
              "
            >
              {{ id }}
            </button>
          </div>
        </template>
      </t-popup>
      <t-button
        size="small"
        :variant="pickArmed ? 'base' : 'outline'"
        :theme="pickArmed ? 'primary' : 'default'"
        :disabled="readonly || disabled"
        :title="t('app.pickPointArmed')"
        @click="emit('pickViewport')"
      >
        {{ t("app.pickPointViewport") }}
      </t-button>
    </div>
  </div>
</template>

<style scoped>
.point-attr {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.point-attr__ref-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.point-attr__select,
.point-attr__raw,
.point-attr__vec {
  width: 100%;
  min-width: 0;
}
.point-attr__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.point-attr__menu {
  display: flex;
  flex-direction: column;
  max-height: 220px;
  overflow: auto;
  min-width: 140px;
  padding: 4px 0;
}
.point-attr__menu-item {
  appearance: none;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--td-text-color-primary);
  font: inherit;
}
.point-attr__menu-item:hover {
  background: var(--td-bg-color-container-hover);
}
</style>
