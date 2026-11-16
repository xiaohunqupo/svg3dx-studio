/** Three.js scene background — follows `--studio-viewport`. */
export function readViewportBackground(): string {
  if (typeof document === "undefined") return "#dfe7ee";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--studio-viewport")
    .trim();
  return value || "#dfe7ee";
}
