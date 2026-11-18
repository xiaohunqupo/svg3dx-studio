/** CSS class rule map: className → property → raw value string. */
export type ClassRuleMap = Record<string, Record<string, string>>;

export interface ClassedGroup {
  /** Element `id` when present; otherwise a stable synthetic key. */
  id: string;
  classes: string[];
}

function attr(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

function parseRuleBody(body: string): Record<string, string> {
  const props: Record<string, string> = {};
  const propRe = /(--[A-Za-z_][\w-]*|[A-Za-z_][\w-]*)\s*:\s*([^;]+)/g;
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(body))) {
    props[pm[1].trim()] = pm[2].trim();
  }
  return props;
}

/** Parse `.class { ... }` rules from `<style>` blocks. */
export function extractClassRules(svgText: string): ClassRuleMap {
  const out: ClassRuleMap = {};
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(svgText))) {
    const css = sm[1];
    const ruleRe = /\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = ruleRe.exec(css))) {
      const className = rm[1];
      const body = rm[2];
      out[className] = {
        ...(out[className] ?? {}),
        ...parseRuleBody(body),
      };
    }
  }
  return out;
}

/**
 * Parse `:root { ... }` custom properties from `<style>` blocks
 * (external / global params).
 */
export function extractRootProps(svgText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(svgText))) {
    const css = sm[1];
    const ruleRe = /:root\s*\{([^}]*)\}/gi;
    let rm: RegExpExecArray | null;
    while ((rm = ruleRe.exec(css))) {
      Object.assign(out, parseRuleBody(rm[1] ?? ""));
    }
  }
  return out;
}

export interface DefsGroup {
  id: string;
  classes: string[];
}

/**
 * Top-level `<g id>` entries inside `<defs>` (document order).
 * Nested groups are ignored so the defs tree mirrors the SVG structure.
 */
export function extractDefsGroups(svgText: string): DefsGroup[] {
  const block = /<defs\b[^>]*>([\s\S]*?)<\/defs>/i.exec(svgText);
  if (!block) return [];
  const body = block[1];
  const out: DefsGroup[] = [];
  const seen = new Set<string>();
  let depth = 0;
  const tokenRe = /<\/?g\b([^>]*?)\/?>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(body))) {
    const full = tm[0];
    const attrs = tm[1] ?? "";
    const selfClosing = /\/\s*>$/.test(full);
    const isClose = /^<\//.test(full);
    if (isClose) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) {
      const id = attr(attrs, "id");
      if (id && !seen.has(id)) {
        seen.add(id);
        const classAttr = attr(attrs, "class");
        out.push({
          id,
          classes: classAttr ? classAttr.split(/\s+/).filter(Boolean) : [],
        });
      }
    }
    if (!selfClosing) depth += 1;
  }
  return out;
}

/**
 * Groups (`<g>`) that set a `class` attribute — one entry per such group.
 * Document order; duplicate ids are skipped.
 */
