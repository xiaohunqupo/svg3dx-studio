/**
 * Cosmetic XML formatting via Prettier + @prettier/plugin-xml.
 * Normalizes indentation, attribute spacing, and similar whitespace —
 * not a structural optimize (no unused-node removal).
 */

import * as prettier from "prettier/standalone";
import prettierPluginXml from "@prettier/plugin-xml";
import { normalizeXmlNewlines } from "@/utils/nodeXmlEdit";

/** `pretty` = wrap by width; `compact` = one tag per line (no attr wrap). */
export type FormatXmlMode = "pretty" | "compact";

export type FormatXmlOptions = {
  mode?: FormatXmlMode;
  /**
   * Effective column width for `pretty` mode (from the source editor).
   * Ignored in `compact` mode.
   */
  printWidth?: number;
};

export type FormatXmlResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; error: string };

const COMPACT_PRINT_WIDTH = 1_000_000;
export const SOURCE_FORMAT_MODE_KEY = "svg3dx.studio.sourceFormatMode";

export function readSourceFormatMode(): FormatXmlMode {
  try {
    const raw = localStorage.getItem(SOURCE_FORMAT_MODE_KEY);
    if (raw === "compact" || raw === "pretty") return raw;
    // migrate old key value
    if (raw === "auto") return "pretty";
  } catch {
    /* ignore */
  }
  return "pretty";
}

export function persistSourceFormatMode(mode: FormatXmlMode): void {
  try {
    localStorage.setItem(SOURCE_FORMAT_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/**
 * Pretty-print XML/SVG with Prettier.
 *
 * - `pretty`: wrap attributes when a line would exceed `printWidth`
 * - `compact`: keep each open/self-closing tag on one line (no attr wrapping)
 */
export async function formatXml(
  text: string,
  options: FormatXmlOptions = {}
): Promise<FormatXmlResult> {
  const normalized = normalizeXmlNewlines(text);
  if (!normalized.trim()) {
    return { ok: true, content: normalized, changed: false };
  }

  const mode = options.mode ?? "pretty";
  const printWidth =
    mode === "compact"
      ? COMPACT_PRINT_WIDTH
      : Math.max(40, Math.min(500, Math.floor(options.printWidth ?? 100)));

  try {
    const content = await prettier.format(normalized, {
      parser: "xml",
      plugins: [prettierPluginXml],
      filepath: "document.svg3dx",
      tabWidth: 2,
      useTabs: false,
      printWidth,
      endOfLine: "lf",
      singleAttributePerLine: false,
      xmlWhitespaceSensitivity: "ignore",
      xmlSortAttributesByKey: false,
    });
    const before = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    return {
      ok: true,
      content,
      changed: content !== before && content !== normalized,
    };
  } catch {
    return { ok: false, error: "parse" };
  }
}
