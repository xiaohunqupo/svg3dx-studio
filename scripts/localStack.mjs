/**
 * Local sibling stack (core / viewer) vs npm packages.
 *
 * - CI / Cloudflare / plain `npm run build|dev`: resolve `svg3dx-viewer` from node_modules.
 * - `npm run build:all` (and `*:local` scripts): set SVG3DX_USE_LOCAL=1 and alias to siblings.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function useLocalStack() {
  return process.env.SVG3DX_USE_LOCAL === "1";
}

export function studioPaths(studio = studioRoot) {
  const viewerRoot = process.env.SVG3DX_VIEWER_ROOT
    ? path.resolve(process.env.SVG3DX_VIEWER_ROOT)
    : path.resolve(studio, "../svg3dx-viewer");
  const coreRoot = process.env.SVG3DX_CORE_ROOT
    ? path.resolve(process.env.SVG3DX_CORE_ROOT)
    : path.resolve(studio, "../svg3dx-core");
  const svg3dxRoot = process.env.SVG3DX_ROOT
    ? path.resolve(process.env.SVG3DX_ROOT)
    : path.resolve(studio, "../svg3dx");
  return { studioRoot: studio, viewerRoot, coreRoot, svg3dxRoot };
}

/** Vite `resolve.alias` entries for `@` plus optional local viewer/wasm. */
export function resolveAliases(studio = studioRoot) {
  const { viewerRoot, coreRoot } = studioPaths(studio);
  /** @type {Record<string, string>} */
  const alias = {
    "@": path.join(studio, "src"),
  };
  if (useLocalStack()) {
    const viewerEntry = path.join(viewerRoot, "src/index.ts");
    const wasmEntry = path.join(coreRoot, "pkg/svg3dx_ffi_wasm.js");
    if (!fs.existsSync(viewerEntry)) {
      throw new Error(
        `[svg3dx-studio] SVG3DX_USE_LOCAL=1 but viewer entry missing: ${viewerEntry}`
      );
    }
    if (!fs.existsSync(wasmEntry)) {
      throw new Error(
        `[svg3dx-studio] SVG3DX_USE_LOCAL=1 but wasm pkg missing: ${wasmEntry}\n` +
          `Run \`npm run build:all\` (or wasm-pack) first.`
      );
    }
    alias["svg3dx-viewer"] = viewerEntry;
    alias["svg3dx-ffi-wasm"] = wasmEntry;
  }
  return alias;
}

/** Run a command with SVG3DX_USE_LOCAL=1 (for build:all / *:local scripts). */
export function runWithLocalStack(argv) {
  if (!argv.length) {
    console.error("usage: node scripts/with-local-stack.mjs <command> [args...]");
    process.exit(1);
  }
  const env = { ...process.env, SVG3DX_USE_LOCAL: "1" };
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd, args, {
    cwd: studioRoot,
    stdio: "inherit",
    shell: true,
    env,
  });
  process.exit(r.status ?? 1);
}
