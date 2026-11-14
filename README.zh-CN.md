<p align="center">
  <img src="assets/title.png" alt="svg 3dx studio" width="360"/>
</p>

# svg3dx-studio

[English](README.md) | 中文

**svg3dx 编辑器**：Vite + Vue 3 + TDesign + three.js。打开 / 缓存本地文件，浏览预览，进入编辑页新增体元并保存。

渲染与参数面板复用 [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer)。

视口分层（均在本仓，不单独开库）：

| 层 | 用途 |
|----|------|
| `ViewerHost` + `svg3dx-viewer` | 浏览页：轻量显示（无点击选中） |
| `InteractHost` + `src/interact` | 编辑页：点击拾取 / 高亮等视口交互（不含文档编辑本身） |

## 关联库

| 仓库 | 职责 |
|------|------|
| [svg3dx](https://github.com/xiaohunqupo/svg3dx) | 格式规范与 samples |
| [svg3dx-core](https://github.com/xiaohunqupo/svg3dx-core) | 解析求值引擎 |
| [svg3dx-viewer](https://github.com/xiaohunqupo/svg3dx-viewer) | 查看器组件 |
| **svg3dx-studio**（本仓） | 编辑器应用 |

## 开发

本机并列：`svg3dx`、`svg3dx-core`（已 `wasm-pack` 产出 `pkg/`）、`svg3dx-viewer`、本仓。

```powershell
# 1) engine wasm
cd ..\svg3dx-core
wasm-pack build crates/svg3dx-ffi-wasm --target bundler --out-dir pkg --out-name svg3dx_ffi_wasm

# 2) editor
cd ..\svg3dx-studio
npm install
npm run dev
```

## CI

GitHub Actions（`.github/workflows/ci.yml`）在 `main` / PR 上：

1. 检出并列仓 `svg3dx-core`、`svg3dx-viewer`、`svg3dx`
2. `wasm-pack` → core `pkg/`
3. viewer / studio 分别 `npm ci`，再 `npm run build`（vue-tsc + Vite）
4. 上传 `dist` 产物

## 页面

### 浏览（`/`）

- 无缓存文件：中央拖拽 / 点击选择区域
- 有文件：左侧文件列表 + 中央 viewer 预览；可继续拖入追加
- 文件名旁「编辑」进入编辑页；顶部可加载官方示例

### 编辑（`/edit/:id`）

- 上侧：返回浏览、新增体元菜单、保存 / 导出
- 左侧：求值后的 Models / Geometry 节点树
- 中央：`InteractHost` 视口（基于 viewer 的交互层）
- 右侧：外部参数 + 选中节点 JSON
- 保存写入浏览器 IndexedDB 本地缓存

## 许可证

MIT OR MulanPSL-2.0。
