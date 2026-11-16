/**
 * Convert between svg3dx `fill` (space-separated RGBA ∈ [0,1])
 * and UI `#RRGGBBAA` (HEX8).
 */

export type FillRgba = { r: number; g: number; b: number; a: number };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function channelToByte(n: number): number {
  return Math.round(clamp01(n) * 255);
}

function byteToHex(n: number): string {
  return n.toString(16).padStart(2, "0").toUpperCase();
}

function formatUnit(n: number): string {
  const t = Math.round(clamp01(n) * 1000) / 1000;
  if (Number.isInteger(t)) return String(t);
  return String(t).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.$/, "");
}

/** Parse `#RGB` / `#RRGGBB` / `#RRGGBBAA` (optional leading #). */
export function parseHex8(raw: string): FillRgba | null {
  const s = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;
  if (s.length === 3 || s.length === 4) {
    r = parseInt(s[0]! + s[0]!, 16);
    g = parseInt(s[1]! + s[1]!, 16);
    b = parseInt(s[2]! + s[2]!, 16);
    if (s.length === 4) a = parseInt(s[3]! + s[3]!, 16);
  } else if (s.length === 6 || s.length === 8) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
    if (s.length === 8) a = parseInt(s.slice(6, 8), 16);
  } else {
    return null;
  }
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

/** Parse `r g b` / `r g b a` floats, or hex. */
export function parseFill(raw: string): FillRgba | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("#") || /^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(s)) {
    return parseHex8(s);
  }
  const parts = s.split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return {
    r: clamp01(nums[0]!),
    g: clamp01(nums[1]!),
    b: clamp01(nums[2]!),
    a: parts.length === 4 ? clamp01(nums[3]!) : 1,
  };
}

/** `#RRGGBBAA` for ColorPicker / clipboard. Empty string if unparseable. */
export function fillToHex8(raw: string): string {
  const c = parseFill(raw);
  if (!c) return "";
  return (
    "#" +
    byteToHex(channelToByte(c.r)) +
    byteToHex(channelToByte(c.g)) +
    byteToHex(channelToByte(c.b)) +
    byteToHex(channelToByte(c.a))
  );
}

/** Store form: `r g b a` with components ∈ [0,1]. */
export function hex8ToFill(hex: string): string {
  const c = parseHex8(hex);
  if (!c) return "";
  return `${formatUnit(c.r)} ${formatUnit(c.g)} ${formatUnit(c.b)} ${formatUnit(c.a)}`;
}
