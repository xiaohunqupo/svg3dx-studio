<template>
  <div class="browse-skeleton" aria-busy="true" aria-live="polite">
    <header class="topbar">
      <t-skeleton animation="gradient" :row-col="[{ width: '120px', height: '18px' }]" />
      <div class="right">
        <t-skeleton animation="gradient" :row-col="[{ width: '28px', height: '28px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '28px', height: '28px' }]" />
      </div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <t-skeleton
          animation="gradient"
          :row-col="[
            { width: '40%', height: '14px' },
            { width: '100%', height: '44px' },
            { width: '100%', height: '44px' },
            { width: '100%', height: '44px' },
            { width: '100%', height: '44px' },
            { width: '100%', height: '44px' },
          ]"
        />
      </aside>
      <main class="viewport">
        <t-skeleton
          animation="gradient"
          :row-col="[{ width: '100%', height: '100%', type: 'rect' }]"
        />
      </main>
    </div>
  </div>
</template>

<style scoped>
.browse-skeleton {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.topbar {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}

.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: auto;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr;
  min-height: 0;
}

.sidebar {
  padding: 14px 12px;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
  overflow: hidden;
}

.viewport {
  min-height: 0;
  padding: 16px;
  background: var(--td-bg-color-page);
}

.viewport :deep(.t-skeleton__row),
.viewport :deep(.t-skeleton__col) {
  height: 100% !important;
}

.viewport :deep(.t-skeleton) {
  height: 100%;
}
</style>
