import type { App, InjectionKey } from "vue";
import {
  createIndexedDbAssetRepository,
  createIndexedDbDocumentRepository,
} from "./indexedDb";
import type {
  AssetRepository,
  DocumentRepository,
  InstallStudioOptions,
  StudioNavigation,
} from "./types";

export type StudioRuntime = {
  documents: DocumentRepository;
  assets: AssetRepository;
  navigation: StudioNavigation;
};

export const STUDIO_DOCUMENTS_KEY: InjectionKey<DocumentRepository> =
  Symbol("svg3dx.studio.documents");
export const STUDIO_ASSETS_KEY: InjectionKey<AssetRepository> = Symbol(
  "svg3dx.studio.assets"
);
export const STUDIO_NAVIGATION_KEY: InjectionKey<StudioNavigation> = Symbol(
  "svg3dx.studio.navigation"
);

const noopNav: StudioNavigation = {
  goBrowse() {
    /* host must supply navigation when embedding */
  },
  goEdit() {
    /* host must supply navigation when embedding */
  },
};

let runtime: StudioRuntime | null = null;

/** Configure repositories + navigation (also called from installStudio). */
export function configureStudio(options: InstallStudioOptions = {}): StudioRuntime {
  runtime = {
    documents: options.documents ?? createIndexedDbDocumentRepository(),
    assets: options.assets ?? createIndexedDbAssetRepository(),
    navigation: options.navigation ?? noopNav,
  };
  return runtime;
}

export function getStudioRuntime(): StudioRuntime {
  if (!runtime) return configureStudio();
  return runtime;
}

export function getDocumentRepository(): DocumentRepository {
  return getStudioRuntime().documents;
}

export function getAssetRepository(): AssetRepository {
  return getStudioRuntime().assets;
}

export function getStudioNavigation(): StudioNavigation {
  return getStudioRuntime().navigation;
}

/** Provide runtime on a Vue app (used by installStudio). */
export function provideStudioRuntime(
  app: App,
  options: InstallStudioOptions = {}
): StudioRuntime {
  const rt = configureStudio(options);
  app.provide(STUDIO_DOCUMENTS_KEY, rt.documents);
  app.provide(STUDIO_ASSETS_KEY, rt.assets);
  app.provide(STUDIO_NAVIGATION_KEY, rt.navigation);
  return rt;
}
