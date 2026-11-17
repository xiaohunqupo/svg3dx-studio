/**
 * Collect CSS custom-property sources visible to a geometry node,
 * grouped by style origin, with cascade override marking.
 */

import {
  extractClassRules,
  extractRootProps,
  normalizePropName,
} from "@/utils/styleClasses";
import { findOpenTagAtPath, parseTreePath } from "@/utils/nodeXmlEdit";
import { bareParamName } from "@/utils/exprAttr";

export type ParamListItem = {
  /** Display / bare name without `--`. */
  bare: string;
  /** Stored dashed-ident (`--D`). */
  dashed: string;
  value: string;
  /** True when a nearer source also defines this name. */
  overridden: boolean;
};

export type ParamSourceGroup = {
  /** Stable id: `:root` | `.class` | `inline:path`. */
  id: string;
  label: string;
  items: ParamListItem[];
};

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name.replace(/[:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

function parseInlineCustomProps(styleAttr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[A-Za-z_][\w-]*)\s*:\s*([^;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(styleAttr))) {
    out[normalizePropName(m[1]!)] = m[2]!.trim();
  }
  return out;
}

/** Paths from self up to defs group root (inclusive). */
export function ancestorPathsInclusive(path: string): string[] {
  const locator = parseTreePath(path);
  if (!locator || locator.kind !== "group") return path ? [path] : [];
  const out: string[] = [];
  for (let n = locator.indices.length; n >= 0; n--) {
    const indices = locator.indices.slice(0, n);
    out.push(
      indices.length
        ? `defs:${locator.groupId}.${indices.join(".")}`
        : `defs:${locator.groupId}`
    );
  }
  return out;
}

type RawGroup = {
  id: string;
  label: string;
  props: Record<string, string>;
};

/**
 * Style sources from outer → inner (:root → ancestor classes → inline).
 * Later groups win in the cascade; earlier duplicates are marked overridden.
 */
export function collectParamSourceGroups(
  content: string,
  path: string
): ParamSourceGroup[] {
  const raw: RawGroup[] = [];
  const rootProps = extractRootProps(content);
  if (Object.keys(rootProps).length) {
    raw.push({ id: ":root", label: ":root", props: rootProps });
  }

  const classRules = extractClassRules(content);
  const seenClass = new Set<string>();
  // Ancestors outer→inner: reverse self→root list.
  const chain = ancestorPathsInclusive(path).slice().reverse();
  for (const p of chain) {
    const open = findOpenTagAtPath(content, p);
    if (!open) continue;
    const classAttr = attrOf(open.attrs, "class");
    if (classAttr) {
      for (const cls of classAttr.split(/\s+/).filter(Boolean)) {
        if (seenClass.has(cls)) continue;
        seenClass.add(cls);
        const props = classRules[cls];
        if (props && Object.keys(props).length) {
          raw.push({ id: `.${cls}`, label: `.${cls}`, props });
        }
      }
    }
  }

  // Element inline style (nearest).
  const self = findOpenTagAtPath(content, path);
  if (self) {
    const style = attrOf(self.attrs, "style");
    if (style) {
      const props = parseInlineCustomProps(style);
      if (Object.keys(props).length) {
        raw.push({
          id: `inline:${path}`,
          label: "style",
          props,
        });
      }
    }
  }

  // Mark overrides: nearer (later in raw) wins.
  const won = new Set<string>();
  const marked: ParamSourceGroup[] = new Array(raw.length);
  for (let i = raw.length - 1; i >= 0; i--) {
    const g = raw[i]!;
    const items: ParamListItem[] = [];
    for (const [dashedRaw, value] of Object.entries(g.props)) {
      const dashed = normalizePropName(dashedRaw);
      if (!dashed.startsWith("--")) continue;
      const bare = bareParamName(dashed);
      const overridden = won.has(bare);
      if (!overridden) won.add(bare);
      items.push({ bare, dashed, value, overridden });
    }
    items.sort((a, b) => a.bare.localeCompare(b.bare));
    marked[i] = { id: g.id, label: g.label, items };
  }

  // Outer → inner order; drop empty groups.
  return marked.filter((g) => g.items.length > 0);
}

/** Bare names that are selectable (not overridden). */
export function effectiveBareParamNames(
  groups: ParamSourceGroup[]
): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    for (const it of g.items) {
      if (!it.overridden) out.add(it.bare);
    }
  }
  return out;
}
