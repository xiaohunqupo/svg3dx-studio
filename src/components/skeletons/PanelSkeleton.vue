<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** Approximate rows for list-like panels. */
    rows?: number;
  }>(),
  { rows: 6 }
);

const rowCol = computed(() => [
  { width: "36%", height: "12px" },
  ...Array.from({ length: props.rows }, () => ({
    width: "100%",
    height: "28px",
  })),
]);
</script>

<template>
  <div class="panel-skeleton" aria-busy="true">
    <t-skeleton animation="gradient" :row-col="rowCol" />
  </div>
</template>

<style scoped>
.panel-skeleton {
  padding: 4px 0;
}
</style>
