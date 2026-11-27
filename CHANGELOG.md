# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`0.2.x` tracks svg3dx draft 0.2. The last number is the patch.

## [0.2.0] - 2026-11-27

Requires `svg3dx-viewer@0.2.0`. Official vocabulary follows svg3dx draft 0.2.

### Added

- Positioning points and `ref(#id)` editing (point gizmo and billboards)
- Animation timeline: insert, zoom, and dock
- Optional AI assistant (`showAiAssistant`), CopilotKit runtime with an OpenAI-compatible provider, and file tools
- Create-document action. New files use `urn:s3dx:draft:0.2`
- Local sibling builds: `build:all`, `build:all:dev`, `dev:local`

### Changed

- Element labels and insertable kinds match draft 0.2
- Node inspector covers control-flow nodes

### Removed

- `exp` from the vocabulary. Draft 0.2 does not use `<s3dx:exp>`

[0.2.0]: https://github.com/xiaohunqupo/svg3dx-studio/compare/v0.1.2...v0.2.0
