<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "@/theme";
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
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    // indentWithTab is opt-in in CM6 (not in defaultKeymap).
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
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

function setDoc(text: string): void {
  if (!view) return;
  const normalized = normalizeXmlNewlines(text);
  const cur = view.state.doc.toString();
  if (cur === normalized) return;
  applyingExternal = true;
  suppressPathEmit = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: normalized },
    effects: setRevealEffect.of(null),
  });
  applyingExternal = false;
  suppressPathEmit = false;
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
    <div v-if="heading" class="panel-head">{{ heading }}</div>
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
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--td-text-color-secondary);
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--td-component-border);
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
