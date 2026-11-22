import { watch, type Ref } from "vue";
import { isEvalNoopChange } from "@/utils/documentLoadKeys";

export type HostLoadOptions = {
  fitCamera?: boolean;
  documentBaseUrl?: string;
  documentAssetUrls?: Record<string, string>;
};

export type HostDocumentApi = {
  loadSvg(text: string, options?: HostLoadOptions): Promise<unknown>;
  applySvg(text: string, options?: HostLoadOptions): Promise<unknown>;
  /** InteractHost: keep XML for path lookups even on noop loads. */
  setDocument?(text: string): void;
  /** True when the 3D root has children (used for fit-once). */
  hasSceneContent(): boolean;
};

/**
 * Shared content / asset / base-URL load policy for ViewerHost and InteractHost.
 */
export function useHostDocumentLoad(options: {
  content: Ref<string> | (() => string);
  documentBaseUrl: Ref<string | undefined> | (() => string | undefined);
  documentAssetUrls:
    | Ref<Record<string, string> | undefined>
    | (() => Record<string, string> | undefined);
  getApi: () => HostDocumentApi | null;
  onError?: (message: string) => void;
  afterLoad?: () => void;
}) {
  let loadSeq = 0;
  let lastContent = "";
  let hasFitted = false;

  function readContent(): string {
    const c = options.content;
    return typeof c === "function" ? c() : c.value;
  }

  function readBaseUrl(): string | undefined {
    const b = options.documentBaseUrl;
    return typeof b === "function" ? b() : b.value;
  }

  function readAssetUrls(): Record<string, string> | undefined {
    const a = options.documentAssetUrls;
    return typeof a === "function" ? a() : a.value;
  }

  async function loadContent(
    text: string,
    opts: { soft?: boolean; skip?: boolean } = {}
  ): Promise<void> {
    const seq = ++loadSeq;
    try {
      const api = options.getApi();
      if (!api || seq !== loadSeq) return;
      if (!text.trim()) return;
      api.setDocument?.(text);
      if (opts.skip) {
        lastContent = text;
        return;
      }
      const fit = !hasFitted;
      const loadOpts: HostLoadOptions = {
        fitCamera: fit,
        documentBaseUrl: readBaseUrl(),
        documentAssetUrls: readAssetUrls(),
      };
      if (opts.soft) {
        await api.applySvg(text, loadOpts);
      } else {
        await api.loadSvg(text, loadOpts);
      }
      if (seq !== loadSeq) return;
      if (fit && api.hasSceneContent()) {
        hasFitted = true;
      }
      lastContent = text;
      options.afterLoad?.();
    } catch (e) {
      options.onError?.(e instanceof Error ? e.message : String(e));
    }
  }

  function watchContent(): void {
    watch(
      () => readContent(),
      (text, prev) => {
        const from = typeof prev === "string" ? prev : lastContent;
        if (text === from) return;
        if (isEvalNoopChange(from, text)) {
          void loadContent(text, { skip: true });
          return;
        }
        // Always soft-rebind for in-session edits (transform / attrs / style).
        // Hard loadSvg was clearing studio extraDefs and made 定义集 solids
        // vanish until the tree selection was clicked again.
        void loadContent(text, { soft: true });
      }
    );
  }

  function watchAssetsAndBase(): void {
    watch(
      () => readAssetUrls(),
      () => {
        if (!options.getApi() || !readContent()) return;
        // Sidecar map often arrives after first mount (file switch) — re-fit
        // so the camera is not stuck on an empty / wrong first bind.
        hasFitted = false;
        void loadContent(readContent(), { soft: true });
      },
      { deep: true }
    );
    watch(
      () => readBaseUrl(),
      () => {
        if (!options.getApi() || !readContent()) return;
        hasFitted = false;
        void loadContent(readContent(), { soft: true });
      }
    );
  }

  async function reloadHard(): Promise<void> {
    const api = options.getApi();
    const text = readContent();
    if (!api || !text) return;
    hasFitted = false;
    await api.loadSvg(text, {
      fitCamera: true,
      documentBaseUrl: readBaseUrl(),
      documentAssetUrls: readAssetUrls(),
    });
    if (api.hasSceneContent()) hasFitted = true;
    lastContent = text;
    options.afterLoad?.();
  }

  function resetFit(): void {
    hasFitted = false;
  }

  return {
    loadContent,
    watchContent,
    watchAssetsAndBase,
    reloadHard,
    resetFit,
    getLastContent: () => lastContent,
  };
}
