import type { AddChildKind } from "@/types/file";

/** Same shape as StudioChatToolResult — kept local to avoid circular imports. */
export type StudioEditToolResult = {
  ok: boolean;
  message: string;
  data?: unknown;
};

export type StudioEditSnapshot = {
  fileId: string | null;
  fileName: string | null;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selectedPath: string | null;
  selectedKind: string | null;
  activeModelId: string;
  sourceLength: number;
  panels: {
    model: boolean;
    source: boolean;
    animTools: boolean;
    nodeParams: boolean;
  };
  /** Stable reminders for the assistant. Handles are tree paths, not xml ids. */
  toolHints: string[];
};

export type StudioEditBridge = {
  getSnapshot: () => StudioEditSnapshot;
  getSource: (opts?: {
    maxChars?: number;
    offset?: number;
  }) => {
    content: string;
    truncated: boolean;
    length: number;
    offset: number;
  };
  setSource: (content: string) => Promise<StudioEditToolResult>;
  replaceInSource: (opts: {
    find: string;
    replace: string;
    all?: boolean;
  }) => Promise<StudioEditToolResult>;
  save: () => Promise<StudioEditToolResult>;
  undo: () => Promise<StudioEditToolResult>;
  redo: () => Promise<StudioEditToolResult>;
  format: () => Promise<StudioEditToolResult>;
  optimize: () => Promise<StudioEditToolResult>;
  exportDocument: () => Promise<StudioEditToolResult>;
  exportPackage: () => Promise<StudioEditToolResult>;
  getSelection: () => StudioEditToolResult;
  selectPath: (path: string | null) => Promise<StudioEditToolResult>;
  readNodeAttrs: (path: string) => StudioEditToolResult;
  updateNodeAttrs: (
    path: string,
    updates: Record<string, string>
  ) => Promise<StudioEditToolResult>;
  addGroup: () => Promise<StudioEditToolResult>;
  addModel: () => Promise<StudioEditToolResult>;
  addMaterial: () => Promise<StudioEditToolResult>;
  addRootAnimate: () => Promise<StudioEditToolResult>;
  addStyleCategory: () => Promise<StudioEditToolResult>;
  addChild: (opts: {
    parentGroupId?: string;
    parentPath: string;
    kind: AddChildKind;
    href?: string;
    attrs?: Record<string, string>;
  }) => Promise<StudioEditToolResult>;
  addUse: (opts: {
    href?: string;
    modelId?: string;
  }) => Promise<StudioEditToolResult>;
  insertAtPath: (opts: {
    parentPath: string;
    kind: string;
    href?: string;
    attrs?: Record<string, string>;
  }) => Promise<StudioEditToolResult>;
  listNodes: (opts?: {
    scope?: "all" | "definitions" | "instances" | "materials";
    kind?: string;
    limit?: number;
  }) => StudioEditToolResult;
  findNodeById: (id: string) => StudioEditToolResult;
  getMaterial: (handle: string) => StudioEditToolResult;
  assignMaterial: (
    handle: string,
    materialId: string
  ) => Promise<StudioEditToolResult>;
  updateNodes: (
    edits: { handle: string; updates: Record<string, string> }[]
  ) => Promise<StudioEditToolResult>;
  capturePreview: (
    view: "current" | "front" | "side" | "top" | "iso"
  ) => Promise<StudioEditToolResult>;
  deleteAtPath: (path: string) => Promise<StudioEditToolResult>;
  setPanel: (
    panel: "model" | "source" | "animTools" | "nodeParams",
    visible: boolean
  ) => StudioEditToolResult;
};

let bridge: StudioEditBridge | null = null;

/** EditView registers while mounted; AI tools call through this bridge. */
export function registerStudioEditBridge(next: StudioEditBridge | null): void {
  bridge = next;
}

export function getStudioEditBridge(): StudioEditBridge | null {
  return bridge;
}

export function requireEditBridge(): StudioEditBridge | StudioEditToolResult {
  if (!bridge) {
    return {
      ok: false,
      message: "not on edit page — call go_edit first",
    };
  }
  return bridge;
}

export function isEditBridgeError(
  value: StudioEditBridge | StudioEditToolResult
): value is StudioEditToolResult {
  return !("getSnapshot" in value);
}
