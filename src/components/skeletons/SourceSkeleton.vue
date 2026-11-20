<script setup lang="ts">
/** Code-line widths that read as an XML editor, not a form list. */
const rowCol = [
  { width: "42%", height: "12px" },
  { width: "78%", height: "12px" },
  { width: "64%", height: "12px" },
  { width: "88%", height: "12px" },
  { width: "55%", height: "12px" },
  { width: "72%", height: "12px" },
  { width: "48%", height: "12px" },
  { width: "81%", height: "12px" },
  { width: "60%", height: "12px" },
  { width: "70%", height: "12px" },
  { width: "52%", height: "12px" },
  { width: "85%", height: "12px" },
];
</script>

<template>
  <div class="source-skeleton" aria-busy="true">
    <t-skeleton animation="gradient" :row-col="rowCol" />
  </div>
</template>

<style scoped>
.source-skeleton {
  position: absolute;
  inset: 0;
  z-index: 2;
  padding: 12px 16px;
  overflow: hidden;
  box-sizing: border-box;
  background: var(--td-bg-color-container);
}

.source-skeleton :deep(.t-skeleton__row) {
  margin-bottom: 10px;
}
</style>
