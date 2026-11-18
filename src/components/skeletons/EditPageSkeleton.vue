<template>
  <div class="edit-skeleton" aria-busy="true" aria-live="polite">
    <header class="topbar">
      <div class="brand">
        <t-skeleton animation="gradient" :row-col="[{ width: '28px', height: '28px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '110px', height: '18px' }]" />
      </div>
      <div class="app-menus">
        <t-skeleton animation="gradient" :row-col="[{ width: '40px', height: '20px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '40px', height: '20px' }]" />
      </div>
      <div class="right">
        <t-skeleton animation="gradient" :row-col="[{ width: '28px', height: '28px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '28px', height: '28px' }]" />
      </div>
    </header>

    <div class="workspace">
      <aside class="tree">
        <t-skeleton
          animation="gradient"
          :row-col="[
            { width: '70%', height: '16px' },
            1,
            1,
            1,
            1,
            1,
            1,
            1,
            1,
          ]"
        />
      </aside>
      <main class="viewport">
        <t-skeleton
          animation="gradient"
          :row-col="[{ width: '100%', height: '100%', type: 'rect' }]"
        />
      </main>
      <aside class="inspector">
        <t-skeleton
          animation="gradient"
          :row-col="[
            { width: '40%', height: '12px' },
            { width: '100%', height: '28px' },
            { width: '100%', height: '28px' },
            { width: '100%', height: '28px' },
            { width: '100%', height: '28px' },
            { width: '70%', height: '28px' },
          ]"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.edit-skeleton {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.topbar {
  position: relative;
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-border);
}

.brand,
.app-menus,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.right {
  margin-left: auto;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 260px 1fr 280px;
  min-height: 0;
}

.tree,
.inspector {
  min-height: 0;
  padding: 12px;
  background: var(--td-bg-color-container);
  overflow: hidden;
}

.tree {
  border-right: 1px solid var(--td-component-border);
}

.inspector {
  border-left: 1px solid var(--td-component-border);
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

@media (max-width: 960px) {
  .workspace {
    grid-template-columns: 220px 1fr;
  }
  .inspector {
    display: none;
  }
}
</style>
