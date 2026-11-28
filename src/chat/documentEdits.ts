/**
 * One structural transaction for the AI editor.
 * Ops run on a copy. Any failure discards the copy. Success is one undo.
 */
import {
  applyAttrsToSnippet,
  applyNodeUpdates,
  assignMissingNodeIds,
  HANDLE_LIFETIME,
  isPositionalHandle,
  lastChildHandle,
  resolveNodeHandle,
  validateNodeAttrs,
} from "@/chat/documentQuery";
import {
  applyAttrsAtPath,
  findRangeForTreePath,
  insertXmlAtPath,
  nodeKindAtPath,
  removeElementAtPath,
} from "@/utils/nodeXmlEdit";
import {
  allocateElementId,
  collectElementIds,
  ensureSnippetId,
  gltfSnippet,
  insertChildIntoGroup,
  removeGroupById,
  removeModelById,
  snippetForPathInsert,
} from "@/utils/svgEdit";

export type DocumentOp =
  | { op: "ensure_ids" }
  | {
      op: "insert";
      parent: string;
      kind: string;
      attrs?: Record<string, string>;
      href?: string;
    }
  | { op: "update"; handle: string; updates: Record<string, string> }
  | { op: "delete"; handle: string }
  | { op: "move"; handle: string; parent: string }
  | { op: "assign_material"; handle: string; materialId: string };

export type DocumentEditStep = {
  op: string;
  handle?: string;
  id?: string | null;
  notes?: string[];
  assigned?: { handle: string; id: string; kind: string }[];
};

type Fail = {
  ok: false;
  code: string;
  message: string;
  handle?: string;
  fix?: string;
};

type Bound = { ok: true; handle: string; id: string | null; kind: string };

function fail(
  code: string,
  message: string,
  extra?: { handle?: string; fix?: string }
): Fail {
  return { ok: false, code, message, ...extra };
}

function parentPathOf(handle: string): string | undefined {
  const i = handle.lastIndexOf(".");
  return i > 0 ? handle.slice(0, i) : undefined;
}

