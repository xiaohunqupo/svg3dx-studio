<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import {
  createViewer,
  type EmbedViewer,
  type EvaluationResult,
} from "svg3dx-viewer";
import { useHostDocumentLoad } from "@/composables/useHostDocumentLoad";
import { useI18n } from "@/i18n";
import { useTheme } from "@/theme";
import { readViewportBackground } from "@/utils/viewportTheme";

const props = withDefaults(
  defineProps<{
    content: string;
    /** Prefer this `s3dx:model` id when evaluating / displaying. */
    model?: string;
    paramsEl?: HTMLElement | null;
    /** Override scene background; default follows TDesign `--td-bg-color-page`. */
    background?: number | string;
    /** Base URL for relative `s3dx:gltf` hrefs. */
    documentBaseUrl?: string;
    /** Local sidecar map: relative href → blob URL. */
    documentAssetUrls?: Record<string, string>;
  }>(),
  {
    model: undefined,
    paramsEl: null,
    background: undefined,
    documentBaseUrl: undefined,
    documentAssetUrls: undefined,
  }
);

const { colorScheme } = useTheme();
const { locale } = useI18n();

const emit = defineEmits<{
  result: [EvaluationResult];
  error: [string];
  ready: [EmbedViewer];
}>();

const host = ref<HTMLElement | null>(null);
let embed: EmbedViewer | null = null;

function resolveBackground(): number | string {
  return props.background ?? readViewportBackground();
}

function syncBackground(): void {
  embed?.setBackground(resolveBackground());
}

async function ensureViewer(): Promise<EmbedViewer | null> {
  if (embed) return embed;
  if (!host.value) return null;
  embed = await createViewer(host.value, {
    paramsEl: props.paramsEl ?? undefined,
    background: resolveBackground(),
    model: props.model,
    locale: locale.value,
    onResult: (r) => emit("result", r),
    onWarnings: (w) => w.forEach((m) => console.warn("[svg3dx]", m)),
  });
  emit("ready", embed);
  return embed;
}

const docLoad = useHostDocumentLoad({
  content: toRef(props, "content"),
  documentBaseUrl: toRef(props, "documentBaseUrl"),
  documentAssetUrls: toRef(props, "documentAssetUrls"),
  getApi: () =>
    embed
      ? {
          loadSvg: (text, opts) => embed!.loadSvg(text, opts),
          applySvg: (text, opts) => embed!.applySvg(text, opts),
          hasSceneContent: () => embed!.viewer.root.children.length > 0,
        }
      : null,
  onError: (message) => emit("error", message),
});

async function loadContent(
  text: string,
  options: { soft?: boolean; skip?: boolean } = {}
): Promise<void> {
  await ensureViewer();
  await docLoad.loadContent(text, options);
}

onMounted(() => {
  void loadContent(props.content);
});

docLoad.watchContent();
docLoad.watchAssetsAndBase();

watch(
  () => props.model,
  (model) => {
    if (!embed) return;
    void embed.setModel(model || undefined, { fitCamera: true });
  }
);

watch(
  [colorScheme, () => props.background],
  () => {
    syncBackground();
  }
);

watch(locale, (loc) => {
  embed?.setLocale(loc);
});

onBeforeUnmount(() => {
  embed?.dispose();
  embed = null;
});

defineExpose({
  async reload() {
    await ensureViewer();
    await docLoad.reloadHard();
  },
  getResult(): EvaluationResult | null {
    return embed?.getResult() ?? null;
  },
  getViewer(): EmbedViewer | null {
    return embed;
  },
});
</script>

<template>
  <div ref="host" class="viewer-host" />
</template>

<style scoped>
.viewer-host {
  width: 100%;
  height: 100%;
  min-height: 240px;
  position: relative;
  overflow: hidden;
}
</style>
