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
    description:
      "List all Studio documents. Use ONLY when the user asks which files exist or to find a file — not for editing the current document.",
    handler: async () => run("list_files"),
  });

  useFrontendTool({
    name: "go_browse",
    description:
      "Navigate to the browse page. Use only when the user asks to leave the editor / see the file list.",
    handler: async () => run("go_browse"),
  });

  useFrontendTool({
    name: "go_edit",
    description:
      "Open another document by id. Use only when the user asks to switch files — not needed if already editing.",
    parameters: z.object({
      id: z.string().describe("Document id from list_files"),
    }),
    handler: async ({ id }) => run("go_edit", { id }),
  });

  useFrontendTool({
    name: "rename_file",
    description: "Rename a document in the file list (not a content edit)",
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
      "Current editor snapshot (selection, panels, undo). Prefer context.edit when present; do not use this to scan other files.",
    handler: async () => run("get_edit_state"),
  });

  useFrontendTool({
    name: "get_source",
    description:
      "Read the ACTIVE document XML only. Use maxChars/offset for large files. Do not list other files first.",
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
    description:
      "Find/replace raw XML. Do not use this to bind materials or to invent node markup; use assign_material, update_nodes, and add_child.",
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
    description:
      "Select a node by handle from list_nodes / find_node_by_id, or clear selection with path null",
    parameters: z.object({
      path: z
        .string()
        .nullable()
        .describe("Handle such as defs:head.0 or model:solid-view.0, or null to clear"),
    }),
    handler: async ({ path }) => run("select_node", { path }),
  });

  useFrontendTool({
    name: "read_node_attrs",
    description:
      "Read XML attributes of a node. Pass a handle from list_nodes or find_node_by_id.",
    parameters: z.object({
      path: z.string().describe("Node handle, e.g. defs:head.0"),
    }),
    handler: async ({ path }) => run("read_node_attrs", { path }),
  });

  useFrontendTool({
    name: "update_node_attrs",
    description:
      "Update XML attributes on one handle. Empty string removes an attribute. For materials use assign_material. For several nodes use update_nodes (one undo).",
    parameters: z.object({
      path: z.string().describe("Node handle from list_nodes"),
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
      "Add a child into a definition group and return its handle. Pass attrs so the node is created with those parameters (one undo). kind: group|box|cylinder|sphere|cone|torus|wedge|pyramid|prism|sector-cylinder|point|line|arc|path|extrude|revolve|loft|sweep|pipe|gltf|bool-*|if|if-not|loop-*|animate|animateTransform. Call get_node_schema(kind) for parameters. gltf requires href.",
    parameters: z.object({
      parentGroupId: z
        .string()
        .optional()
        .describe("Parent group id. Optional when parentPath is the group handle"),
      parentPath: z
        .string()
        .optional()
        .describe("Parent handle from list_nodes, e.g. defs:head"),
      kind: z.string().describe("Child kind"),
      href: z.string().optional().describe("Required for gltf asset href"),
      attrs: z
        .record(z.string())
        .optional()
        .describe("Attributes applied at insert, e.g. { radius: '12', id: 'nose' }"),
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
    description:
      "Insert a child under a handle (section, bool, sweep, or any parent) and return the new handle. Pass attrs to set parameters in the same undo.",
    parameters: z.object({
      parentPath: z.string().describe("Parent handle"),
      kind: z.string().describe("Insert kind (same as add_child, plus section and svg-path/circle/rect/ellipse/polygon)"),
      href: z.string().optional().describe("Required for gltf"),
      attrs: z
        .record(z.string())
        .optional()
        .describe("Attributes applied to the new element"),
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
    name: "list_nodes",
    description:
      "List nodes in the active document. Each node has a handle to pass to read/write/select tools. role=definition is the editable element under defs; role=instance is an s3dx:use in a model. An xml id is reported separately and is not itself a handle.",
    parameters: z.object({
      scope: z
        .enum(["all", "definitions", "instances", "materials"])
        .optional()
        .describe("Filter. Default all"),
      kind: z.string().optional().describe("Element kind, e.g. sphere or use"),
      limit: z.number().optional().describe("Max nodes to return (default 300)"),
    }),
    handler: async (args) => run("list_nodes", args),
  });

  useFrontendTool({
    name: "find_node_by_id",
    description:
      "Find elements whose xml id matches. Returns the definition handle (pass this to read/write tools) and the model instances that display it. Use this when source has id=\"nose\" but a guessed path does not resolve.",
    parameters: z.object({
      id: z.string().describe("XML id, e.g. nose"),
    }),
    handler: async ({ id }) => run("find_node_by_id", { id }),
  });

  useFrontendTool({
    name: "get_node_schema",
    description:
      "Parameters, defaults, and coordinate convention for a node kind before you insert or edit it. kind=list returns every kind. World is Z-up; XY is the ground plane.",
    parameters: z.object({
      kind: z.string().describe("Kind such as prism, box, extrude, or list"),
    }),
    handler: async ({ kind }) => run("get_node_schema", { kind }),
  });

  useFrontendTool({
    name: "get_material",
    description:
      "Effective material for a handle or xml id: the reference that actually wins (attribute, class, inline, or ancestor), the resolved built-in or document material, and whether an invalid reference fell back to default.",
    parameters: z.object({
      handle: z.string().describe("Node handle or xml id"),
    }),
    handler: async ({ handle }) => run("get_material", { handle }),
  });

  useFrontendTool({
    name: "assign_material",
    description:
      "Bind a material without guessing the reference syntax. Built-in keywords (steel, plastic, …) are written as material=\"steel\". Document material ids are written as material=\"url(#id)\". Returns the effective material and whether it fell back to default. Empty materialId clears the attribute.",
    parameters: z.object({
      handle: z.string().describe("Node handle or xml id"),
      materialId: z
        .string()
        .describe("Built-in keyword, document id, or url(#id). Empty string clears"),
    }),
    handler: async ({ handle, materialId }) =>
      run("assign_material", { handle, materialId }),
  });

  useFrontendTool({
    name: "update_nodes",
    description:
      "Update attributes on several handles in one undo. Invalid handles, unknown attributes, and bad material references fail the whole batch with no write. Material values are canonicalized the same way as assign_material.",
    parameters: z.object({
      edits: z
        .array(
          z.object({
            handle: z.string().describe("Node handle or xml id"),
            updates: z.record(z.string()).describe("Attribute map. Empty string removes"),
          })
        )
        .describe("Edits applied together"),
    }),
    handler: async ({ edits }) => run("update_nodes", { edits }),
  });

  useFrontendTool({
    name: "capture_preview",
    description:
      "JPEG data URL of the active viewport after the latest edit, plus render warnings classified as material or geometry. view=current keeps the camera; front, side, top, and iso frame the model and then restore the camera.",
    parameters: z.object({
      view: z
        .enum(["current", "front", "side", "top", "iso"])
        .optional()
        .describe("Camera. Default current"),
    }),
    handler: async (args) => run("capture_preview", args),
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
