/**
 * Library build: ESM + CSS for vendor hosts.
 * App / Pages build stays in vite.config.ts.
 * Types: `scripts/copy-lib-dts.mjs` copies `src/lib/public-api.d.ts` → dist-lib/index.d.ts.
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import wasm from "vite-plugin-wasm";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { TDesignResolver } from "@tdesign-vue-next/auto-import-resolver";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = path.dirname(fileURLToPath(import.meta.url));
const viewerRoot = path.resolve(studioRoot, "../svg3dx-viewer");
const coreRoot = process.env.SVG3DX_CORE_ROOT
  ? path.resolve(process.env.SVG3DX_CORE_ROOT)
  : path.resolve(studioRoot, "../svg3dx-core");

const pkg = JSON.parse(
  fs.readFileSync(path.join(studioRoot, "package.json"), "utf8")
) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const externalPkgs = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
]);

function isExternal(id: string): boolean {
  if (id.startsWith("\0")) return false;
  if (id.startsWith(".") || path.isAbsolute(id)) return false;
  if (id.startsWith("@/") || id.includes(`${path.sep}src${path.sep}`)) {
    return false;
  }
  for (const name of externalPkgs) {
    if (id === name || id.startsWith(`${name}/`)) return true;
  }
  if (
    id.startsWith("tdesign-vue-next/") ||
    id.startsWith("tdesign-icons-vue-next/") ||
    id.startsWith("@codemirror/") ||
    id.startsWith("svg3dx-viewer/") ||
    id.startsWith("svg3dx-ffi-wasm")
  ) {
    return true;
  }
  return false;
}

/** Absolute `/logo.png` is served from `public/` in the SPA; stub it for lib bundles. */
function stubPublicAssets() {
  const stubId = "\0svg3dx-studio-public-asset";
  return {
    name: "svg3dx-studio-stub-public-assets",
    resolveId(id: string) {
      if (id === "/logo.png" || id === "/favicon.png") return stubId;
      return null;
    },
    load(id: string) {
      if (id === stubId) return 'export default "";';
      return null;
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [
    stubPublicAssets(),
    vue(),
    wasm(),
    AutoImport({
      resolvers: [TDesignResolver({ library: "vue-next" })],
      dts: false,
    }),
    Components({
      resolvers: [TDesignResolver({ library: "vue-next" })],
      dts: false,
    }),
  ],
  resolve: {
    alias: {
      "@": path.join(studioRoot, "src"),
      "svg3dx-viewer": path.join(viewerRoot, "src/index.ts"),
      "svg3dx-ffi-wasm": path.join(coreRoot, "pkg/svg3dx_ffi_wasm.js"),
    },
  },
  build: {
    target: "esnext",
    outDir: "dist-lib",
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    lib: {
      entry: path.join(studioRoot, "src/lib/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: isExternal,
      output: {
        assetFileNames: (info) =>
          info.name && info.name.endsWith(".css")
            ? "style.css"
            : "assets/[name][extname]",
        preserveModules: false,
      },
    },
  },
  optimizeDeps: {
    exclude: ["svg3dx-ffi-wasm"],
  },
});
