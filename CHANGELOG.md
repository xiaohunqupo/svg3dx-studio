# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-23

### Added

- `CHANGELOG.md` included in the published npm package

## [0.1.1] - 2026-11-23

### Added

- Embeddable Vue **page library** (`dist-lib/`): `installStudio`, `BrowsePage`, `EditPage`, hosts, panels, `createInteract`
- Pluggable `DocumentRepository` / `AssetRepository` / `StudioNavigation` (IndexedDB defaults)
- Region slots and feature props for vendor UI customization
- Public CSS entry `svg3dx-studio/style.css` and layout CSS variables
- `npm run build:lib`; CI uploads `svg3dx-studio-lib` artifact alongside GitHub Pages
- `build:all` / `build:all:dev` / `build:all:full` local stack scripts
- Gizmo `transformPreview` for live inspector updates without writing the document
- Frame-on-highlight / camera framing helpers; `panOrbitTo` orbit pan that preserves look direction
- On-demand `extraDefs` loading in interact / hosts

### Changed

- Package is publishable (no longer `private`); peers include `svg3dx-viewer@^0.1.1`
- Files store persists only through repositories (no direct IndexedDB calls)

## [0.1.0] - 2026-11-16

### Added

- Initial Studio SPA (browse / edit) on Vite + Vue 3 + TDesign

[0.1.2]: https://github.com/xiaohunqupo/svg3dx-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/xiaohunqupo/svg3dx-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/xiaohunqupo/svg3dx-studio/releases/tag/v0.1.0
