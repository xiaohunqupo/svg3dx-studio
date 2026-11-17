<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import {
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
} from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { MoreIcon } from "tdesign-icons-vue-next";
import { MessagePlugin, type DropdownOption } from "tdesign-vue-next";
import { useTheme } from "@/theme";
import { useI18n } from "@/i18n";
import { formatXml, type FormatXmlMode } from "@/utils/formatXml";
import {
  findRangeForTreePath,
  findTreePathAtOffset,
  normalizeXmlNewlines,
  type TextRange,
} from "@/utils/nodeXmlEdit";

const props = defineProps<{
  modelValue: string;
  /** Panel header label (already translated). */
  heading?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  /** Deepest tree path under the caret (null when outside known nodes). */
  cursorPath: [path: string | null];
}>();

const { t } = useI18n();

const moreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.formatCode"),
    value: "format",
    children: [
      { content: t("app.formatCodeAuto"), value: "format-auto" },
      { content: t("app.formatCodeCompact"), value: "format-compact" },
    ],
  },
]);

const hostEl = ref<HTMLElement | null>(null);
const { colorScheme } = useTheme();

let view: EditorView | null = null;
let applyingExternal = false;
/** Skip caret→path while programmatically revealing from the tree. */
let suppressPathEmit = false;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let pathTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmittedPath: string | null | undefined = undefined;

const setRevealEffect = StateEffect.define<TextRange[] | null>();

const revealField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setRevealEffect)) {
        if (!e.value?.length) return Decoration.none;
        const marks = [];
        for (const r of e.value) {
          if (r.start < 0 || r.end <= r.start || r.end > tr.state.doc.length) {
            continue;
          }
          marks.push(
            Decoration.mark({ class: "cm-svg3dx-reveal" }).range(r.start, r.end)
          );
        }
        return marks.length ? Decoration.set(marks, true) : Decoration.none;
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const baseTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
  },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    lineHeight: "1.45",
  },
  ".cm-content": {
    padding: "8px 0",
  },
  ".cm-gutters": {
    border: "none",
  },
  ".cm-svg3dx-reveal": {
    backgroundColor: "color-mix(in srgb, var(--td-brand-color) 28%, transparent)",
    outline: "1px solid var(--td-brand-color)",
    borderRadius: "2px",
  },
  ".cm-panels": {
    backgroundColor: "var(--td-bg-color-secondarycontainer)",
    color: "var(--td-text-color-primary)",
    borderColor: "var(--td-component-border)",
  },
  ".cm-panels .cm-button": {
    backgroundImage: "none",
    backgroundColor: "var(--td-bg-color-component)",
    color: "var(--td-text-color-primary)",
    border: "1px solid var(--td-component-border)",
    borderRadius: "3px",
  },
  ".cm-panels .cm-textfield": {
    backgroundColor: "var(--td-bg-color-container)",
    color: "var(--td-text-color-primary)",
    border: "1px solid var(--td-component-border)",
    borderRadius: "3px",
  },
  ".cm-panel.cm-search label": {
    color: "var(--td-text-color-secondary)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--td-bg-color-component)",
    border: "none",
    color: "var(--td-text-color-placeholder)",
  },
});

const lightTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--td-bg-color-container)",
      color: "var(--td-text-color-primary)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--td-bg-color-secondarycontainer)",
      color: "var(--td-text-color-placeholder)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--td-bg-color-container-hover)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--td-bg-color-container-hover)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--td-brand-color-light)",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--td-text-color-primary)",
    },
    ".cm-matchingBracket": {
      backgroundColor: "color-mix(in srgb, var(--td-brand-color) 22%, transparent)",
      outline: "1px solid var(--td-brand-color)",
    },
  },
  { dark: false }
);

function clearEmitTimer(): void {
  if (emitTimer != null) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
}

function clearPathTimer(): void {
  if (pathTimer != null) {
    clearTimeout(pathTimer);
    pathTimer = null;
  }
}

function scheduleEmit(doc: string): void {
  clearEmitTimer();
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emit("update:modelValue", doc);
  }, 300);
}

function schedulePathEmit(doc: string, offset: number): void {
  clearPathTimer();
  pathTimer = setTimeout(() => {
    pathTimer = null;
    if (suppressPathEmit) return;
    const path = findTreePathAtOffset(doc, offset);
    if (path === lastEmittedPath) return;
    lastEmittedPath = path;
    // Same full-element highlight as tree selection (includes nested children).
    const block = path ? findRangeForTreePath(doc, path) : null;
    view?.dispatch({
      effects: setRevealEffect.of(block ? [block] : null),
    });
    emit("cursorPath", path);
  }, 80);
}

function buildExtensions(scheme: "light" | "dark") {
  return [
    // Undo/redo, find/replace, fold, brackets, multi-cursor, etc.
    basicSetup,
    // Tab indent is opt-in (basicSetup intentionally omits it).
    keymap.of([indentWithTab]),
    indentUnit.of("  "),
    xml(),
    revealField,
    baseTheme,
    scheme === "dark" ? oneDark : lightTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !applyingExternal) {
        scheduleEmit(update.state.doc.toString());
      }
      if (
        !suppressPathEmit &&
        (update.selectionSet || (update.docChanged && !applyingExternal))
      ) {
        const head = update.state.selection.main.head;
        schedulePathEmit(update.state.doc.toString(), head);
      }
    }),
    EditorView.editable.of(true),
  ];
}

