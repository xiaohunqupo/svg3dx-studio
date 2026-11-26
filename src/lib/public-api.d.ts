/**
 * Ambient public API for `svg3dx-studio` (copied to dist-lib/index.d.ts).
 * Vue SFCs are typed as DefineComponent; hosts get IntelliSense for install + repos.
 */
import type { App, DefineComponent, Plugin, Ref } from "vue";

export type StudioDocument = {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
  documentBaseUrl?: string;
  meta?: Record<string, unknown>;
};

/** @deprecated Prefer StudioDocument */
export type StudioFile = StudioDocument;

export type AssetListItem = { path: string; mime?: string };

export interface DocumentRepository {
  list(): Promise<StudioDocument[]>;
  get(id: string): Promise<StudioDocument | null>;
  save(doc: StudioDocument): Promise<StudioDocument>;
  remove(id: string): Promise<void>;
  getActiveId?(): Promise<string | null> | string | null;
  setActiveId?(id: string | null): Promise<void> | void;
  clearAll?(): Promise<void>;
}

export interface AssetRepository {
  list(fileId: string): Promise<AssetListItem[]>;
  read(fileId: string, path: string): Promise<Blob | null>;
  write(
    fileId: string,
    path: string,
    blob: Blob,
    mime?: string
  ): Promise<void>;
  removeAll(fileId: string): Promise<void>;
}

export interface StudioNavigation {
  goBrowse(): void;
  goEdit(id: string): void;
}

export type InstallStudioOptions = {
  documents?: DocumentRepository;
  assets?: AssetRepository;
  navigation?: StudioNavigation;
  /**
   * Built-in Copilot AI (tools + chrome). **Default `true`.**
   * Host kill-switch: set `false` when embedding with your own assistant.
   * Pages default on; use `:show-ai-assistant="false"` to hide chrome on one page.
   */
  showAiAssistant?: boolean;
};

export type StudioRuntime = {
  documents: DocumentRepository;
  assets: AssetRepository;
  navigation: StudioNavigation;
  showAiAssistant: boolean;
};

export declare const STUDIO_DOCUMENTS_KEY: unique symbol;
export declare const STUDIO_ASSETS_KEY: unique symbol;
export declare const STUDIO_NAVIGATION_KEY: unique symbol;

export declare function installStudio(
  app: App,
  options?: InstallStudioOptions
): App;
export declare const studioPlugin: Plugin<InstallStudioOptions>;

export declare function configureStudio(
  options?: InstallStudioOptions
): StudioRuntime;
export declare function getStudioRuntime(): StudioRuntime;
export declare function getDocumentRepository(): DocumentRepository;
export declare function getAssetRepository(): AssetRepository;
export declare function getStudioNavigation(): StudioNavigation;
export declare function createFileId(): string;
export declare function createIndexedDbDocumentRepository(): DocumentRepository;
export declare function createIndexedDbAssetRepository(): AssetRepository;

export declare function useStudioNavigation(): StudioNavigation;
export declare function useDocumentAssets(fileId: Ref<string | null | undefined>): {
  documentAssetUrls: Ref<Record<string, string>>;
  refreshDocumentAssetUrls: () => Promise<void>;
  clearDocumentAssetUrls: () => void;
  pickAndAttachGltf: () => Promise<string | null>;
  listReferencedAssets: (content: string) => Promise<
    Array<{
      key: string;
      fileId: string;
      path: string;
      mime: string;
      blob: Blob;
      updatedAt: number;
    }>
  >;
};
export declare function useFilesStore(): unknown;
export declare function useChatStore(): unknown;

export declare const BrowsePage: DefineComponent<
  {
    showOfficialSamples?: boolean;
    showReposMenu?: boolean;
    showSettingsMenu?: boolean;
    showAiAssistant?: boolean;
  },
  object,
  unknown
>;
export declare const EditPage: DefineComponent<
  {
    id: string;
    showReposMenu?: boolean;
    showSettingsMenu?: boolean;
    showAiAssistant?: boolean;
  },
  object,
  unknown
>;

export declare const ViewerHost: DefineComponent<object, object, unknown>;
export declare const InteractHost: DefineComponent<object, object, unknown>;
export declare const FileListPanel: DefineComponent<object, object, unknown>;
export declare const FileDropZone: DefineComponent<object, object, unknown>;
export declare const NodeTreePanel: DefineComponent<object, object, unknown>;
export declare const NodeInspectorPanel: DefineComponent<object, object, unknown>;
export declare const SourceEditorPanel: DefineComponent<object, object, unknown>;
export declare const AppMenus: DefineComponent<object, object, unknown>;
export declare const SettingsMenu: DefineComponent<object, object, unknown>;
export declare const ReposMenu: DefineComponent<object, object, unknown>;
export declare const AiChatPanel: DefineComponent<object, object, unknown>;

export type TransformMode = string;
export type DrillCrumb = unknown;
export type TransformCommitPayload = unknown;
export type CreateInteractOptions = Record<string, unknown>;
export declare class InteractViewport {
  readonly viewer: unknown;
  dispose(): void;
}
export declare function createInteract(
  el: HTMLElement,
  options?: CreateInteractOptions
): Promise<InteractViewport>;

export type AddChildKind = string;
export type GeometryKind = string;
export type ContainerKind = string;

export declare function downloadBlob(filename: string, blob: Blob): void;
export declare function downloadText(filename: string, content: string): void;
export declare function defaultAssetHref(fileName: string): string;
export declare function normalizeAssetPath(path: string): string;
export declare function isGltfFileName(name: string): boolean;
export declare function putDocumentAsset(
  fileId: string,
  path: string,
  file: Blob,
  mime?: string
): Promise<string>;
export declare function ingestPackageAssets(
  fileId: string,
  assets: Array<{ path: string; bytes: Uint8Array | ArrayBuffer | Blob }>
): Promise<void>;

export {};
