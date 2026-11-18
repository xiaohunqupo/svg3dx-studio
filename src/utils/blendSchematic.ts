/** Loft `blend` approach-law values (svg3dx draft §3.2.4). */
export const BLEND_VALUES = [
  "linear",
  "sine",
  "cosine",
  "tan",
  "cotan",
] as const;

export type BlendValue = (typeof BLEND_VALUES)[number];

export function isBlendValue(v: string): v is BlendValue {
  return (BLEND_VALUES as readonly string[]).includes(v);
}

/** Shape-interpolation weight \(s = f(t)\) for \(t \in [0,1]\). */
export function blendWeight(kind: BlendValue, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case "linear":
      return x;
    case "sine":
      return Math.sin((Math.PI * x) / 2);
    case "cosine":
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    case "tan":
      return Math.tan((Math.PI * x) / 4);
    case "cotan":
      return 1 - Math.tan((Math.PI * (1 - x)) / 4);
  }
}

export type BlendSchematicGeom = {
  /** Closed outline of the lofted rectangle silhouette. */
  outline: string;
  /** Start section (left) as a vertical edge highlight. */
  startEdge: string;
  /** End section (right) as a vertical edge highlight. */
  endEdge: string;
};

/**
 * Side-view silhouette of a rectangle loft (wide → narrow).
 * Half-height at parameter \(t\) is \((1-f(t))·h0 + f(t)·h1\), so the
 * outline shows *when* the profile morphs under each approach law.
 */
export function blendSchematicGeom(
  kind: BlendValue,
  width = 50,
  height = 32,
  padX = 4,
  padY = 3,
  samples = 40
): BlendSchematicGeom {
  const innerW = width - padX * 2;
  const midY = height / 2;
  // Start / end half-heights (pixels) — clear wide→narrow contrast.
  const h0 = (height - padY * 2) * 0.48;
  const h1 = (height - padY * 2) * 0.22;

  const top: Array<[number, number]> = [];
  const bot: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const s = blendWeight(kind, t);
    const half = h0 * (1 - s) + h1 * s;
    const x = padX + t * innerW;
    top.push([x, midY - half]);
    bot.push([x, midY + half]);
  }

  const fmt = (p: [number, number]) =>
    `${p[0]!.toFixed(2)} ${p[1]!.toFixed(2)}`;

  let outline = `M${fmt(top[0]!)}`;
  for (let i = 1; i < top.length; i++) outline += `L${fmt(top[i]!)}`;
  for (let i = bot.length - 1; i >= 0; i--) outline += `L${fmt(bot[i]!)}`;
  outline += "Z";

  const startEdge = `M${fmt(top[0]!)}L${fmt(bot[0]!)}`;
  const endEdge = `M${fmt(top[top.length - 1]!)}L${fmt(bot[bot.length - 1]!)}`;

  return { outline, startEdge, endEdge };
}