export function extractClassedGroups(svgText: string): ClassedGroup[] {
  const out: ClassedGroup[] = [];
  const seen = new Set<string>();
  const tagRe = /<g\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  let anon = 0;
  while ((m = tagRe.exec(svgText))) {
    const attrs = m[1];
    const classAttr = attr(attrs, "class");
    if (!classAttr) continue;
    const classes = classAttr.split(/\s+/).filter(Boolean);
    if (!classes.length) continue;
    const id = attr(attrs, "id") ?? `__anon_g_${anon++}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, classes });
  }
  return out;
}

/** Merge property maps for one or more class names (later classes override). */
export function propsForClasses(
  rules: ClassRuleMap,
  classes: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of classes) {
    const rule = rules[c];
    if (!rule) continue;
    Object.assign(out, rule);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Ensure custom-property names use a `--` prefix; leave normal CSS props alone. */
export function normalizePropName(name: string): string {
  const t = name.trim();
  if (!t) return t;
  if (t.startsWith("--")) return t;
  // Studio params are CSS variables by convention.
  if (/^[A-Za-z_][\w-]*$/.test(t)) return `--${t}`;
  return t;
}

function formatRuleBody(props: Record<string, string>): string {
  const keys = Object.keys(props);
  if (!keys.length) return " ";
  return (
    "\n" +
    keys.map((k) => `      ${k}: ${props[k]};`).join("\n") +
    "\n    "
  );
}

function normalizePropMap(
  props: Record<string, string>
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const name = normalizePropName(k);
    if (!name) continue;
    const value = String(v).trim();
    // Empty values are not persisted — omit from the rule.
    if (!value) continue;
    normalized[name] = value;
  }
  return normalized;
}

function upsertStyleRule(
  svgText: string,
  ruleText: string,
  matchRe: RegExp
): string {
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/i;
  const m = styleRe.exec(svgText);
  if (m) {
    const css = m[1];
    const newCss = matchRe.test(css)
      ? css.replace(matchRe, ruleText)
      : `${css.replace(/\s*$/, "")}\n    ${ruleText}\n  `;
    const start = m.index;
    const end = start + m[0].length;
    const openEnd = m[0].indexOf(">") + 1;
    const closeStart = m[0].lastIndexOf("</style>");
    const open = m[0].slice(0, openEnd);
    const close = m[0].slice(closeStart);
    return svgText.slice(0, start) + open + newCss + close + svgText.slice(end);
  }

  const styleBlock = `  <style>\n    ${ruleText}\n  </style>\n`;
  if (/<svg\b[^>]*>/i.test(svgText)) {
    return svgText.replace(/<svg\b[^>]*>/i, (tag) => `${tag}\n${styleBlock}`);
  }
  return styleBlock + svgText;
}

/**
 * Replace (or insert) a single `.className { … }` rule inside the first `<style>` block.
 * Creates a `<style>` block when missing.
 */
export function setClassRuleProps(
  svgText: string,
  className: string,
  props: Record<string, string>
): string {
  const cls = className.trim().replace(/^\./, "");
  if (!cls) return svgText;
  const normalized = normalizePropMap(props);
  const ruleText = `.${cls} {${formatRuleBody(normalized)}}`;
  return upsertStyleRule(
    svgText,
    ruleText,
    new RegExp(`\\.${escapeRegExp(cls)}\\s*\\{[^}]*\\}`, "m")
  );
}

/**
 * Replace (or insert) the `:root { … }` rule (global / external params).
 */
export function setRootRuleProps(
  svgText: string,
  props: Record<string, string>
): string {
  const normalized = normalizePropMap(props);
  const ruleText = `:root {${formatRuleBody(normalized)}}`;
  return upsertStyleRule(svgText, ruleText, /:root\s*\{[^}]*\}/m);
}

/**
 * Style categories available for the `class` attribute picker.
 * Union of `.class { }` rules and classes used on `<g>` — never includes `:root`.
 */
export function listStyleCategories(svgText: string): string[] {
  const seen = new Set<string>();
  for (const name of Object.keys(extractClassRules(svgText))) {
    if (name && name !== ":root") seen.add(name);
  }
  for (const g of extractClassedGroups(svgText)) {
    for (const c of g.classes) {
      if (c && c !== ":root") seen.add(c);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Next unused `class-N` category name. */
export function nextStyleCategoryName(svgText: string): string {
  const used = new Set(listStyleCategories(svgText));
  let n = 1;
  while (used.has(`class-${n}`)) n += 1;
  return `class-${n}`;
}

/** Insert an empty `.class-N { }` rule; returns the new category name. */
export function insertEmptyStyleCategory(
  svgText: string
): { content: string; name: string } {
  const name = nextStyleCategoryName(svgText);
  return { content: setClassRuleProps(svgText, name, {}), name };
}

const CLASS_NAME_RE = /^[A-Za-z_][\w-]*$/;

/** Valid CSS class / style-category identifier (no leading `.`). */
export function isValidStyleCategoryName(name: string): boolean {
  return CLASS_NAME_RE.test(name.trim());
}

/**
 * Delete a style category: drop `.className { }`, strip that token from
 * element `class` attrs, and remove empty `<style>` blocks.
 */
export function removeStyleCategory(
  svgText: string,
  className: string
): string {
  const cls = className.trim().replace(/^\./, "");
  if (!cls) return svgText;

  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let out = svgText.replace(styleRe, (full, css: string) => {
    const nextCss = css
      .replace(new RegExp(`\\.${escapeRegExp(cls)}\\s*\\{[^}]*\\}`, "g"), "")
      .replace(/[ \t]*\n(?:[ \t]*\n)+/g, "\n");
    return full.replace(css, nextCss);
  });
  out = out.replace(/\s*<style\b[^>]*>\s*<\/style>/gi, "\n");

  const tagRe = /<([A-Za-z_][\w:.-]*)(\s[^>]*?)(\s*\/?\s*)>/g;
  out = out.replace(tagRe, (full, tag: string, attrs: string, close: string) => {
    const m = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!m) return full;
    const quote = m[1] != null ? '"' : "'";
    const tokens = (m[1] ?? m[2] ?? "").trim().split(/\s+/).filter(Boolean);
    if (!tokens.includes(cls)) return full;
    const kept = tokens.filter((t) => t !== cls);
    const selfClosing = /\/\s*$/.test(close);
    if (!kept.length) {
      const nextAttrs = attrs.replace(m[0], "");
      if (!nextAttrs.trim()) {
        return selfClosing ? `<${tag}/>` : `<${tag}>`;
      }
      return selfClosing ? `<${tag}${nextAttrs}/>` : `<${tag}${nextAttrs}>`;
    }
    const nextAttrs = attrs.replace(
      m[0],
      ` class=${quote}${kept.join(" ")}${quote}`
    );
    return selfClosing ? `<${tag}${nextAttrs}/>` : `<${tag}${nextAttrs}>`;
  });

  return out;
}

/**
 * Rename a style category: `.old { }` → `.new { }`, and rewrite matching
 * `class` tokens on elements. No-op when names are equal/invalid/duplicate.
 */
export function renameStyleCategory(
  svgText: string,
  from: string,
  to: string
): string {
  const oldName = from.trim().replace(/^\./, "");
  const newName = to.trim().replace(/^\./, "");
  if (!oldName || !newName || oldName === newName) return svgText;
  if (!isValidStyleCategoryName(newName)) return svgText;

  const cats = listStyleCategories(svgText);
  if (cats.includes(newName)) return svgText;

  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let out = svgText.replace(styleRe, (full, css: string) => {
    const nextCss = css.replace(
      new RegExp(`\\.${escapeRegExp(oldName)}(\\s*\\{)`, "g"),
      `.${newName}$1`
    );
    return full.replace(css, nextCss);
  });

  const tagRe = /<([A-Za-z_][\w:.-]*)(\s[^>]*?)(\s*\/?\s*)>/g;
  out = out.replace(tagRe, (full, tag: string, attrs: string, close: string) => {
    const m = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!m) return full;
    const quote = m[1] != null ? '"' : "'";
    const tokens = (m[1] ?? m[2] ?? "").trim().split(/\s+/).filter(Boolean);
    if (!tokens.includes(oldName)) return full;
    const nextTokens = tokens.map((t) => (t === oldName ? newName : t));
    const nextAttrs = attrs.replace(
      m[0],
      ` class=${quote}${nextTokens.join(" ")}${quote}`
    );
    const selfClosing = /\/\s*$/.test(close);
    return selfClosing ? `<${tag}${nextAttrs}/>` : `<${tag}${nextAttrs}>`;
  });

  return out;
}

/** First group id that uses `className` (document order), if any. */
export function firstGroupIdForClass(
  svgText: string,
  className: string
): string {
  const needle = className.trim();
  if (!needle) return "";
  for (const g of extractClassedGroups(svgText)) {
    if (g.classes.includes(needle) && !g.id.startsWith("__anon_g_")) {
      return g.id;
    }
  }
  return "";
}
