<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  ChevronLeftIcon,
  DownloadIcon,
  SaveIcon,
} from "tdesign-icons-vue-next";
import { MessagePlugin } from "tdesign-vue-next";
import type { EvaluationResult } from "svg3dx-viewer";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import NodeInspectorPanel from "@/components/NodeInspectorPanel.vue";
import NodeTreePanel, {
  type TreeSelectPayload,
} from "@/components/NodeTreePanel.vue";
import ViewerHost from "@/components/ViewerHost.vue";
import { useI18n } from "@/i18n";
import { useFilesStore } from "@/stores/files";
import { downloadText } from "@/utils/storage";
import {
  insertEmptyGroup,
  insertPrimitive,
  PRIMITIVE_MENU,
} from "@/utils/svgEdit";
import { setClassRuleProps } from "@/utils/styleClasses";
import type { GeometryKind } from "@/types/file";

const props = defineProps<{ id: string }>();

const store = useFilesStore();
const router = useRouter();
const route = useRoute();
const { t } = useI18n();

const result = ref<EvaluationResult | null>(null);
const selected = ref<TreeSelectPayload | null>(null);
const status = ref("");
const draftContent = ref("");
const treePanel = ref<{ appendDefsGroup: (id: string) => void } | null>(null);

const file = computed(() => store.getById(props.id) ?? null);
const dirty = computed(() => file.value?.dirty || draftContent.value !== (file.value?.content ?? ""));

onMounted(async () => {
  if (!store.ready) await store.hydrate();
  syncFromStore();
});

watch(
  () => props.id,
  () => syncFromStore()
);

watch(
  () => route.params.id,
  () => syncFromStore()
);

function syncFromStore(): void {
  const f = store.getById(props.id);
  if (!f) {
    MessagePlugin.warning(t("app.fileMissing"));
    router.replace({ name: "browse" });
    return;
  }
  store.select(f.id);
  draftContent.value = f.content;
  selected.value = null;
  result.value = null;
}

function goBrowse(): void {
  router.push({ name: "browse" });
}

async function onAddPrimitive(kind: GeometryKind): Promise<void> {
  if (!file.value) return;
  const next = insertPrimitive(draftContent.value, kind);
  draftContent.value = next;
  await store.updateContent(file.value.id, next, true);
  status.value = `${t("app.addedPrimitive")} ${kind}`;
  MessagePlugin.success(`${t("app.addedPrimitive")} ${kind}`);
}

async function onAddGroup(): Promise<void> {
  if (!file.value) return;
  const { content, id } = insertEmptyGroup(draftContent.value);
  // Append tree node first (TDesign appendTo), then update document —
  // content watch will see a single-append and skip full rebuild.
  treePanel.value?.appendDefsGroup(id);
  draftContent.value = content;
  await store.updateContent(file.value.id, content, true);
  status.value = `${t("app.addedGroup")} ${id}`;
  MessagePlugin.success(`${t("app.addedGroup")} ${id}`);
}

function onPrimitiveMenu(item: { value?: string | number | object }): void {
  const v = item?.value;
  if (v === undefined || (typeof v !== "string" && typeof v !== "number")) return;
  void onAddPrimitive(String(v) as GeometryKind);
}

async function onSave(): Promise<void> {
  if (!file.value) return;
  await store.updateContent(file.value.id, draftContent.value, false);
  await store.persist(file.value.id);
  MessagePlugin.success(t("app.saved"));
  status.value = t("app.saved");
}

function onDownload(): void {
  if (!file.value) return;
  downloadText(file.value.name, draftContent.value);
  MessagePlugin.success(t("app.downloaded"));
}

function onSelect(payload: TreeSelectPayload): void {
  selected.value = payload;
}

async function onStyleParamsChange(propsMap: Record<string, string>): Promise<void> {
  const sel = selected.value;
  if (!sel || sel.kind !== "style" || !file.value) return;
  const className = sel.name.split(/\s+/).filter(Boolean)[0];
  if (!className) return;

  const next = setClassRuleProps(draftContent.value, className, propsMap);
  if (next === draftContent.value) {
    selected.value = { ...sel, props: propsMap };
    return;
  }
  draftContent.value = next;
  selected.value = { ...sel, props: propsMap };
  await store.updateContent(file.value.id, next, true);
  status.value = `${t("app.updatedStyle")} .${className}`;
}
</script>

<template>
  <div v-if="file" class="edit-page">
    <header class="topbar">
      <div class="left">
        <t-button variant="text" @click="goBrowse">
          <template #icon><ChevronLeftIcon /></template>
          {{ t("app.backBrowse") }}
        </t-button>
        <div class="file-name">
          {{ file.name }}
          <span v-if="dirty" class="dirty-tag">{{ t("app.unsaved") }}</span>
        </div>
      </div>

      <div class="menu">
        <t-dropdown
          :options="PRIMITIVE_MENU.map((p) => ({ content: p.label, value: p.kind }))"
          @click="onPrimitiveMenu"
        >
          <t-button theme="default" variant="outline">{{ t("app.addPrimitive") }}</t-button>
        </t-dropdown>
      </div>

      <div class="right">
        <LocaleSwitch />
        <span class="status">{{ status }}</span>
        <t-button variant="outline" @click="onDownload">
          <template #icon><DownloadIcon /></template>
          {{ t("app.export") }}
        </t-button>
        <t-button theme="primary" @click="onSave">
          <template #icon><SaveIcon /></template>
          {{ t("app.save") }}
        </t-button>
      </div>
    </header>

    <div class="workspace">
      <NodeTreePanel
        ref="treePanel"
        class="tree"
        :result="result"
        :content="draftContent"
        @select="onSelect"
        @add-group="onAddGroup"
      />

      <main class="viewport">
        <ViewerHost
          :key="file.id"
          :content="draftContent"
          @result="(r) => (result = r)"
          @error="(m) => (status = m)"
        />
      </main>

      <aside class="inspector">
        <div class="panel-head">
          {{ selected?.kind === "style" ? t("app.styleParams") : t("app.nodeParams") }}
        </div>
        <NodeInspectorPanel
          :selected="selected"
          @style-params-change="onStyleParamsChange"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.edit-page {
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

.file-name {
  font-weight: 600;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty-tag {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: #e37318;
}

.status {
  font-size: 12px;
  color: var(--studio-muted);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
}

.viewport {
  min-height: 0;
  background: #dfe7ee;
}

.inspector {
  background: var(--studio-panel);
  border-left: 1px solid var(--studio-line);
  padding: 10px 12px;
  overflow: auto;
}

.panel-head {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--studio-muted);
  margin-bottom: 8px;
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
