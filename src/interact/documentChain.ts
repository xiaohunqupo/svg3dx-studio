import {
  findOpenTagAtPath,
  listChildOpensAtPath,
  nodeKindAtPath,
} from "@/utils/nodeXmlEdit";

/**
 * One document node on the way from a model use down to a hit.
 * Loop iterations share a path; `loopIndex` tells copies apart (0 is canonical).
 */
export type DocStep = {
  path: string;
  loopIndex?: number;
  /** Inside this level, but no node is selected. */
  pending?: boolean;
};

const PRIMITIVES = new Set([
  "box",
  "cylinder",
  "sphere",
  "torus",
  "cone",
  "wedge",
  "pyramid",
  "prism",
  "sector-cylinder",
  "line",
  "arc",
  "path",
  "extrude",
  "revolve",
  "loft",
  "sweep",
  "pipe",
  "mesh",
  "triangles",
]);

function attr(attrs: string, name: string): string {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function hrefGroup(attrs: string): string {
  const href = attr(attrs, "href") || attr(attrs, "xlink:href");
  return href.replace(/^#/, "").trim();
}

export function isLoopKind(kind: string | null | undefined): boolean {
  return kind === "loop-points" || kind === "loop-range";
}

export function isLoopPath(content: string, path: string | null): boolean {
  if (!path) return false;
  return isLoopKind(nodeKindAtPath(content, path)?.kind);
}

/** `model:id.N` → href target group id. */
export function modelUseGroupId(content: string, modelPath: string): string | null {
  const open = findOpenTagAtPath(content, modelPath);
  if (!open || open.local !== "use") return null;
  return hrefGroup(open.attrs) || null;
}

/**
 * Put the model element (`model:id`) in front of a use chain
 * (`model:id.N` …) so the breadcrumb starts at the current model.
 */
export function withModelCrumb(steps: DocStep[]): DocStep[] {
  const first = steps[0]?.path;
  if (!first?.startsWith("model:")) return steps;
  const id = first.slice("model:".length).split(".")[0];
  if (!id) return steps;
  const modelPath = `model:${id}`;
  if (first === modelPath) return steps;
  return [{ path: modelPath }, ...steps];
}

/**
 * Ancestor crumbs for a tree path that was not reached through a viewport hit.
 * Stops at the path itself (a use's target group is a separate step).
 */
export function ancestorChain(path: string): DocStep[] {
  if (!path.startsWith("defs:")) return [{ path }];
  const parts = path.slice("defs:".length).split(".").filter(Boolean);
  const head = parts[0];
  if (!head) return [{ path }];
  const steps: DocStep[] = [];
  let cur = `defs:${head}`;
  steps.push({ path: cur });
  for (let i = 1; i < parts.length; i++) {
    cur = `${cur}.${parts[i]}`;
    steps.push({ path: cur });
  }
  return steps;
}

/**
 * Document steps from a model use, or from a defs group shown in world space,
 * down to the node `nodeId` names.
 * Uses the same id shape the evaluator writes (`group/loop-points:0/use:0/group/box:1`),
 * so a flattened loop or inlined use still walks one XML element at a time.
 */
export function documentChain(
  content: string,
  modelPath: string | null,
  nodeId: string | null,
  rootGroupId?: string | null
): DocStep[] {
  const steps: DocStep[] = [];
  if (modelPath) steps.push({ path: modelPath });
  if (!content) return steps;
  const gid = modelPath
    ? modelUseGroupId(content, modelPath)
    : rootGroupId?.trim() || null;
  if (!gid) return steps;
  const groupPath = `defs:${gid}`;
  steps.push({ path: groupPath });
  if (!nodeId || nodeId === gid) return steps;
  const prefix = `${gid}/`;
  if (!nodeId.startsWith(prefix)) return steps;
  const segs = nodeId.slice(prefix.length).split("/").filter(Boolean);
  steps.push(...matchChildren(content, groupPath, segs));
  return steps;
}

function matchChildren(content: string, parentPath: string, segs: string[]): DocStep[] {
  if (!segs.length) return [];
  const children = listChildOpensAtPath(content, parentPath);
  const counters = new Map<string, number>();
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const childPath = `${parentPath}.${i}`;
    const local = child.local;
    if (local === "loop-points" || local === "loop-range") {
      const m = new RegExp(`^${local}:(\\d+)$`).exec(segs[0] ?? "");
      if (!m) continue;
      return [
        { path: childPath, loopIndex: Number(m[1]) },
        ...matchChildren(content, childPath, segs.slice(1)),
      ];
    }
    if (local === "use") {
      const n = counters.get("use") ?? 0;
      counters.set("use", n + 1);
      if (segs[0] !== `use:${n}`) continue;
      const steps: DocStep[] = [{ path: childPath }];
      const gid = hrefGroup(child.attrs);
      let rest = segs.slice(1);
      if (gid && rest[0] === gid) {
        const target = `defs:${gid}`;
        steps.push({ path: target });
        rest = rest.slice(1);
        steps.push(...matchChildren(content, target, rest));
      }
      return steps;
    }
    if (local === "g") {
      const id = attr(child.attrs, "id");
      if (id) {
        if (segs[0] !== id) continue;
        return [
          { path: childPath },
          ...matchChildren(content, childPath, segs.slice(1)),
        ];
      }
      const n = counters.get("g") ?? 0;
      counters.set("g", n + 1);
      if (segs[0] !== `g:${n}`) continue;
      return [
        { path: childPath },
        ...matchChildren(content, childPath, segs.slice(1)),
      ];
    }
    if (local === "if" || local === "if-not" || local.startsWith("bool-")) {
      const n = counters.get(local) ?? 0;
      counters.set(local, n + 1);
      if (segs[0] !== `${local}:${n}`) continue;
      return [
        { path: childPath },
        ...matchChildren(content, childPath, segs.slice(1)),
      ];
    }
    if (PRIMITIVES.has(local)) {
      const n = counters.get(local) ?? 0;
      counters.set(local, n + 1);
      if (segs[0] !== `${local}:${n}`) continue;
      return [{ path: childPath }];
    }
  }
  return [];
}
