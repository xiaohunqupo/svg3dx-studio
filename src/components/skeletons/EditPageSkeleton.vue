<template>
  <div class="edit-skeleton" aria-busy="true" aria-live="polite">
    <header class="topbar">
      <div class="left">
        <t-skeleton animation="gradient" :row-col="[{ width: '88px', height: '28px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '160px', height: '16px' }]" />
      </div>
      <t-skeleton animation="gradient" :row-col="[{ width: '96px', height: '28px' }]" />
      <div class="right">
        <t-skeleton animation="gradient" :row-col="[{ width: '56px', height: '22px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '72px', height: '28px' }]" />
        <t-skeleton animation="gradient" :row-col="[{ width: '72px', height: '28px' }]" />
      </div>
    </header>

    <div class="workspace">
      <aside class="tree">
        <t-skeleton
          animation="gradient"
          :row-col="[
            { width: '30%', height: '14px' },
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
  height: 52px;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: var(--studio-panel);
  border-bottom: 1px solid var(--studio-line);
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.right {
  justify-content: flex-end;
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
  background: var(--studio-panel);
  overflow: hidden;
}

.tree {
  border-right: 1px solid var(--studio-line);
}

.inspector {
  border-left: 1px solid var(--studio-line);
}

.viewport {
  min-height: 0;
  padding: 16px;
  background: #dfe7ee;
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
