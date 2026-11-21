/** Ignore style-block text when deciding if the document structure changed. */
export function structureKey(svg: string): string {
  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style/>");
}

/**
 * Drop empty groups + normalize newlines so adding an unused `<g>` to defs
 * does not force a viewer rebuild (those groups never affect evaluation).
 * Keep `<style>` text — `:root` / class custom properties drive evaluation.
 */
export function evalAffectingKey(svg: string): string {
  return svg
    .replace(/<g\b[^>]*>\s*<\/g>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    // Removing an empty <g> often leaves a blank line; collapse so compare is stable.
    .replace(/\n[ \t]*\n+/g, "\n");
}

export function isStyleOnlyChange(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  return structureKey(prev) === structureKey(next);
}

export function isEvalNoopChange(prev: string, next: string): boolean {
  if (!prev.trim() || !next.trim()) return false;
  // Style-only edits (params) must re-evaluate — never treat as noop.
  if (isStyleOnlyChange(prev, next) && prev !== next) return false;
  return evalAffectingKey(prev) === evalAffectingKey(next);
}
