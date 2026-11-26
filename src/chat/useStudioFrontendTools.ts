import { z } from "zod";
import { useFrontendTool } from "@copilotkit/vue/v2";
import { runStudioChatTool } from "@/chat/studioTools";

async function run(
  name: string,
  args?: Record<string, unknown>
): Promise<string> {
  return JSON.stringify(await runStudioChatTool({ name, args }));
}

/** Register all Studio Copilot frontend tools (call once from setup). */
export function useStudioFrontendTools(): void {
  useFrontendTool({
    name: "list_files",
    description: "List Studio documents (id, name, dirty)",
    handler: async () => run("list_files"),
  });

  useFrontendTool({
    name: "go_browse",
    description: "Navigate to the browse (file list) page",
    handler: async () => run("go_browse"),
  });

  useFrontendTool({
    name: "go_edit",
    description: "Open a document in the editor by file id",
    parameters: z.object({
      id: z.string().describe("Document id from list_files"),
    }),
    handler: async ({ id }) => run("go_edit", { id }),
  });

  useFrontendTool({
    name: "rename_file",
    description: "Rename a document in the file list",
    parameters: z.object({
      id: z.string().describe("Document id"),
      name: z.string().describe("New file name (e.g. demo.svg3dx)"),
    }),
    handler: async ({ id, name }) => run("rename_file", { id, name }),
  });

  useFrontendTool({
    name: "remove_file",
    description: "Delete a document from the Studio file list",
    parameters: z.object({
      id: z.string().describe("Document id"),
    }),
    handler: async ({ id }) => run("remove_file", { id }),
  });

  useFrontendTool({
    name: "get_edit_state",
    description:
      "Get editor state: dirty, selection, panels, undo availability (or browse summary)",
    handler: async () => run("get_edit_state"),
  });

  useFrontendTool({
    name: "get_source",
    description:
      "Read the current document XML source. Use maxChars/offset for large files.",
    parameters: z.object({
      maxChars: z.number().optional().describe("Max characters to return"),
      offset: z.number().optional().describe("Start offset in source"),
    }),
    handler: async (args) => run("get_source", args),
  });

  useFrontendTool({
    name: "set_source",
    description:
      "Replace the entire document source XML. Prefer replace_in_source for small edits.",
    parameters: z.object({
      content: z.string().describe("Full svg3dx XML document"),
    }),
    handler: async ({ content }) => run("set_source", { content }),
  });

  useFrontendTool({
    name: "replace_in_source",
    description: "Find/replace text in the document source",
    parameters: z.object({
      find: z.string().describe("Exact substring to find"),
      replace: z.string().describe("Replacement text"),
      all: z
        .boolean()
        .optional()
        .describe("Replace all occurrences (default false)"),
    }),
    handler: async (args) => run("replace_in_source", args),
  });

  useFrontendTool({
    name: "save_document",
    description: "Save the current document (File → Save)",
    handler: async () => run("save_document"),
  });

  useFrontendTool({
    name: "undo",
    description: "Undo the last document edit",
    handler: async () => run("undo"),
  });

  useFrontendTool({
    name: "redo",
    description: "Redo the last undone document edit",
    handler: async () => run("redo"),
  });

  useFrontendTool({
    name: "format_document",
    description: "Format the document XML (File → Format)",
    handler: async () => run("format_document"),
  });

  useFrontendTool({
    name: "optimize_document",
    description: "Optimize the document (remove unused nodes/attrs)",
    handler: async () => run("optimize_document"),
  });

  useFrontendTool({
    name: "export_document",
    description: "Download the current document as .svg3dx",
    handler: async () => run("export_document"),
  });

  useFrontendTool({
    name: "export_package",
    description: "Download the document as a .svg3dxz package with assets",
    handler: async () => run("export_package"),
  });

  useFrontendTool({
    name: "get_selection",
    description: "Get the currently selected tree node",
    handler: async () => run("get_selection"),
  });

  useFrontendTool({
    name: "select_node",
    description: "Select a tree node by path, or clear selection with path null",
    parameters: z.object({
      path: z
        .string()
        .nullable()
        .describe("Tree path like model:main.g1 or null to clear"),
    }),
    handler: async ({ path }) => run("select_node", { path }),
  });

  useFrontendTool({
    name: "read_node_attrs",
    description: "Read XML attributes of a node at a tree path",
    parameters: z.object({
      path: z.string().describe("Tree path"),
    }),
    handler: async ({ path }) => run("read_node_attrs", { path }),
  });

  useFrontendTool({
    name: "update_node_attrs",
    description:
      "Update XML attributes at a tree path. Empty string removes an attribute.",
    parameters: z.object({
      path: z.string().describe("Tree path"),
      updates: z
        .record(z.string())
        .describe("Attribute map, e.g. { id: 'box1', length: '120' }"),
    }),
    handler: async ({ path, updates }) =>
      run("update_node_attrs", { path, updates }),
  });

  useFrontendTool({
    name: "add_group",
    description: "Add an empty group under defs (tree Add → Group)",
    handler: async () => run("add_group"),
  });

  useFrontendTool({
    name: "add_model",
    description: "Add a new model (tree Add → Model)",
    handler: async () => run("add_model"),
  });

  useFrontendTool({
    name: "add_material",
    description: "Add a new material (tree Add → Material)",
    handler: async () => run("add_material"),
  });

  useFrontendTool({
    name: "add_root_animate",
    description: "Add a root-level animate element",
    handler: async () => run("add_root_animate"),
  });

  useFrontendTool({
    name: "add_style_category",
    description: "Add an empty CSS style category",
    handler: async () => run("add_style_category"),
  });

  useFrontendTool({
    name: "add_child",
    description:
      "Add a child into a group. kind: group|box|cylinder|sphere|cone|torus|wedge|pyramid|prism|sector-cylinder|point|line|arc|path|extrude|revolve|loft|sweep|pipe|gltf|bool-*|if|if-not|loop-*|animate|animateTransform. gltf requires href.",
    parameters: z.object({
      parentGroupId: z.string().describe("Parent group id"),
      parentPath: z.string().describe("Parent tree path"),
      kind: z.string().describe("Child kind"),
      href: z.string().optional().describe("Required for gltf asset href"),
    }),
    handler: async (args) => run("add_child", args),
  });

  useFrontendTool({
    name: "add_use",
    description: "Add a <use> into a model (defaults to active model)",
    parameters: z.object({
      href: z.string().optional().describe("use href, e.g. #group-id"),
      modelId: z.string().optional().describe("Target model id"),
    }),
    handler: async (args) => run("add_use", args),
  });

  useFrontendTool({
    name: "insert_at_path",
    description: "Insert a child snippet under an arbitrary tree path",
    parameters: z.object({
      parentPath: z.string().describe("Parent tree path"),
      kind: z.string().describe("Insert kind (same as add_child)"),
      href: z.string().optional().describe("Required for gltf"),
    }),
    handler: async (args) => run("insert_at_path", args),
  });

  useFrontendTool({
    name: "delete_at_path",
    description: "Delete the node at a tree path (group/model/material/style/element)",
    parameters: z.object({
      path: z.string().describe("Tree path to delete"),
    }),
    handler: async ({ path }) => run("delete_at_path", { path }),
  });

  useFrontendTool({
    name: "set_panel",
    description:
      "Show/hide editor panels (View menu): model, source, animTools, nodeParams",
    parameters: z.object({
      panel: z.enum(["model", "source", "animTools", "nodeParams"]),
      visible: z.boolean(),
    }),
    handler: async (args) => run("set_panel", args),
  });
}
