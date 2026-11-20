/**
 * Hierarchy navigation — same meaning for tree and viewer; different gestures.
 *
 * ## State
 * - `scopePath` — current **level** (kept on empty click)
 * - `selection` — highlighted node at that level
 * - `locationChain` — breadcrumb path for **how we got here**
 *   - Model entry: `model:id` → `model:id.N` → `defs:group` → …
 *   - Defs entry: `defs:group` → …
 *   Never replace a model-entry chain with a bare defs ancestor list when
 *   picking a section/child under that entry — merge instead.
 *
 * ## How level is set
 * - Viewer double-click → `enterLevel(child)` (formal; selection cleared → tip `?`)
 * - Tree / viewport pick → `levelAfterSelect(path)` (keep containing scope, else parent)
 * - Model use pick → level is the use path (needed so referenced geometry stays solid)
 * - Empty click when `selection === scopePath` → clear that soft level too
 *   (otherwise `model/引用` → empty → `model/引用/?`)
 *
 * ## Gestures
 * | Gesture            | Effect |
 * |--------------------|--------|
 * | Click entity       | Select at current level |
 * | Click empty        | Clear selection; keep formal `scopePath` |
 * | Double-click       | Enter child |
 * | Right double-click | Up one level |
 * | Escape             | Leave all levels |
 */

import {
  listSectionChildPaths,
  parentTreePath,
  sectionAncestorPath,
} from "./sectionProxy";
import type { DocStep } from "./documentChain";
import { ancestorChain } from "./documentChain";

export type EmptyClickAction =
  | { type: "noop" }
  | { type: "clear-selection" };

/** Empty viewport click: clear entity pick only; never change `scopePath`. */
export function emptyClickAction(selection: string | null): EmptyClickAction {
  if (!selection) return { type: "noop" };
  return { type: "clear-selection" };
}

/**
 * Level to retain after selecting `path`.
 *
 * - If `path` is a **direct child** of the current `scopePath`, keep that level
 *   (same as after double-click enter, then picking a child).
 * - Otherwise level is the parent of `path` (or `path` itself at a branch root).
 *
 * Do **not** keep an ancestor scope for arbitrary descendants — that left
 * `scopePath=main` while selecting a section, so sibling revolves stayed visible.
 *
 * `model:…` (including uses): keep the selected path. Referenced geometry is
 * tagged with defs ids, so isolation must use the use path (`model:id.N`).
 * That soft level is cleared on empty click when `selection === scopePath`.
 *
 * Under a model use, selecting the href root (`defs:main`) must **keep** the
 * use as level — `defs:main` is not a path-parent child of `model:id.N`, and
 * promoting scope to `main` made empty-click jump out to `model/?`.
 */
export function levelAfterSelect(
  path: string,
  scopePath: string | null,
  _pathInScope?: (p: string) => boolean
): string {
  if (scopePath && parentTreePath(path) === scopePath) return scopePath;
  if (path.startsWith("model:")) return path;
  if (
    scopePath &&
    scopePath.startsWith("model:") &&
    scopePath.includes(".") &&
    path.startsWith("defs:")
  ) {
    const rest = path.slice("defs:".length);
    // Use target root group — stay on the use.
    if (!rest.includes(".")) return scopePath;
    // Deeper under the definition — isolate at the defs parent.
    const defsParent = parentTreePath(path);
    if (defsParent) return defsParent;
    return scopePath;
  }
  const parent = parentTreePath(path);
  if (parent) return parent;
  return path;
}

/**
 * Build locationChain for `path`.
 * If `prior` is a model-entry chain and `path` is under defs, keep the model/use
 * prefix and append defs ancestors — do not jump to a bare defs-only chain.
 * Tree picks that leave the model branch pass `prior = []` / pure defs hint.
 */
export function mergeLocationChain(
  path: string,
  prior: readonly DocStep[],
  hint: readonly DocStep[]
): DocStep[] {
  if (!path.startsWith("defs:")) {
    if (hint.length && hint.some((s) => s.path === path)) {
      const at = hint.findIndex((s) => s.path === path);
      return hint.slice(0, at + 1);
    }
    return hint.length ? [...hint] : ancestorChain(path);
  }

  const modelPrefix: DocStep[] = [];
  for (const s of prior) {
    if (!s.path.startsWith("model:")) break;
    modelPrefix.push(s);
  }

  const anc = ancestorChain(path);
  if (!modelPrefix.length) {
    // No model entry — defs-only branch (tree under 定义集, or fresh).
    if (hint.length && hint[0]?.path.startsWith("defs:")) {
      const at = hint.findIndex((s) => s.path === path);
      return at >= 0 ? hint.slice(0, at + 1) : anc;
    }
    return anc;
  }

  // Model-entry context: prefix + defs ancestors to path.
  const out = [...modelPrefix];
  for (const s of anc) {
    if (!out.some((x) => x.path === s.path)) out.push(s);
  }
  return out;
}

/**
 * Section paths that need editor overlays for the current level / selection.
 */
export function sectionPathsToShow(
  document: string,
  scopePath: string | null,
  selection: string | null,
  isolationLevel: string | null
): string[] {
  if (!document) return [];
  const out = new Set<string>();
  const level = scopePath ?? isolationLevel;

  if (level) {
    for (const p of listSectionChildPaths(document, level)) out.add(p);
    const section = sectionAncestorPath(document, level);
    if (section) out.add(section);
  }

  if (selection) {
    const section = sectionAncestorPath(document, selection);
    if (section) out.add(section);
  }

  return [...out];
}
