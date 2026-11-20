/**
 * Structured edit helpers for SVG path `d` — split commands so each number
 * can be edited (and take an expression) independently.
 */

export type PathSeg = {
  /** Command letter (preserved case). */
  cmd: string;
  /** Operand tokens as raw strings (may be expressions). */
  values: string[];
};

/** Numbers consumed by one repetition of a command (0 = Z). */
export function pathCmdArity(cmd: string): number {
  switch (cmd.toUpperCase()) {
    case "Z":
      return 0;
    case "H":
    case "V":
      return 1;
    case "M":
    case "L":
    case "T":
      return 2;
    case "S":
    case "Q":
      return 4;
    case "C":
      return 6;
    case "A":
      return 7;
    default:
      return 0;
  }
}

/** Operand labels for UI rows (cycled for multi-pair commands). */
export function pathValueLabels(cmd: string): string[] {
  switch (cmd.toUpperCase()) {
    case "M":
    case "L":
    case "T":
      return ["x", "y"];
    case "H":
      return ["x"];
    case "V":
      return ["y"];
    case "C":
      return ["x1", "y1", "x2", "y2", "x", "y"];
    case "S":
      return ["x2", "y2", "x", "y"];
    case "Q":
      return ["x1", "y1", "x", "y"];
    case "A":
      return ["rx", "ry", "rot", "large", "sweep", "x", "y"];
    default:
      return [];
  }
}

/**
 * Tokenize `d` into command segments. Number-like tokens and bare
 * expression-ish words (letters starting identifiers) are kept as strings.
 */
export function parsePathD(d: string): PathSeg[] {
  const trimmed = d.trim();
  if (!trimmed) return [];
  const tokens =
    trimmed.match(
      /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|\{[^}]+\}|[A-Za-z_][\w.]*/g
    ) ?? [];
  const segs: PathSeg[] = [];
  let cmd = "";
  let values: string[] = [];

  const flush = () => {
    if (!cmd) return;
    segs.push({ cmd, values });
    cmd = "";
    values = [];
  };

  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      flush();
      cmd = tok;
      values = [];
      continue;
    }
    if (!cmd) continue;
    values.push(tok);
  }
  flush();
  return segs;
}

export function serializePathD(segs: PathSeg[]): string {
  return segs
    .map((s) => {
      if (!s.values.length) return s.cmd;
      return `${s.cmd} ${s.values.join(" ")}`;
    })
    .join(" ")
    .trim();
}

/** Group path operands into xy pairs (and leftover scalars) for VecRgb editors. */
export function pathSegXyPairs(seg: PathSeg): {
  pairs: Array<[string, string]>;
  scalars: string[];
} {
  const upper = seg.cmd.toUpperCase();
  if (upper === "A") {
    const v = seg.values;
    return {
      pairs: [
        [v[0] ?? "", v[1] ?? ""],
        [v[5] ?? "", v[6] ?? ""],
      ],
      scalars: [v[2] ?? "", v[3] ?? "", v[4] ?? ""],
    };
  }
  if (upper === "H" || upper === "V") {
    return { pairs: [], scalars: [...seg.values] };
  }
  if (upper === "Z") {
    return { pairs: [], scalars: [] };
  }
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < seg.values.length; i += 2) {
    pairs.push([seg.values[i]!, seg.values[i + 1]!]);
  }
  const scalars =
    seg.values.length % 2 === 1
      ? [seg.values[seg.values.length - 1]!]
      : [];
  return { pairs, scalars };
}

/** Write xy pairs (+ optional arc scalars) back onto a segment. */
export function applyPathSegXyPairs(
  seg: PathSeg,
  pairs: Array<[string, string]>,
  scalars: string[] = []
): PathSeg {
  const upper = seg.cmd.toUpperCase();
  if (upper === "A") {
    return {
      cmd: seg.cmd,
      values: [
        pairs[0]?.[0] ?? "",
        pairs[0]?.[1] ?? "",
        scalars[0] ?? "",
        scalars[1] ?? "",
        scalars[2] ?? "",
        pairs[1]?.[0] ?? "",
        pairs[1]?.[1] ?? "",
      ],
    };
  }
  if (upper === "H" || upper === "V") {
    return { cmd: seg.cmd, values: [...scalars] };
  }
  if (upper === "Z") {
    return { cmd: seg.cmd, values: [] };
  }
  return {
    cmd: seg.cmd,
    values: pairs.flatMap(([x, y]) => [x, y]),
  };
}
