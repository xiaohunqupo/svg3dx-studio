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
const svg3dxRoot = process.env.SVG3DX_ROOT
  ? path.resolve(process.env.SVG3DX_ROOT)
  : path.resolve(studioRoot, "../svg3dx");

function resolveSamplePath(): string | null {
  const candidates = [
    path.join(svg3dxRoot, "samples", "draft-0.1-example.svg3dx"),
    path.join(svg3dxRoot, "samples", "draft-0.1-example.svg"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

// GitHub Pages project site: https://<user>.github.io/svg3dx-studio/
// Local / custom hosts: leave unset (defaults to "/").
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [
    vue(),
    wasm(),
    AutoImport({
      resolvers: [TDesignResolver({ library: "vue-next" })],
      dts: "src/auto-imports.d.ts",
    }),
    Components({
      resolvers: [TDesignResolver({ library: "vue-next" })],
      dts: "src/components.d.ts",
    }),
    {
      name: "svg3dx-sample-api",
      configureServer(server) {
        const samplesDir = path.join(svg3dxRoot, "samples");
        server.middlewares.use("/api/sample", (_req, res) => {
          const sample = resolveSamplePath();
          if (!sample) {
            res.statusCode = 404;
            res.end(
              JSON.stringify({
                error: `missing sample under ${samplesDir}`,
              })
            );
            return;
          }
          res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
          fs.createReadStream(sample).pipe(res);
        });
        // Local loose `.svg3dx` + relative `assets/*.glb` during `vite dev`.
        server.middlewares.use("/svg3dx-samples", (req, res, next) => {
          const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
          const filePath = path.normalize(path.join(samplesDir, rel));
          if (!filePath.startsWith(samplesDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.statusCode = 404;
            res.end("not found");
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          const type =
            ext === ".glb"
              ? "model/gltf-binary"
              : ext === ".gltf"
                ? "model/gltf+json"
                : ext === ".svg" || ext === ".svg3dx"
                  ? "image/svg+xml; charset=utf-8"
                  : "application/octet-stream";
          res.setHeader("Content-Type", type);
          fs.createReadStream(filePath).pipe(res);
        });

      },
    },
  ],
  resolve: {
    alias: {
      "@": path.join(studioRoot, "src"),
      "svg3dx-viewer": path.join(viewerRoot, "src/index.ts"),
      "svg3dx-ffi-wasm": path.join(coreRoot, "pkg/svg3dx_ffi_wasm.js"),
    },
  },
  server: {
    fs: { allow: [studioRoot, viewerRoot, coreRoot, svg3dxRoot] },
    // CopilotKit Runtime (`npm run copilot`) — chat + LLM settings API.
    proxy: {
      "/api/copilotkit": {
        target: "http://127.0.0.1:8200",
        changeOrigin: true,
      },
      "/api/studio-llm-config": {
        target: "http://127.0.0.1:8200",
        changeOrigin: true,
      },
    },
  },
  build: { target: "esnext" },
  optimizeDeps: {
    exclude: ["svg3dx-ffi-wasm"],
  },
});
