<script setup lang="ts">
import {
  Chart3DIcon,
  CheckIcon,
  CodeIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  FilterClearIcon,
  ForwardIcon,
  RollbackIcon,
  SaveIcon,
  ViewListIcon,
} from "tdesign-icons-vue-next";
import type { HeadMenuProps } from "tdesign-vue-next";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    showModel?: boolean;
    showSource?: boolean;
    canUndo?: boolean;
    canRedo?: boolean;
  }>(),
  {
    showModel: true,
    showSource: false,
    canUndo: false,
    canRedo: false,
  }
);

const emit = defineEmits<{
  save: [];
  export: [];
  back: [];
  undo: [];
  redo: [];
  format: [];
  optimize: [];
  "toggle-model": [];
  "toggle-source": [];
}>();

const { t } = useI18n();

const onChange: HeadMenuProps["onChange"] = (active) => {
  const key = String(active);
  if (key === "save") emit("save");
  else if (key === "export") emit("export");
  else if (key === "back") emit("back");
  else if (key === "undo") {
    if (props.canUndo) emit("undo");
  } else if (key === "redo") {
    if (props.canRedo) emit("redo");
  } else if (key === "format") emit("format");
  else if (key === "optimize") emit("optimize");
  else if (key === "view-model") emit("toggle-model");
  else if (key === "view-source") emit("toggle-source");
};
</script>

<template>
  <t-head-menu
    class="app-menus"
    theme="light"
    expand-type="popup"
    :value="undefined"
    @change="onChange"
  >
    <t-menu-item value="back">
      <template #icon><RollbackIcon /></template>
      {{ t("app.backBrowse") }}
    </t-menu-item>

    <t-submenu value="file" :title="t('app.file')">
      <template #icon><FileIcon /></template>
      <t-menu-item value="save">
        <template #icon><SaveIcon /></template>
        {{ t("app.save") }}
      </t-menu-item>
      <t-menu-item value="export">
        <template #icon><DownloadIcon /></template>
        {{ t("app.export") }}
      </t-menu-item>
    </t-submenu>

    <t-submenu value="edit-menu" :title="t('app.edit')">
      <template #icon><EditIcon /></template>
      <t-menu-item value="undo" :disabled="!canUndo">
        <template #icon><RollbackIcon /></template>
        {{ t("app.undo") }}
      </t-menu-item>
      <t-menu-item value="redo" :disabled="!canRedo">
        <template #icon><ForwardIcon /></template>
        {{ t("app.redo") }}
      </t-menu-item>
      <li class="app-menu-divider" role="separator" />
      <t-menu-item value="format">
        <template #icon><CodeIcon /></template>
        {{ t("app.formatCode") }}
      </t-menu-item>
      <t-menu-item value="optimize">
        <template #icon><FilterClearIcon /></template>
        {{ t("app.optimize") }}
      </t-menu-item>
    </t-submenu>

    <t-submenu value="view" :title="t('app.view')">
      <template #icon><ViewListIcon /></template>
      <t-menu-item value="view-model">
        <template #icon><Chart3DIcon /></template>
        <span class="menu-check-row">
          <CheckIcon v-if="showModel" class="menu-check" size="16px" />
          <span v-else class="menu-check-slot" />
          {{ t("app.viewModel") }}
        </span>
      </t-menu-item>
      <t-menu-item value="view-source">
        <template #icon><CodeIcon /></template>
        <span class="menu-check-row">
          <CheckIcon v-if="showSource" class="menu-check" size="16px" />
          <span v-else class="menu-check-slot" />
          {{ t("app.viewSource") }}
        </span>
      </t-menu-item>
    </t-submenu>
  </t-head-menu>
</template>

<style scoped>
.app-menus {
  flex: 0 0 auto;
  width: auto !important;
  max-width: max-content;
  background: transparent;
  box-shadow: none;
  border: none;
  height: 28px;
  line-height: 28px;
  padding: 0;
  margin: 0;
}

.app-menus :deep(.t-head-menu__inner) {
  width: auto;
  height: 28px;
  line-height: 28px;
  display: inline-flex;
  align-items: center;
}

.app-menus :deep(.t-head-menu__inner > .t-menu) {
  width: auto;
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;
  /* HeadMenu reserves space for an empty logo slot — drop it. */
  margin-left: 0 !important;
}

.app-menus :deep(.t-menu__operations),
.app-menus :deep(.t-menu__logo),
.app-menus :deep(.t-head-menu__submenu--more) {
  display: none !important;
}

.app-menus :deep(.t-submenu) {
  width: auto !important;
  margin: 0;
  padding: 0;
}

.app-menus :deep(.t-head-menu__inner > .t-menu > .t-menu__item),
.app-menus :deep(.t-submenu > .t-menu__item) {
  height: 28px;
  line-height: 28px;
  margin: 0;
  padding: 0 8px;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--td-text-color-primary);
  background: transparent !important;
  border-radius: var(--td-radius-default);
}

.app-menus :deep(.t-head-menu__inner > .t-menu > .t-menu__item .t-icon),
.app-menus :deep(.t-submenu > .t-menu__item .t-icon),
.app-menus :deep(.t-submenu > .t-menu__item .t-menu__item-link svg) {
  flex-shrink: 0;
}

.app-menus :deep(.t-submenu > .t-menu__item .t-fake-arrow) {
  display: none;
}

.app-menus :deep(.t-head-menu__inner > .t-menu > .t-menu__item:hover),
.app-menus :deep(.t-submenu > .t-menu__item:hover),
.app-menus :deep(.t-submenu.t-is-opened > .t-menu__item) {
  background: var(--td-bg-color-container-hover) !important;
  color: var(--td-text-color-primary);
}

.app-menus :deep(.t-menu__item.t-is-active),
.app-menus :deep(.t-menu__item.t-is-active::before) {
  background: transparent !important;
  color: var(--td-text-color-primary);
}

.menu-check-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.menu-check,
.menu-check-slot {
  width: 16px;
  flex-shrink: 0;
}

.menu-check {
  color: var(--td-brand-color);
}
</style>

<style>
/* Popup menu is teleported — unscoped divider for Edit submenu. */
.t-popup.t-is-head-menu .app-menu-divider {
  list-style: none;
  height: 0;
  margin: 4px 8px;
  border-top: 1px solid var(--td-component-border);
  pointer-events: none;
}
</style>
