/** Three.js scene background — follows TDesign page background. */
export function readViewportBackground(): string {
  if (typeof document === "undefined") return "#eeeeee";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--td-bg-color-page")
    .trim();
  return value || "#eeeeee";
}
