<p align="center">
  <img src="assets/title.png" alt="svg 3dx studio" width="360"/>
</p>

# svg3dx-studio

[English](README.md) | 中文

**svg3dx Studio**：可嵌入的 Vue 页面库（浏览 / 编辑）+ 本仓演示 SPA。Vite + Vue 3 + TDesign + three.js。

渲染与参数面板复用 [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer)。

| 层 | 用途 |
|----|------|
| `ViewerHost` + `svg3dx-viewer` | 浏览预览（无点击选中） |
| `InteractHost` + `createInteract` | 编辑视口：拾取 / 高亮 / 变换 |
| `BrowsePage` / `EditPage` | 整页模板（插槽可改布局） |
| `DocumentRepository` / `AssetRepository` | 可替换的文档与 sidecar 存储 |

## 关联库

| 仓库 | 职责 |
|------|------|
| [svg3dx](https://github.com/xiaohunqupo/svg3dx) | 格式规范与 samples |
| [svg3dx-core](https://github.com/xiaohunqupo/svg3dx-core) | 解析求值引擎 |
| [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer) | 查看器组件 |
| **svg3dx-studio**（本仓） | 编辑器页面库 + 演示应用 |

## 嵌入（厂商宿主）

```bash
npm run build:lib   # → dist-lib/
# 或依赖 file:../svg3dx-studio（开发时可用 Vite alias 指到 src/lib/index.ts）
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
  // 省略则默认 IndexedDB；接业务库 / FTP 代理时实现接口即可
  documents: createIndexedDbDocumentRepository(),
  assets: createIndexedDbAssetRepository(),
  navigation: {
    goBrowse: () => router.push("/studio"),
    goEdit: (id) => router.push(`/studio/edit/${id}`),
  },
  // AI 工具/界面默认开启。仅当宿主自带助手时关闭：
  // showAiAssistant: false,
});
app.use(TDesign);
```

路由挂载 `BrowsePage` / `EditPage`（`EditPage` 需 `props: true` 传入 `id`）。

### AI 助手

Studio 内置基于 CopilotKit 的助手，属于页面库的一部分。**默认开启**（`showAiAssistant: true`）。

- **演示 / 常规宿主**：根上挂 `<AiChatPanel />`，引入 `@copilotkit/vue/styles.css`，并运行/代理 Copilot Runtime（`npm run copilot` / `/api/copilotkit`）。
- **宿主自带 AI**：`installStudio(app, { showAiAssistant: false })`，且不要挂载 `AiChatPanel`（全局总开关）。
- **仅关某页 chrome**：`:show-ai-assistant="false"`（不会卸载根上已挂的 `AiChatPanel`）。

**密钥放哪：** 只在用户浏览器（`localStorage`）。每次对话请求带上 `x-studio-llm-*` 头；Runtime **不落盘**用户 Key。可选服务器兜底：`OPENAI_API_KEY` / `.studio-llm.json`（站主付费的演示）。

#### 为 GitHub Pages（或任意静态站）部署 Runtime

线上 Runtime 是 Cloudflare Worker：`https://copilot.dannyxu.net/api/copilotkit`。Pages 仍是静态站，SPA 构建用 `VITE_COPILOT_RUNTIME_URL` 指向 Worker。

```bash
cd svg3dx-studio
npm ci
npx wrangler login          # 只需一次
npm run copilot:deploy      # 发布 Worker，并绑定 copilot.dannyxu.net
```

可选的站主兜底 Key（否则访客在设置里填自己的）：

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put COPILOT_MODEL
```

本地 Node Runtime（Vite 把 `/api/copilotkit` 代理过来）：

```bash
npm run copilot   # 默认 :8200
```

健康检查：`GET https://copilot.dannyxu.net/api/health`

### 三层开放度

1. **整页**：直接挂页面；用 props（如 `showOfficialSamples`、`showAiAssistant`）与插槽微调。
2. **换存储**：实现 `DocumentRepository` / `AssetRepository`（list/get/save/remove；资产 list/read/write/removeAll）。
3. **自组布局**：只引 `ViewerHost` / `InteractHost` / `FileListPanel` / 节点面板等积木。

**Browse 插槽**：`topbar-start` · `topbar-end` · `sidebar` · `empty` · `viewport-chrome`  
**Edit 插槽**：`topbar-start` · `topbar-end` · `toolbar-extra` · `tree` · `source` · `viewport-chrome` · `inspector`

### 样式

- `import "svg3dx-studio/style.css"`
- 覆盖布局变量：`--svg3dx-studio-topbar-height`、`--svg3dx-studio-sidebar-width` 等（见 `src/styles/global.css`）
- 颜色沿用 TDesign `--td-*` / `theme-mode`

## 开发

**CI / `npm run build` / `npm run dev`** 从 **npm 包**解析 `svg3dx-viewer`（及 wasm）。  
**`npm run build:all`** 本地编译并列的 `svg3dx-core` + `svg3dx-viewer`，再用 `SVG3DX_USE_LOCAL=1` 编 studio。

```powershell
cd ..\svg3dx-studio
npm ci
npm run build              # 只走包（与 CI 相同）
npm run build:all          # 本地 wasm → viewer → SPA + dist-lib
npm run build:all:dev      # 本地栈就绪后：npm run dev:local
npm run build:lib          # 从包构建页面库
```

发布顺序（CI / Cloudflare 变绿前必须完成）：

1. `svg3dx-core`：`wasm-pack` → `pkg/` → 发布 **`svg3dx-ffi-wasm@0.2.0`**
2. `svg3dx-viewer`：lock 改为 registry 的 `svg3dx-ffi-wasm@0.2.0` → 发布 **`svg3dx-viewer@0.2.1`**
3. 本仓去掉 `file:../svg3dx-viewer` 本地链接：

```powershell
npm install svg3dx-viewer@0.2.1
```

## CI / GitHub Pages

1. `npm ci`（仅 registry 包）
2. `npm run build`（SPA，`VITE_BASE=/svg3dx-studio/`）→ Pages
3. `npm run build:lib` → 上传 `svg3dx-studio-lib` artifact

在线演示：https://xiaohunqupo.github.io/svg3dx-studio/

## 演示 SPA 路由

- `/` 浏览（默认 IndexedDB）
- `/edit/:id` 编辑

## 许可证

MIT OR MulanPSL-2.0。
