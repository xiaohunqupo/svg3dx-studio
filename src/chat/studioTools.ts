import { useStudioNavigation } from "@/composables/useStudioNavigation";
import { useFilesStore } from "@/stores/files";

export type StudioChatToolName = "go_browse" | "go_edit" | "list_files";

export type StudioChatToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

export type StudioChatToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

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
      const id = String(args.id ?? files.activeId ?? "");
      if (!id) {
        return { ok: false, message: "missing file id" };
      }
      if (!files.files.some((f) => f.id === id)) {
        return { ok: false, message: `file not found: ${id}` };
      }
      await files.select(id);
      nav.goEdit(id);
      return { ok: true, message: `navigated:edit:${id}` };
    }
    case "list_files": {
      const list = files.files.map((f) => ({ id: f.id, name: f.name }));
      return { ok: true, message: `files:${list.length}`, data: list };
    }
    default:
      return { ok: false, message: `unknown tool: ${call.name}` };
  }
}
