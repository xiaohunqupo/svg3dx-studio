<p align="center">
  <img src="assets/title.png" alt="svg 3dx studio" width="360"/>
</p>

# svg3dx-studio

[中文](README.zh-CN.md) | English

**svg3dx editor**: Vite + Vue 3 + TDesign + three.js. Open / cache local files, browse previews, enter the edit page to add solids, and save.

Rendering and the params panel reuse [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer).

Viewport layers (all in this repo — not separate packages):

| Layer | Role |
|-------|------|
| `ViewerHost` + `svg3dx-viewer` | Browse page: lightweight display (no click-to-select) |
| `InteractHost` + `src/interact` | Edit page: pick / highlight and other viewport interaction (not document editing itself) |

## Related libraries

| Repository | Role |
|------------|------|
| [svg3dx](https://github.com/xiaohunqupo/svg3dx) | Format specification and samples |
| [svg3dx-core](https://github.com/xiaohunqupo/svg3dx-core) | Parse / evaluate engine |
| [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer) | Viewer component |
| **svg3dx-studio** (this repo) | Editor application |

## Develop

Sibling checkouts: `svg3dx`, `svg3dx-core`, `svg3dx-viewer`, and this repo.

One-shot stack build (core tests + wasm → viewer → studio):

```powershell
cd ..\svg3dx-studio
npm run build:all          # full artifacts (includes studio dist)
npm run build:all:dev      # stop after viewer, then npm run dev
npm run build:all:full     # also build core C DLL / header / dump_json
```

Manual steps:

```powershell
# 1) engine wasm
cd ..\svg3dx-core
wasm-pack build crates/svg3dx-ffi-wasm --target bundler --out-dir pkg --out-name svg3dx_ffi_wasm

# 2) editor
cd ..\svg3dx-studio
npm install
npm run dev
```

## CI / GitHub Pages

GitHub Actions (`.github/workflows/ci.yml`) on `main` / PR:

1. Checkout sibling `svg3dx-core`, `svg3dx-viewer`, `svg3dx`
2. `wasm-pack` → core `pkg/`
3. `npm ci` in viewer + studio, then `npm run build` (vue-tsc + Vite; `VITE_BASE=/svg3dx-studio/`)
4. Upload `dist` artifact; on `main` also deploy to GitHub Pages

Live: https://xiaohunqupo.github.io/svg3dx-studio/

## App routes

### Browse (`/`)

- No cached files: centered drag / click drop zone
- With files: left file list + center viewer preview; drag to append more
- 「编辑」next to a filename opens the edit page; top bar can load official samples

### Edit (`/edit/:id`)

- Top: back to browse, add-solid menu, save / export
- Left: evaluated Models / Geometry tree
- Center: `InteractHost` viewport (interaction layer on top of viewer)
- Right: external params + selected-node JSON
- Save writes to browser IndexedDB local cache

## License

MIT OR MulanPSL-2.0.
