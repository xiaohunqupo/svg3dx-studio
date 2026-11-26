/**
 * svg3dx-studio public API — Vue page library for vendor hosts.
 *
 * @example
 * ```ts
 * import { installStudio, BrowsePage, EditPage, AiChatPanel } from "svg3dx-studio";
 * import "svg3dx-studio/style.css";
 * // Hosts with their own AI: installStudio(app, { …, showAiAssistant: false })
 * installStudio(app, { documents, assets, navigation });
 * // When showAiAssistant is true, also mount <AiChatPanel /> at the app root
 * // and import "@copilotkit/vue/styles.css".
 * ```
 */

import "./style.css";

export { installStudio, studioPlugin } from "./installStudio";
export type { InstallStudioOptions } from "./installStudio";

export type {
  AssetListItem,
  AssetRepository,
  DocumentRepository,
  StudioDocument,
  StudioNavigation,
} from "@/repos/types";
export {
  STUDIO_ASSETS_KEY,
  STUDIO_DOCUMENTS_KEY,
  STUDIO_NAVIGATION_KEY,
  configureStudio,
  createFileId,
  createIndexedDbAssetRepository,
  createIndexedDbDocumentRepository,
  getAssetRepository,
  getDocumentRepository,
  getStudioNavigation,
  getStudioRuntime,
} from "@/repos";

export { useStudioNavigation } from "@/composables/useStudioNavigation";
export { useDocumentAssets } from "@/composables/useDocumentAssets";
export { useFilesStore } from "@/stores/files";
export { useChatStore } from "@/stores/chat";

export { default as BrowsePage } from "@/views/BrowseView.vue";
export { default as EditPage } from "@/views/EditView.vue";

export { default as ViewerHost } from "@/components/ViewerHost.vue";
export { default as InteractHost } from "@/components/InteractHost.vue";
export { default as FileListPanel } from "@/components/FileListPanel.vue";
export { default as FileDropZone } from "@/components/FileDropZone.vue";
export { default as NodeTreePanel } from "@/components/NodeTreePanel.vue";
export { default as NodeInspectorPanel } from "@/components/NodeInspectorPanel.vue";
export { default as SourceEditorPanel } from "@/components/SourceEditorPanel.vue";
export { default as AppMenus } from "@/components/AppMenus.vue";
export { default as SettingsMenu } from "@/components/SettingsMenu.vue";
export { default as ReposMenu } from "@/components/ReposMenu.vue";
/** Mount once at app root when Studio AI is enabled (`showAiAssistant`). */
export { default as AiChatPanel } from "@/components/AiChatPanel.vue";

export {
  createInteract,
  InteractViewport,
  type CreateInteractOptions,
  type DrillCrumb,
  type TransformCommitPayload,
  type TransformMode,
} from "@/interact";

export type {
  StudioFile,
  AddChildKind,
  GeometryKind,
  ContainerKind,
  AnimationKind,
} from "@/types/file";
export { downloadBlob, downloadText } from "@/utils/storage";
export {
  defaultAssetHref,
  ingestPackageAssets,
  isGltfFileName,
  putDocumentAsset,
  normalizeAssetPath,
} from "@/utils/documentAssets";
