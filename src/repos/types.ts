/**
 * Pluggable persistence + navigation for embeddable Studio pages.
 * Vendors implement these against DB / FTP / local APIs; the SPA uses IndexedDB defaults.
 */

/** Document metadata + SVG/XML body (aligned with legacy StudioFile). */
export interface StudioDocument {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
  dirty?: boolean;
  /** Base URL for resolving relative `s3dx:gltf` hrefs (e.g. official samples). */
  documentBaseUrl?: string;
  /** Vendor-specific metadata (ignored by core editor logic). */
  meta?: Record<string, unknown>;
}

export interface DocumentRepository {
  list(): Promise<StudioDocument[]>;
  get(id: string): Promise<StudioDocument | null>;
  save(doc: StudioDocument): Promise<StudioDocument>;
  remove(id: string): Promise<void>;
  /** Optional: persist last-selected document id. */
  getActiveId?(): Promise<string | null> | string | null;
  setActiveId?(id: string | null): Promise<void> | void;
  /** Optional bulk wipe (default IndexedDB implements this). */
  clearAll?(): Promise<void>;
}

export type AssetListItem = {
  path: string;
  mime?: string;
};

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
};
