import {
  getStudioEditBridge,
  isEditBridgeError,
  requireEditBridge,
  type StudioEditBridge,
  type StudioEditToolResult,
} from "@/chat/editBridge";
import { useStudioNavigation } from "@/composables/useStudioNavigation";
import { useFilesStore } from "@/stores/files";
import type { AddChildKind } from "@/types/file";

export type StudioChatToolName =
  | "list_files"
  | "go_browse"
  | "go_edit"
  | "rename_file"
  | "remove_file"
  | "get_edit_state"
  | "get_source"
  | "set_source"
  | "replace_in_source"
  | "save_document"
  | "undo"
  | "redo"
  | "format_document"
  | "optimize_document"
  | "export_document"
  | "export_package"
  | "get_selection"
  | "select_node"
  | "read_node_attrs"
  | "update_node_attrs"
  | "add_group"
  | "add_model"
  | "add_material"
  | "add_root_animate"
  | "add_style_category"
  | "add_child"
  | "add_use"
  | "insert_at_path"
  | "delete_at_path"
  | "set_panel";

export type StudioChatToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

export type StudioChatToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

function str(args: Record<string, unknown>, key: string): string {
  return String(args[key] ?? "").trim();
}

function bool(
  args: Record<string, unknown>,
  key: string,
  fallback = false
): boolean {
  const v = args[key];
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asStringRecord(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim()) continue;
    out[k] = v == null ? "" : String(v);
  }
  return out;
}

async function withEditBridge(
  run: (bridge: StudioEditBridge) => StudioEditToolResult | Promise<StudioEditToolResult>
): Promise<StudioChatToolResult> {
  const bridge = requireEditBridge();
  if (isEditBridgeError(bridge)) return bridge;
  return run(bridge);
}

