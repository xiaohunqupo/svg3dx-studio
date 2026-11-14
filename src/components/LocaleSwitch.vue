<script setup lang="ts">
import { useI18n, type Locale } from "@/i18n";

const { locale, setLocale, t } = useI18n();

const options = [
  { content: "中文", value: "zh" },
  { content: "English", value: "en" },
];

function onPick(item: { value?: string | number | object }): void {
  const v = item?.value;
  if (v === "zh" || v === "en") setLocale(v as Locale);
}
</script>

<template>
  <t-dropdown :options="options" @click="onPick">
    <t-button size="small" variant="text">
      {{ locale === "zh" ? t("app.langZh") : t("app.langEn") }}
    </t-button>
  </t-dropdown>
</template>
