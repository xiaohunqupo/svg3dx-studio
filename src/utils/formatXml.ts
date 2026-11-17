/**
 * Cosmetic XML formatting via Prettier + @prettier/plugin-xml.
 * Normalizes indentation, attribute spacing, and similar whitespace —
 * not a structural optimize (no unused-node removal).
 */

import * as prettier from "prettier/standalone";
import prettierPluginXml from "@prettier/plugin-xml";
import { normalizeXmlNewlines } from "@/utils/nodeXmlEdit";

export type FormatXmlMode = "auto" | "compact";

export type FormatXmlOptions = {
  mode?: FormatXmlMode;
  /**
   * Effective column width for `auto` mode (from the source editor).
   * Ignored in `compact` mode.
   */
  printWidth?: number;
};

export type FormatXmlResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; error: string };

const COMPACT_PRINT_WIDTH = 1_000_000;

/**
 * Pretty-print XML/SVG with Prettier.
 *
 * - `auto`: wrap attributes when a line would exceed `printWidth`
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

  const mode = options.mode ?? "auto";
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
      // Ignore insignificant whitespace so tags/attrs reflow cleanly.
      xmlWhitespaceSensitivity: "ignore",
      // Keep author attribute order (ids, transforms, etc.).
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
