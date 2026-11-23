/**
 * Copy the maintained public API typings into dist-lib/index.d.ts.
 * (vue SFC + path aliases make vite-plugin-dts output unsuitable for publish.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src/lib/public-api.d.ts");
const destDir = path.join(root, "dist-lib");
const dest = path.join(destDir, "index.d.ts");

if (!fs.existsSync(destDir)) {
  console.error("dist-lib missing — run vite build:lib first");
  process.exit(1);
}

fs.copyFileSync(src, dest);

// Drop accidental publicDir assets / nested dts trees from earlier builds.
for (const name of ["favicon.png", "logo.png", "svg3dx-studio"]) {
  const p = path.join(destDir, name);
  if (!fs.existsSync(p)) continue;
  fs.rmSync(p, { recursive: true, force: true });
}

console.log(`wrote ${path.relative(root, dest)}`);
