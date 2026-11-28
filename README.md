<p align="center">
  <img src="assets/title.png" alt="svg 3dx studio" width="360"/>
</p>

# svg3dx-studio

[中文](README.zh-CN.md) | English

**svg3dx Studio**: embeddable Vue page library (browse / edit) plus a demo SPA. Vite + Vue 3 + TDesign + three.js.

Rendering and the params panel reuse [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer).

| Layer | Role |
|-------|------|
| `ViewerHost` + `svg3dx-viewer` | Browse preview (no click-to-select) |
| `InteractHost` + `createInteract` | Edit viewport: pick / highlight / transform |
| `BrowsePage` / `EditPage` | Full page templates (slot-customizable) |
| `DocumentRepository` / `AssetRepository` | Pluggable document + sidecar storage |

## Related libraries

| Repository | Role |
|------------|------|
| [svg3dx](https://github.com/xiaohunqupo/svg3dx) | Format specification and samples |
| [svg3dx-core](https://github.com/xiaohunqupo/svg3dx-core) | Parse / evaluate engine |
| [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer) | Viewer component |
| **svg3dx-studio** (this repo) | Editor page library + demo app |

## Embedding (vendor hosts)

```bash
npm run build:lib   # → dist-lib/
# or depend on file:../svg3dx-studio (Vite-alias to src/lib/index.ts while developing)
```

```ts
import { createApp } from "vue";
import { createPinia } from "pinia";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import {
  installStudio,
  BrowsePage,
  EditPage,
  createIndexedDbDocumentRepository,
  createIndexedDbAssetRepository,
} from "svg3dx-studio";
import "svg3dx-studio/style.css";

const app = createApp(HostRoot);
const pinia = createPinia();
app.use(pinia);
app.use(router);
installStudio(app, {
  // omit for default IndexedDB; implement the interfaces for DB / FTP proxies
  documents: createIndexedDbDocumentRepository(),
  assets: createIndexedDbAssetRepository(),
  navigation: {
    goBrowse: () => router.push("/studio"),
    goEdit: (id) => router.push(`/studio/edit/${id}`),
  },
  // AI tools/chrome default to on. Only disable when the host has its own assistant:
  // showAiAssistant: false,
});
app.use(TDesign);
```

Mount `BrowsePage` / `EditPage` on your routes (`EditPage` needs `props: true` for `id`).

### AI assistant

Studio ships a CopilotKit-based assistant as part of the page library. **Enabled by default** (`showAiAssistant: true`).

- **Demo / typical host**: mount `<AiChatPanel />` at the app root, import `@copilotkit/vue/styles.css`, and run/proxy the Copilot runtime (`npm run copilot` / `/api/copilotkit`).
- **Host has its own AI**: `installStudio(app, { showAiAssistant: false })` and do not mount `AiChatPanel` (global kill-switch).
- **Hide chrome on one page**: `:show-ai-assistant="false"` (does not unmount a root `AiChatPanel`).

**Where the API key lives:** only in the user’s browser (`localStorage`). Each chat request sends `x-studio-llm-*` headers to your Runtime; the server does **not** persist user keys. Optional server fallback: `OPENAI_API_KEY` / `.studio-llm.json` (for a host-paid demo).

#### Deploy Runtime for GitHub Pages (or any static host)

Pages stays static. Point the SPA at a Worker with the build-time variable `VITE_COPILOT_RUNTIME_URL` (for example `https://<host>/api/copilotkit`). Leave it unset and the app calls same-origin `/api/copilotkit`.

That value is not in the repo. For GitHub Actions, set the repository variable of the same name. For a local checkout, put it in `.env.local` (gitignored).

The Worker's chat routes accept only Origins listed in the runtime variable `COPILOT_CORS_ORIGIN`. That list lives in the Cloudflare Worker settings, not in the repo; with the variable unset, those requests get 403 and never reach the model. A browser on another site cannot change `Origin`. The custom hostname is attached under Domains in that same dashboard, not in `wrangler.jsonc`. Local development uses the Node runtime below.

Pushing `release/0.2.1` publishes both. That branch name is `RELEASE_BRANCH` in `.github/workflows/ci.yml`; the next release line changes it once for Pages and the Worker. The repo secret `CLOUDFLARE_API_TOKEN` is what the Worker deploy uses.

Manual publish from a local checkout (`wrangler deploy --keep-vars`, so dashboard variables stay in place):

```bash
npx wrangler login     # once
npm run copilot:deploy
```

Optional host-paid fallback (otherwise each visitor uses Settings):

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put COPILOT_MODEL
```

Local Node runtime (Vite proxies `/api/copilotkit` to it):

```bash
npm run copilot   # listens on :8200
```

Health check: `GET /api/health` on the Worker host.

### Three openness levels

1. **Full pages**: mount as-is; tweak with props (`showOfficialSamples`, `showAiAssistant`, …) and slots.
2. **Custom storage**: implement `DocumentRepository` / `AssetRepository`.
3. **Compose UI**: use only `ViewerHost` / `InteractHost` / panels as building blocks.

**Browse slots**: `topbar-start` · `topbar-end` · `sidebar` · `empty` · `viewport-chrome`  
**Edit slots**: `topbar-start` · `topbar-end` · `toolbar-extra` · `tree` · `source` · `viewport-chrome` · `inspector`

### Styling

- `import "svg3dx-studio/style.css"`
- Override layout tokens: `--svg3dx-studio-topbar-height`, `--svg3dx-studio-sidebar-width`, … (see `src/styles/global.css`)
- Colors follow TDesign `--td-*` / `theme-mode`

## Develop

**CI / `npm run build` / `npm run dev`** resolve `svg3dx-viewer` (and wasm) from **npm**.  
**`npm run build:all`** builds sibling `svg3dx-core` + `svg3dx-viewer`, then studio with `SVG3DX_USE_LOCAL=1`.

```powershell
cd ..\svg3dx-studio
npm ci
npm run build              # packages only (same as CI)
npm run build:all          # local wasm → viewer → SPA + dist-lib
npm run build:all:dev      # local stack, then: npm run dev:local
npm run build:lib          # page library from packages
```

Publish order (required for green CI / Cloudflare):

1. `svg3dx-core`: `wasm-pack` → `pkg/` → publish **`svg3dx-ffi-wasm@0.2.0`**
2. `svg3dx-viewer`: ensure lock uses registry `svg3dx-ffi-wasm@0.2.0` → publish **`svg3dx-viewer@0.2.1`**
3. In this repo, replace the local `file:../svg3dx-viewer` lock link:

```powershell
npm install svg3dx-viewer@0.2.1
```

## CI / GitHub Pages

1. `npm ci` (registry packages only)
2. `npm run build` (SPA, `VITE_BASE=/svg3dx-studio/`) → Pages
3. `npm run build:lib` → upload `svg3dx-studio-lib` artifact

Live demo: https://xiaohunqupo.github.io/svg3dx-studio/

## Demo SPA routes

- `/` browse (default IndexedDB)
- `/edit/:id` edit

## License

MIT OR MulanPSL-2.0.
