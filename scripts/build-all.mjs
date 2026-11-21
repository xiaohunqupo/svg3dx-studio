/**
 * One-shot local stack build (sibling layout):
 *   svg3dx-core → svg3dx-viewer → svg3dx-studio
 *
 * Usage (from svg3dx-studio):
 *   node scripts/build-all.mjs
 *   npm run build:all
 *
 * Flags:
 *   --skip-tests   skip `cargo test -p svg3dx-core`
 *   --full-core    also build C DLL + header + dump_json (cmake)
 *   --dev          stop after core wasm + viewer lib (for `npm run dev`)
 *
 * Env:
 *   SVG3DX_CORE_ROOT / SVG3DX_VIEWER_ROOT  override sibling paths
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(here, "..");
const args = new Set(process.argv.slice(2));
const skipTests = args.has("--skip-tests");
const fullCore = args.has("--full-core");
const devOnly = args.has("--dev");

const coreRoot = process.env.SVG3DX_CORE_ROOT
  ? path.resolve(process.env.SVG3DX_CORE_ROOT)
  : path.resolve(studioRoot, "../svg3dx-core");
const viewerRoot = process.env.SVG3DX_VIEWER_ROOT
  ? path.resolve(process.env.SVG3DX_VIEWER_ROOT)
  : path.resolve(studioRoot, "../svg3dx-viewer");

const cargoBin = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".cargo",
  "bin"
);
const pathEnv = [cargoBin, process.env.Path || process.env.PATH || ""]
  .filter(Boolean)
  .join(path.delimiter);

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function step(n, total, title) {
  console.log(`\n==> [${n}/${total}] ${title}`);
}

function run(cmd, cmdArgs, cwd, env = {}) {
  console.log(`    $ ${cmd} ${cmdArgs.join(" ")}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, Path: pathEnv, PATH: pathEnv, ...env },
  });
  if ((r.status ?? 1) !== 0) {
    fail(`${cmd} failed (exit ${r.status ?? "?"}) in ${cwd}`);
  }
}

function requireDir(root, label) {
  if (!fs.existsSync(root)) {
    fail(`${label} not found: ${root}`);
  }
}

requireDir(coreRoot, "svg3dx-core");
requireDir(viewerRoot, "svg3dx-viewer");
requireDir(path.join(coreRoot, "crates", "svg3dx-ffi-wasm"), "svg3dx-ffi-wasm crate");

const total = fullCore ? (devOnly ? 5 : 6) : (devOnly ? 3 : 4);
let n = 0;
const next = (title) => step(++n, total, title);

const coreTarget = path.join(coreRoot, "target");
const coreEnv = { CARGO_TARGET_DIR: coreTarget };

console.log("svg3dx local stack build");
console.log(`  core:   ${coreRoot}`);
console.log(`  viewer: ${viewerRoot}`);
console.log(`  studio: ${studioRoot}`);
console.log(
  `  flags:  ${[
    skipTests ? "skip-tests" : null,
    fullCore ? "full-core" : null,
    devOnly ? "dev" : null,
  ]
    .filter(Boolean)
    .join(", ") || "(default)"}`
);

// --- 1) core tests ---
if (!skipTests) {
  next("svg3dx-core: cargo test");
  run("cargo", ["test", "-p", "svg3dx-core"], coreRoot, coreEnv);
} else {
  console.log("\n(skip) svg3dx-core tests");
}

// --- 2) optional full core (DLL / header / dump_json) ---
if (fullCore) {
  next("svg3dx-core: release C ABI DLL");
  run("cargo", ["build", "-p", "svg3dx-ffi-c", "--release"], coreRoot, coreEnv);
  const dll = path.join(coreRoot, "target", "release", "svg3dx_core.dll");
  const so = path.join(coreRoot, "target", "release", "libsvg3dx_core.so");
  if (!fs.existsSync(dll) && !fs.existsSync(so)) {
    fail(`release library not found under ${path.join(coreRoot, "target", "release")}`);
  }

  next("svg3dx-core: cbindgen header");
  run(
    "powershell",
    ["-ExecutionPolicy", "Bypass", "-File", ".\\scripts\\generate-c-header.ps1"],
    coreRoot
  );

  next("svg3dx-core: dump_json (cmake)");
  const buildDir = path.join(coreRoot, "cpp", "build");
  fs.mkdirSync(buildDir, { recursive: true });
  run("cmake", ["-S", "cpp", "-B", "cpp/build"], coreRoot);
  run("cmake", ["--build", "cpp/build", "--config", "Release"], coreRoot);
}

// --- 3) core wasm (required by viewer/studio) ---
next("svg3dx-core: wasm-pack → pkg/");
run("rustup", ["target", "add", "wasm32-unknown-unknown"], coreRoot);
run(
  "wasm-pack",
  [
    "build",
    path.join(coreRoot, "crates", "svg3dx-ffi-wasm"),
    "--target",
    "bundler",
    "--out-dir",
    path.join(coreRoot, "pkg"),
    "--out-name",
    "svg3dx_ffi_wasm",
  ],
  coreRoot,
  coreEnv
);

// --- 4) viewer library (wasm already built) ---
next("svg3dx-viewer: tsc (build:lib)");
run("npm", ["run", "build:lib"], viewerRoot);

if (devOnly) {
  console.log("\n✓ stack ready for development.");
  console.log(`  cd ${studioRoot}`);
  console.log("  npm run dev");
  process.exit(0);
}

// --- 5) studio production build ---
next("svg3dx-studio: vue-tsc + vite build");
run("npm", ["run", "build"], studioRoot);

console.log("\n✓ done.");
console.log(`  studio dist: ${path.join(studioRoot, "dist")}`);
console.log(`  core wasm:   ${path.join(coreRoot, "pkg")}`);
if (fullCore) {
  console.log(`  core DLL:    ${path.join(coreRoot, "target", "release")}`);
}
