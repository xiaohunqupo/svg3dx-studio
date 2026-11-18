<script setup lang="ts">
import { LogoGithubIcon } from "tdesign-icons-vue-next";
import type { DropdownOption } from "tdesign-vue-next";
import { computed, h } from "vue";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const REPOS = [
  {
    value: "svg3dx",
    content: "svg3dx",
    url: "https://github.com/xiaohunqupo/svg3dx",
  },
  {
    value: "svg3dx-core",
    content: "svg3dx-core",
    url: "https://github.com/xiaohunqupo/svg3dx-core",
  },
  {
    value: "svg3dx-studio",
    content: "svg3dx-studio",
    url: "https://github.com/xiaohunqupo/svg3dx-studio",
  },
  {
    value: "svg3dx-viewer",
    content: "svg3dx-viewer",
    url: "https://github.com/xiaohunqupo/svg3dx-viewer",
  },
] as const;

const options = computed<DropdownOption[]>(() =>
  REPOS.map((repo) => ({
    value: repo.value,
    content: repo.content,
    prefixIcon: () => h(LogoGithubIcon),
  }))
);

function onClick(dropdownItem: DropdownOption): void {
  const repo = REPOS.find((r) => r.value === dropdownItem.value);
  if (repo) window.open(repo.url, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <t-dropdown
    :options="options"
    trigger="click"
    placement="bottom-right"
    :max-column-width="200"
    :min-column-width="160"
    @click="onClick"
  >
    <t-button
      class="repos-trigger"
      variant="text"
      shape="square"
      :title="t('app.repos')"
      :aria-label="t('app.repos')"
    >
      <template #icon><LogoGithubIcon /></template>
    </t-button>
  </t-dropdown>
</template>

<style scoped>
.repos-trigger {
  color: var(--td-text-color-secondary);
}
</style>
