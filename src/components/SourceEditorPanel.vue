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
import { indentUnit, syntaxHighlighting } from "@codemirror/language";
import { xml } from "@codemirror/lang-xml";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { MoreIcon } from "tdesign-icons-vue-next";
import { MessagePlugin, type DropdownOption } from "tdesign-vue-next";
import SourceSkeleton from "@/components/skeletons/SourceSkeleton.vue";
import { useTheme } from "@/theme";
import { useI18n } from "@/i18n";
import {
  formatXml,
  type FormatXmlMode,
} from "@/utils/formatXml";
import {
  findRangeForTreePath,
  findTreePathAtOffset,
  minimalStringChange,
  normalizeXmlNewlines,
  type TextRange,
} from "@/utils/nodeXmlEdit";

const props = defineProps<{
  modelValue: string;
  /** Panel header label (already translated). */
  heading?: string;
  /** Active format style (mutually exclusive). */
  formatMode?: FormatXmlMode;
  /** Show code-line skeleton while the document is evaluating. */
  loading?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:formatMode": [mode: FormatXmlMode];
  /** Deepest tree path under the caret (null when outside known nodes). */
  cursorPath: [path: string | null];
}>();

const { t } = useI18n();

const activeFormatMode = computed<FormatXmlMode>(
  () => props.formatMode ?? "pretty"
);

const moreOptions = computed<DropdownOption[]>(() => [
  {
    content: t("app.formatCode"),
    value: "format",
    children: [
      {
        content: t("app.formatCodePretty"),
        value: "format-pretty",
        active: activeFormatMode.value === "pretty",
      },
      {
        content: t("app.formatCodeCompact"),
        value: "format-compact",
        active: activeFormatMode.value === "compact",
      },
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

/** Chrome colors follow TDesign tokens so light/dark match the rest of Studio. */
function chromeTheme(dark: boolean) {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        fontSize: "13px",
        backgroundColor: "var(--td-bg-color-container)",
        color: "var(--td-text-color-primary)",
      },
      ".cm-scroller": {
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        lineHeight: "1.45",
        backgroundColor: "var(--td-bg-color-container)",
      },
      ".cm-content": {
        padding: "8px 0",
        caretColor: "var(--td-text-color-primary)",
      },
      ".cm-gutters": {
        border: "none",
        backgroundColor: "var(--td-bg-color-secondarycontainer)",
        color: "var(--td-text-color-placeholder)",
      },
      // Active line / gutter only while focused — otherwise they linger on the
      // old caret line after tree selection and look like a second tag mark.
      "&.cm-focused .cm-activeLineGutter": {
        backgroundColor: "var(--td-bg-color-container-hover)",
      },
      "&.cm-focused .cm-activeLine": {
        backgroundColor: "var(--td-bg-color-container-hover)",
      },
      "&:not(.cm-focused) .cm-activeLine, &:not(.cm-focused) .cm-activeLineGutter":
        {
          backgroundColor: "transparent",
        },
      "&.cm-focused .cm-selectionBackground, &.cm-focused ::selection": {
        backgroundColor: dark
          ? "color-mix(in srgb, var(--td-brand-color) 38%, transparent)"
          : "var(--td-brand-color-light)",
      },
      "&:not(.cm-focused) .cm-selectionBackground": {
        backgroundColor: "transparent",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--td-text-color-primary)",
      },
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor:
          "color-mix(in srgb, var(--td-brand-color) 22%, transparent)",
        outline: "1px solid var(--td-brand-color)",
      },
      "&:not(.cm-focused) .cm-matchingBracket": {
        backgroundColor: "transparent",
        outline: "none",
      },
      ".cm-svg3dx-reveal": {
        backgroundColor:
          "color-mix(in srgb, var(--td-brand-color) 28%, transparent)",
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
    },
    { dark }
  );
}

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

/**
 * Caret → tree only. Reveal marks are owned exclusively by `revealPath`
 * (driven from EditView `selected`), so caret and tree never paint two marks.
 */
