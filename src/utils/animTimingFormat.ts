/** Format seconds for SMIL-shaped `begin` / `dur` attributes (`2s`, `500ms`). */
export function formatDurationSecs(secs: number): string {
  const s = Math.max(0, secs);
  const ms = Math.round(s * 1000);
  if (ms > 0 && ms < 1000) return `${ms}ms`;
  const rounded = Math.round(s * 1000) / 1000;
  return `${Number(rounded.toFixed(3))}s`;
}