/** Run a frontend tool requested by the CopilotKit agent. */
export async function runStudioChatTool(
  call: StudioChatToolCall
): Promise<StudioChatToolResult> {
  const nav = useStudioNavigation();
  const files = useFilesStore();
  const name = call.name as StudioChatToolName;
  const args = call.args ?? {};

  switch (name) {
    case "go_browse": {
      nav.goBrowse();
      return { ok: true, message: "navigated:browse" };
    }
    case "go_edit": {
      const id = str(args, "id") || files.activeId || "";
      if (!id) return { ok: false, message: "missing file id" };
      if (!files.files.some((f) => f.id === id)) {
        return { ok: false, message: `file not found: ${id}` };
      }
      await files.select(id);
      nav.goEdit(id);
      return { ok: true, message: `navigated:edit:${id}` };
    }
    case "list_files": {
      const list = files.files.map((f) => ({
        id: f.id,
        name: f.name,
        dirty: !!f.dirty,
      }));
      return { ok: true, message: `files:${list.length}`, data: list };
    }
    case "rename_file": {
      const id = str(args, "id") || files.activeId || "";
      const newName = str(args, "name");
      if (!id) return { ok: false, message: "missing file id" };
      if (!newName) return { ok: false, message: "missing name" };
      if (!files.files.some((f) => f.id === id)) {
        return { ok: false, message: `file not found: ${id}` };
      }
      await files.rename(id, newName);
      return { ok: true, message: `renamed:${id}`, data: { id, name: newName } };
    }
    case "remove_file": {
      const id = str(args, "id");
      if (!id) return { ok: false, message: "missing file id" };
      if (!files.files.some((f) => f.id === id)) {
        return { ok: false, message: `file not found: ${id}` };
      }
      await files.remove(id);
      return { ok: true, message: `removed:${id}` };
    }
    case "get_edit_state": {
      const bridge = getStudioEditBridge();
      if (!bridge) {
        return {
          ok: true,
          message: "browse",
          data: {
            page: "browse",
            activeId: files.activeId,
            files: files.files.map((f) => ({
              id: f.id,
              name: f.name,
              dirty: !!f.dirty,
            })),
          },
        };
      }
      return {
        ok: true,
        message: "edit",
        data: { page: "edit", ...bridge.getSnapshot() },
      };
    }
    case "get_source":
      return withEditBridge((bridge) => {
        const data = bridge.getSource({
          maxChars: num(args, "maxChars"),
          offset: num(args, "offset"),
        });
        return { ok: true, message: `source:${data.length}`, data };
      });
    case "set_source": {
      const content = String(args.content ?? "");
      if (!content.trim()) return { ok: false, message: "missing content" };
      return withEditBridge((bridge) => bridge.setSource(content));
    }
    case "replace_in_source": {
      const find = String(args.find ?? "");
      if (!find) return { ok: false, message: "missing find" };
      return withEditBridge((bridge) =>
        bridge.replaceInSource({
          find,
          replace: String(args.replace ?? ""),
          all: bool(args, "all", false),
        })
      );
    }
    case "save_document":
      return withEditBridge((bridge) => bridge.save());
    case "undo":
      return withEditBridge((bridge) => bridge.undo());
    case "redo":
      return withEditBridge((bridge) => bridge.redo());
    case "format_document":
      return withEditBridge((bridge) => bridge.format());
    case "optimize_document":
      return withEditBridge((bridge) => bridge.optimize());
    case "export_document":
      return withEditBridge((bridge) => bridge.exportDocument());
    case "export_package":
      return withEditBridge((bridge) => bridge.exportPackage());
    case "get_selection":
      return withEditBridge((bridge) => bridge.getSelection());
    case "select_node": {
      const pathRaw = args.path;
      const path =
        pathRaw === null || pathRaw === undefined
          ? null
          : String(pathRaw).trim() || null;
      return withEditBridge((bridge) => bridge.selectPath(path));
    }
    case "read_node_attrs": {
      const path = str(args, "path");
      if (!path) return { ok: false, message: "missing path" };
      return withEditBridge((bridge) => bridge.readNodeAttrs(path));
    }
    case "update_node_attrs": {
      const path = str(args, "path");
      if (!path) return { ok: false, message: "missing path" };
      const updates = asStringRecord(args.updates);
      if (!updates || !Object.keys(updates).length) {
        return { ok: false, message: "missing updates object" };
      }
      return withEditBridge((bridge) => bridge.updateNodeAttrs(path, updates));
    }
    case "add_group":
      return withEditBridge((bridge) => bridge.addGroup());
    case "add_model":
      return withEditBridge((bridge) => bridge.addModel());
    case "add_material":
      return withEditBridge((bridge) => bridge.addMaterial());
    case "add_root_animate":
      return withEditBridge((bridge) => bridge.addRootAnimate());
    case "add_style_category":
      return withEditBridge((bridge) => bridge.addStyleCategory());
    case "add_child": {
      const parentGroupId = str(args, "parentGroupId");
      const parentPath = str(args, "parentPath");
      const kind = str(args, "kind") as AddChildKind;
      if (!parentGroupId) return { ok: false, message: "missing parentGroupId" };
      if (!parentPath) return { ok: false, message: "missing parentPath" };
      if (!kind) return { ok: false, message: "missing kind" };
      return withEditBridge((bridge) =>
        bridge.addChild({
          parentGroupId,
          parentPath,
          kind,
          href: str(args, "href") || undefined,
        })
      );
    }
    case "add_use":
      return withEditBridge((bridge) =>
        bridge.addUse({
          href: str(args, "href") || undefined,
          modelId: str(args, "modelId") || undefined,
        })
      );
    case "insert_at_path": {
      const parentPath = str(args, "parentPath");
      const kind = str(args, "kind");
      if (!parentPath) return { ok: false, message: "missing parentPath" };
      if (!kind) return { ok: false, message: "missing kind" };
      return withEditBridge((bridge) =>
        bridge.insertAtPath({
          parentPath,
          kind,
          href: str(args, "href") || undefined,
        })
      );
    }
    case "delete_at_path": {
      const path = str(args, "path");
      if (!path) return { ok: false, message: "missing path" };
      return withEditBridge((bridge) => bridge.deleteAtPath(path));
    }
    case "set_panel": {
      const panel = str(args, "panel") as
        | "model"
        | "source"
        | "animTools"
        | "nodeParams";
      if (
        panel !== "model" &&
        panel !== "source" &&
        panel !== "animTools" &&
        panel !== "nodeParams"
      ) {
        return {
          ok: false,
          message: "panel must be model|source|animTools|nodeParams",
        };
      }
      if (args.visible === undefined) {
        return { ok: false, message: "missing visible" };
      }
      return withEditBridge((bridge) =>
        bridge.setPanel(panel, bool(args, "visible"))
      );
    }
    default:
      return { ok: false, message: `unknown tool: ${call.name}` };
  }
}
