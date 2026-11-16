<script setup lang="ts">
import { SettingIcon } from "tdesign-icons-vue-next";
import { useI18n, type Locale } from "@/i18n";
import { useTheme, type ColorScheme } from "@/theme";

const { locale, setLocale, t } = useI18n();
const { colorScheme, setColorScheme } = useTheme();

function onLocaleChange(value: string | number | boolean): void {
  if (value === "zh" || value === "en") setLocale(value as Locale);
}

function onSchemeChange(value: string | number | boolean): void {
  if (value === "light" || value === "dark") setColorScheme(value as ColorScheme);
}
</script>

<template>
  <t-popup trigger="click" placement="bottom-right" :overlay-inner-style="{ padding: 0 }">
    <t-button
      class="settings-trigger"
      variant="text"
      shape="square"
      :title="t('app.settings')"
      :aria-label="t('app.settings')"
    >
      <template #icon><SettingIcon /></template>
    </t-button>
    <template #content>
      <div class="settings-panel" role="menu">
        <div class="settings-row">
          <div class="settings-label">{{ t("app.language") }}</div>
          <t-radio-group
            :value="locale"
            variant="default-filled"
            size="small"
            @change="onLocaleChange"
          >
            <t-radio-button value="zh">{{ t("app.langZh") }}</t-radio-button>
            <t-radio-button value="en">{{ t("app.langEn") }}</t-radio-button>
          </t-radio-group>
        </div>
        <div class="settings-row">
          <div class="settings-label">{{ t("app.colorScheme") }}</div>
          <t-radio-group
            :value="colorScheme"
            variant="default-filled"
            size="small"
            @change="onSchemeChange"
          >
            <t-radio-button value="light">{{ t("app.themeLight") }}</t-radio-button>
            <t-radio-button value="dark">{{ t("app.themeDark") }}</t-radio-button>
          </t-radio-group>
        </div>
      </div>
    </template>
  </t-popup>
</template>

<style scoped>
.settings-trigger {
  color: var(--studio-muted);
}

.settings-panel {
  min-width: 220px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--studio-muted);
  letter-spacing: 0.02em;
}
</style>
