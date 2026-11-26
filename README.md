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
  // Hosts with their own AI assistant should disable Studio's built-in one:
  // showAiAssistant: false,
});
app.use(TDesign);
```

Mount `BrowsePage` / `EditPage` on your routes (`EditPage` needs `props: true` for `id`).

### AI assistant

Studio ships a CopilotKit-based assistant as part of the page library (`AiChatPanel` + Browse/Edit dock chrome).

- **Default on**: `installStudio` uses `showAiAssistant: true`. Prefer this flag for hosts — it gates both app-root `AiChatPanel` mounting and page chrome.
- **Host AI**: `installStudio(app, { showAiAssistant: false })` and do not mount `AiChatPanel`.
- **Per-page chrome only**: `BrowsePage` / `EditPage` `showAiAssistant` overrides the install default for the header button + dock column (does not unmount a root `AiChatPanel`).
- **Enable Studio AI in a host**: keep install `showAiAssistant` true, mount `<AiChatPanel />` once at the app root, import `@copilotkit/vue/styles.css`, and proxy/run the Copilot runtime (`npm run copilot` / `/api/copilotkit`).

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

Sibling checkouts: `svg3dx`, `svg3dx-core`, `svg3dx-viewer`, and this repo.

```powershell
cd ..\svg3dx-studio
npm run build:all          # wasm → viewer → SPA dist + dist-lib
npm run build:all:dev      # stop after viewer, then npm run dev
npm run build:lib          # page library only
```

## CI / GitHub Pages

1. Checkout `svg3dx-core`, `svg3dx-viewer`, `svg3dx`
2. `wasm-pack` → core `pkg/`
3. `npm run build` (SPA, `VITE_BASE=/svg3dx-studio/`) → Pages
4. `npm run build:lib` → upload `svg3dx-studio-lib` artifact

Live demo: https://xiaohunqupo.github.io/svg3dx-studio/

## Demo SPA routes

- `/` browse (default IndexedDB)
- `/edit/:id` edit

## License

MIT OR MulanPSL-2.0.