function schedulePathEmit(doc: string, offset: number): void {
  clearPathTimer();
  if (suppressPathEmit) return;
  pathTimer = setTimeout(() => {
    pathTimer = null;
    if (suppressPathEmit) return;
    const path = findTreePathAtOffset(doc, offset);
    if (path === lastEmittedPath) return;
    lastEmittedPath = path;
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
    chromeTheme(scheme === "dark"),
    // Keep One Dark token colors for syntax only — chrome uses TDesign tokens.
    ...(scheme === "dark"
      ? [syntaxHighlighting(oneDarkHighlightStyle)]
      : []),
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
  const change = minimalStringChange(cur, normalized);
  if (!change) return;
  const addToHistory = options.addToHistory === true;
  applyingExternal = !addToHistory;
  suppressPathEmit = true;
  const insertLen = change.insert.length;
  const head = change.from + insertLen;
  // Local replace (shared prefix/suffix). For external sync, park the caret
  // on the changed span so undo/redo does not leave a mapped ghost position.
  view.dispatch({
    changes: change,
    selection: addToHistory
      ? undefined
      : { anchor: change.from, head: Math.max(change.from, head) },
    // External sync must not create undo steps (would break Ctrl+Z).
    // User actions like Format should remain undoable.
    annotations: Transaction.addToHistory.of(addToHistory),
    effects: addToHistory
      ? undefined
      : EditorView.scrollIntoView(change.from, { y: "nearest" }),
  });
  applyingExternal = false;
  suppressPathEmit = false;
}

function focusEditor(): void {
  view?.focus();
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

async function applyFormat(text: string, mode = activeFormatMode.value): Promise<string> {
  const result = await formatXml(text, {
    mode,
    printWidth: mode === "pretty" ? measureEditorPrintWidth() : undefined,
  });
  return result.ok ? result.content : text;
}

async function onFormatModePick(mode: FormatXmlMode): Promise<void> {
  emit("update:formatMode", mode);
  if (!view) return;
  const current = view.state.doc.toString();
  const result = await formatXml(current, {
    mode,
    printWidth: mode === "pretty" ? measureEditorPrintWidth() : undefined,
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
  if (item.value === "format-pretty") void onFormatModePick("pretty");
  else if (item.value === "format-compact") void onFormatModePick("compact");
}

function applyRevealRanges(
  ranges: TextRange[],
  options: { scroll?: boolean } = {}
): void {
  if (!view) return;
  const { scroll = true } = options;
  clearPathTimer();
  suppressPathEmit = true;
  if (!ranges.length) {
    view.dispatch({ effects: setRevealEffect.of(null) });
    requestAnimationFrame(() => {
      suppressPathEmit = false;
    });
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
    requestAnimationFrame(() => {
      suppressPathEmit = false;
    });
    return;
  }
  const first = clamped[0]!;
  view.dispatch({
    effects: [
      setRevealEffect.of(clamped),
      ...(scroll
        ? [EditorView.scrollIntoView(first.start, { y: "center" })]
        : []),
    ],
  });
  requestAnimationFrame(() => {
    suppressPathEmit = false;
  });
}

/**
 * Sole owner of `.cm-svg3dx-reveal` marks — call from EditView whenever
 * `selected` changes (tree, viewport, or caret→path).
 */
function revealPath(
  path: string | null | undefined,
  options: { scroll?: boolean } = {}
): void {
  if (!view) return;
  clearPathTimer();
  const scroll = options.scroll !== false;
  if (!path) {
    applyRevealRanges([], { scroll: false });
    lastEmittedPath = null;
    return;
  }
  const doc = view.state.doc.toString();
  const block = findRangeForTreePath(doc, path);
  applyRevealRanges(block ? [block] : [], { scroll });
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

defineExpose({
  revealPath,
  applyFormat,
  measureEditorPrintWidth,
  focus: focusEditor,
});
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
    <div class="editor-body">
      <SourceSkeleton v-if="loading" />
      <div ref="hostEl" class="editor-host" />
    </div>
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

.editor-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
