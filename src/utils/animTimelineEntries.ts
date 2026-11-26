/**
 * Animation nodes as they appear in the Edit tree, for timeline labels / selection.
 * Paths match NodeTreePanel (`anim:N` for root params; `defs:…` for nested).
 */

import { extractDefsGroups } from "@/utils/styleClasses";
import {
  listChildOpensAtPath,
  listRootAnimOpens,
} from "@/utils/nodeXmlEdit";

export type AnimTimelineEntry = {
  path: string;
  /** Element `id` (may be empty). */
  id: string;
  kind: "animate" | "animateTransform";
  /** attributeName without `--`, or transform `type`. */
  hint: string;
  /** Nearest host group id for nested anims. */
  parentId: string | null;
};

function attrOf(attrs: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\s)${name.replace(/[:]/g, "\\$&")}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "").trim() || null : null;
}

function formatAttrName(name: string | null | undefined): string {
  if (!name) return "";
  return name.startsWith("--") ? name.slice(2) : name;
}

function normalizeAnimKind(
  local: string
): "animate" | "animateTransform" | null {
  const l = local.toLowerCase();
  if (l === "animate") return "animate";
  if (l === "animatetransform") return "animateTransform";
  return null;
}

function walkNested(
  content: string,
  parentPath: string,
  hostId: string | null,
  out: AnimTimelineEntry[]
): void {
  const kids = listChildOpensAtPath(content, parentPath);
  kids.forEach((open, idx) => {
    const path = `${parentPath}.${idx}`;
    const animKind = normalizeAnimKind(open.local);
    if (animKind) {
      const hint =
        animKind === "animate"
          ? formatAttrName(attrOf(open.attrs, "attributeName"))
          : attrOf(open.attrs, "type") ?? "";
      out.push({
        path,
        id: attrOf(open.attrs, "id") ?? "",
        kind: animKind,
        hint,
        parentId: hostId,
      });
      return;
    }
    if (open.selfClosing) return;
    const local = open.local.toLowerCase();
    const nextHost =
      local === "g" ? attrOf(open.attrs, "id") ?? hostId : hostId;
    walkNested(content, path, nextHost, out);
  });
}

/** All animation elements with Studio tree paths (document order). */
export function listAnimTimelineEntries(content: string): AnimTimelineEntry[] {
  if (!content.trim()) return [];
  const out: AnimTimelineEntry[] = [];

  listRootAnimOpens(content).forEach((open, i) => {
    out.push({
      path: `anim:${i}`,
      id: attrOf(open.attrs, "id") ?? "",
      kind: "animate",
      hint: formatAttrName(attrOf(open.attrs, "attributeName")),
      parentId: null,
    });
  });

  for (const g of extractDefsGroups(content)) {
    walkNested(content, `defs:${g.id}`, g.id, out);
  }

  return out;
}