export function applyDocumentEdits(
  content: string,
  ops: DocumentOp[]
):
  | {
      ok: true;
      content: string;
      results: DocumentEditStep[];
      undo: "single";
      syncPath?: string;
      handleLifetime: string;
    }
  | Fail {
  if (!ops.length) {
    return fail("edit.empty", "missing ops", {
      fix: "Pass at least one insert, update, delete, move, assign_material, or ensure_ids.",
    });
  }

  let next = content;
  let structural = false;
  let syncPath: string | undefined;
  const captured = new Map<string, string | null>();
  const results: DocumentEditStep[] = [];

  function bind(ref: string): Bound | Fail {
    const positional = isPositionalHandle(ref);
    if (positional && structural && !captured.has(ref)) {
      return fail(
        "handle.stale",
        `handle '${ref}' was not bound before an insert, delete, or move in this transaction. It is not applied, because that index may now address a different node.`,
        {
          handle: ref,
          fix: "Pass the element's id, or place this edit before the structural change.",
        }
      );
    }
    const resolved = resolveNodeHandle(next, ref);
    if (!resolved.ok) {
      return fail("handle.not-found", resolved.message, {
        handle: ref,
        fix: "Call list_nodes or find_node_by_id.",
      });
    }
    const id = resolved.node.id;
    if (positional && structural) {
      const prev = captured.get(ref) ?? null;
      if (id !== prev) {
        return fail(
          "handle.stale",
          `handle '${ref}' pointed at ${prev ? `'${prev}'` : "a node without an id"} and now addresses ${id ? `'${id}'` : "a different node"}.`,
          {
            handle: ref,
            fix: prev
              ? `Use id '${prev}'.`
              : "Call ensure_node_ids, then address the node by the id it returns.",
          }
        );
      }
    }
    if (positional && !structural && !captured.has(ref)) captured.set(ref, id);
    return { ok: true, handle: resolved.handle, id, kind: resolved.node.kind };
  }

  function refreshCapturedIds(): void {
    if (structural) return;
    for (const [ref, prev] of captured) {
      if (prev) continue;
      const again = resolveNodeHandle(next, ref);
      if (again.ok && again.node.id) captured.set(ref, again.node.id);
    }
  }

  for (const op of ops) {
    if (op.op === "ensure_ids") {
      const assigned = assignMissingNodeIds(next);
      next = assigned.content;
      refreshCapturedIds();
      results.push({ op: "ensure_ids", assigned: assigned.assigned });
      continue;
    }

    if (op.op === "insert") {
      const parent = bind(op.parent);
      if (!parent.ok) return parent;
      const kind = op.kind.trim();
      const attrs = { ...(op.attrs ?? {}) };
      const href = (attrs.href || op.href || "").trim();
      if (href) attrs.href = href;
      let notes: string[] = [];
      let handle: string | null = null;
      let id: string | null = null;

      if (kind === "group") {
        if (parent.kind !== "group" || !parent.id) {
          return fail(
            "edit.failed",
            "a group can only be inserted into a group that already has an id",
            { handle: parent.handle, fix: "Insert into a defs group, or call ensure_node_ids first." }
          );
        }
        const inserted = insertChildIntoGroup(next, parent.id, "group");
        if (inserted.content === next) {
          return fail("edit.failed", "insert failed", { handle: parent.handle });
        }
        next = inserted.content;
        structural = true;
        handle = lastChildHandle(next, parent.handle);
        if (!handle) return fail("edit.failed", "insert failed", { handle: parent.handle });
        id = inserted.childId ?? null;
        if (Object.keys(attrs).length) {
          const valid = validateNodeAttrs(next, "group", handle, attrs);
          if (!valid.ok) return fail("attr.invalid", valid.message, { handle });
          const patched = applyAttrsAtPath(next, handle, valid.updates);
          if (!patched) return fail("edit.failed", "failed to apply attrs", { handle });
          next = patched;
          notes = valid.notes;
          id = nodeKindAtPath(next, handle)?.id || id;
        }
      } else {
        let snippet =
          kind === "gltf"
            ? href
              ? gltfSnippet(href)
              : null
            : snippetForPathInsert(kind, parent.kind);
        if (kind === "gltf" && !href) {
          return fail("attr.invalid", "gltf requires href", { handle: parent.handle });
        }
        if (!snippet) {
          return fail("kind.unknown", `unknown kind '${kind}'`, { handle: parent.handle });
        }
        if (Object.keys(attrs).length) {
          const valid = validateNodeAttrs(next, kind, null, attrs);
          if (!valid.ok) {
            return fail("attr.invalid", valid.message, { handle: parent.handle });
          }
          snippet = applyAttrsToSnippet(snippet, valid.updates);
          notes = valid.notes;
        }
        const stamped = ensureSnippetId(snippet, next, kind);
        snippet = stamped.snippet;
        const inserted = insertXmlAtPath(next, parent.handle, snippet);
        if (!inserted) return fail("edit.failed", "insert failed", { handle: parent.handle });
        next = inserted;
        structural = true;
        handle = lastChildHandle(next, parent.handle);
        id = stamped.id || null;
      }

      if (!handle) return fail("edit.failed", "insert failed", { handle: parent.handle });
      syncPath = parent.handle;
      results.push({
        op: "insert",
        handle,
        id,
        ...(notes.length ? { notes } : {}),
      });
      continue;
    }

    if (op.op === "update" || op.op === "assign_material") {
      const ref = op.op === "update" ? op.handle : op.handle;
      const updates =
        op.op === "update" ? op.updates : { material: op.materialId };
      const bound = bind(ref);
      if (!bound.ok) return bound;
      const updated = applyNodeUpdates(next, [{ handle: bound.handle, updates }]);
      if (!updated.ok) {
        return fail("attr.invalid", updated.message, { handle: bound.handle });
      }
      next = updated.content;
      const written = updated.results[0]?.attrs?.id ?? bound.id;
      if (isPositionalHandle(ref)) captured.set(ref, written || null);
      const stepNotes = updated.results[0]?.notes;
      results.push({
        op: op.op,
        handle: bound.handle,
        id: written,
        ...(stepNotes?.length ? { notes: stepNotes } : {}),
      });
      continue;
    }

    if (op.op === "delete") {
      const bound = bind(op.handle);
      if (!bound.ok) return bound;
      const before = next;
      if (bound.kind === "group" && bound.id) next = removeGroupById(next, bound.id);
      else if (bound.kind === "model" && bound.id && !bound.handle.includes(".")) {
        next = removeModelById(next, bound.id);
      } else {
        const removed = removeElementAtPath(next, bound.handle);
        if (!removed) {
          return fail("edit.failed", `delete failed: ${bound.handle}`, {
            handle: bound.handle,
          });
        }
        next = removed;
      }
      if (next === before) {
        return fail("edit.failed", `delete failed: ${bound.handle}`, {
          handle: bound.handle,
        });
      }
      structural = true;
      syncPath = parentPathOf(bound.handle) ?? syncPath;
      results.push({ op: "delete", handle: bound.handle, id: bound.id });
      continue;
    }

    if (op.op === "move") {
      const node = bind(op.handle);
      if (!node.ok) return node;
      const parent = bind(op.parent);
      if (!parent.ok) return parent;
      if (
        parent.handle === node.handle ||
        parent.handle.startsWith(`${node.handle}.`)
      ) {
        return fail("edit.failed", "a node cannot be moved into itself", {
          handle: node.handle,
        });
      }
      let nodeHandle = node.handle;
      let nodeId = node.id;
      let parentId = parent.id;
      let parentHandle = parent.handle;
      if (!nodeId || !parentId) {
        const used = collectElementIds(next);
        if (!nodeId) {
          nodeId = allocateElementId(used, node.kind);
          const stamped = applyAttrsAtPath(next, nodeHandle, { id: nodeId });
          if (!stamped) {
            return fail("edit.failed", "failed to assign an id before move", {
              handle: nodeHandle,
            });
          }
          next = stamped;
          if (isPositionalHandle(op.handle)) captured.set(op.handle, nodeId);
        }
        if (!parentId) {
          parentId = allocateElementId(used, parent.kind);
          const stamped = applyAttrsAtPath(next, parentHandle, { id: parentId });
          if (!stamped) {
            return fail("edit.failed", "failed to assign an id before move", {
              handle: parentHandle,
            });
          }
          next = stamped;
          if (isPositionalHandle(op.parent)) captured.set(op.parent, parentId);
        }
      }
      const range = findRangeForTreePath(next, nodeHandle);
      if (!range) {
        return fail("edit.failed", `move failed: ${nodeHandle}`, { handle: nodeHandle });
      }
      const xml = next.slice(range.start, range.end).trim();
      const removed = removeElementAtPath(next, nodeHandle);
      if (!removed) {
        return fail("edit.failed", `move failed: ${nodeHandle}`, { handle: nodeHandle });
      }
      const parentAgain = resolveNodeHandle(removed, parentId);
      if (!parentAgain.ok) {
        return fail("handle.not-found", parentAgain.message, {
          handle: op.parent,
          fix: "Address the destination by id.",
        });
      }
      const inserted = insertXmlAtPath(removed, parentAgain.handle, xml);
      if (!inserted) {
        return fail("edit.failed", "move failed", { handle: parentAgain.handle });
      }
      next = inserted;
      structural = true;
      syncPath = parentAgain.handle;
      const handle = lastChildHandle(next, parentAgain.handle);
      results.push({ op: "move", handle: handle ?? parentAgain.handle, id: nodeId });
      continue;
    }

    return fail("edit.unknown", "unknown op");
  }

  return {
    ok: true,
    content: next,
    results,
    undo: "single",
    ...(syncPath ? { syncPath } : {}),
    handleLifetime: HANDLE_LIFETIME,
  };
}
