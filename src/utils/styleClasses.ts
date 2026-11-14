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
      const props: Record<string, string> = { ...(out[className] ?? {}) };
      const propRe = /(--[A-Za-z_][\w-]*|[A-Za-z_][\w-]*)\s*:\s*([^;]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = propRe.exec(body))) {
        props[pm[1].trim()] = pm[2].trim();
      }
      out[className] = props;
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

  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const name = normalizePropName(k);
    if (!name) continue;
    normalized[name] = String(v).trim();
  }

  const ruleText = `.${cls} {${formatRuleBody(normalized)}}`;
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/i;
  const m = styleRe.exec(svgText);
  if (m) {
    const css = m[1];
    const ruleRe = new RegExp(`\\.${escapeRegExp(cls)}\\s*\\{[^}]*\\}`, "m");
    const newCss = ruleRe.test(css)
      ? css.replace(ruleRe, ruleText)
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