function createEditor(): void {
  const parent = hostEl.value;
  if (!parent) return;
  view?.destroy();
  lastEmittedPath = undefined;
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: normalizeXmlNewlines(props.modelValue),
      extensions: buildExtensions(colorScheme.value),
    }),
  });
}

function setDoc(
  text: string,
  options: { addToHistory?: boolean } = {}
): void {
  if (!view) return;
  const normalized = normalizeXmlNewlines(text);
  const cur = view.state.doc.toString();
  if (cur === normalized) return;
  const addToHistory = options.addToHistory === true;
  applyingExternal = !addToHistory;
  suppressPathEmit = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: normalized },
    // External sync must not create undo steps (would break Ctrl+Z).
    // User actions like Format should remain undoable.
    annotations: Transaction.addToHistory.of(addToHistory),
    effects: setRevealEffect.of(null),
  });
  applyingExternal = false;
  suppressPathEmit = false;
}

/** Approx. printable columns from the live editor width (auto format). */
function measureEditorPrintWidth(): number {
  if (!view) return 100;
  const charW = view.defaultCharacterWidth || 8;
  const gutter = view.dom.querySelector(".cm-gutters") as HTMLElement | null;
  const gutterW = gutter?.getBoundingClientRect().width ?? 0;
  const contentW = Math.max(0, view.scrollDOM.clientWidth - gutterW - 16);
  return Math.max(40, Math.floor(contentW / charW));
}

async function onFormatCode(mode: FormatXmlMode): Promise<void> {
  if (!view) return;
  const current = view.state.doc.toString();
  const result = await formatXml(current, {
    mode,
    printWidth: mode === "auto" ? measureEditorPrintWidth() : undefined,
  });
  if (!result.ok) {
    MessagePlugin.warning(t("app.formatCodeFailed"));
    return;
  }
  if (!result.changed) {
    MessagePlugin.info(t("app.formatCodeNoChange"));
    return;
  }
  clearEmitTimer();
  setDoc(result.content, { addToHistory: true });
  lastEmittedPath = undefined;
  emit("update:modelValue", result.content);
  MessagePlugin.success(t("app.formatCodeDone"));
}

function onMoreClick(item: DropdownOption): void {
  if (item.value === "format-auto") void onFormatCode("auto");
  else if (item.value === "format-compact") void onFormatCode("compact");
}

function applyRevealRanges(
  ranges: TextRange[],
  options: { scroll?: boolean; select?: boolean } = {}
): void {
  if (!view) return;
  const { scroll = true, select = false } = options;
  if (!ranges.length) {
    view.dispatch({ effects: setRevealEffect.of(null) });
    return;
  }
  const len = view.state.doc.length;
  const clamped = ranges
    .map((r) => ({
      start: Math.max(0, Math.min(r.start, len)),
      end: Math.max(0, Math.min(r.end, len)),
    }))
    .filter((r) => r.end > r.start);
  if (!clamped.length) {
    view.dispatch({ effects: setRevealEffect.of(null) });
    return;
  }
  const first = clamped[0]!;
  suppressPathEmit = true;
  view.dispatch({
    effects: [
      setRevealEffect.of(clamped),
      ...(scroll
        ? [EditorView.scrollIntoView(first.start, { y: "center" })]
        : []),
    ],
    ...(select
      ? { selection: { anchor: first.start, head: clamped[clamped.length - 1]!.end } }
      : {}),
  });
  // Allow caret events again after CM finishes selection updates.
  requestAnimationFrame(() => {
    suppressPathEmit = false;
  });
}

/**
 * Tree / viewport driven reveal: highlight the full element block and scroll.
 * Does not move the caret (avoids fighting source→tree sync).
 */
function revealPath(path: string | null | undefined): void {
  if (!view) return;
  if (!path) {
    applyRevealRanges([]);
    lastEmittedPath = null;
    return;
  }
  const doc = view.state.doc.toString();
  const block = findRangeForTreePath(doc, path);
  applyRevealRanges(block ? [block] : [], { scroll: true, select: false });
  lastEmittedPath = path;
}

watch(
  () => props.modelValue,
  (next) => {
    if (!view) return;
    if (view.state.doc.toString() === normalizeXmlNewlines(next)) return;
    clearEmitTimer();
    setDoc(next);
  }
);

watch(colorScheme, () => {
  createEditor();
});

onMounted(() => {
  createEditor();
});

onBeforeUnmount(() => {
  clearEmitTimer();
  clearPathTimer();
  view?.destroy();
  view = null;
});

defineExpose({ revealPath });
</script>

<template>
  <aside class="source-editor-panel">
    <div class="panel-head">
      <span class="panel-head-title">{{ heading || t("app.sourceCode") }}</span>
      <t-dropdown
        :options="moreOptions"
        :max-column-width="200"
        :min-column-width="160"
        trigger="click"
        placement="bottom-right"
        @click="onMoreClick"
      >
        <t-button
          class="panel-more"
          theme="default"
          shape="square"
          variant="text"
          size="small"
          :title="t('app.moreActions')"
          :aria-label="t('app.moreActions')"
        >
          <template #icon><MoreIcon /></template>
        </t-button>
      </t-dropdown>
    </div>
    <div ref="hostEl" class="editor-host" />
  </aside>
</template>

<style scoped>
.source-editor-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-border);
}

.panel-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--td-component-border);
}

.panel-head-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--td-text-color-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-more {
  flex-shrink: 0;
  color: var(--td-text-color-secondary);
}

.editor-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editor-host :deep(.cm-editor) {
  height: 100%;
}

.editor-host :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
