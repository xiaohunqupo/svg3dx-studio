<template>
  <div class="viewport-skeleton" aria-busy="true">
    <t-skeleton
      animation="gradient"
      :row-col="[{ width: '100%', height: '100%', type: 'rect' }]"
    />
  </div>
</template>

<style scoped>
.viewport-skeleton {
  position: absolute;
  inset: 0;
  z-index: 2;
  padding: 16px;
  background: var(--studio-viewport);
  box-sizing: border-box;
}

.viewport-skeleton :deep(.t-skeleton) {
  height: 100%;
}

.viewport-skeleton :deep(.t-skeleton__row),
.viewport-skeleton :deep(.t-skeleton__col) {
  height: 100% !important;
}
</style>
