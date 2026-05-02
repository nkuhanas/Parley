# Changelog

## 0.1.0-alpha.3

- Publish the ClawHub package from extracted npm-pack contents so package review sees root-level runtime files.
- Preserve alpha.2 runtime contents while correcting ClawHub file indexing for scan visibility.

## 0.1.0-alpha.2

- Publish the ClawHub package as a ClawPack artifact instead of the legacy zip format.
- Add namespace security guidance for reference and landing roots.

## 0.1.0-alpha.1

- Prepare Parley as a standalone OpenClaw plugin package.
- Keep implementation in JavaScript for alpha.1.
- Move core coordination logic under `src/core/`.
- Move OpenClaw integration under `src/adapters/openclaw/`.
- Add native OpenClaw manifest and plugin entrypoint.
- Replace private dogfood documentation with public package docs and generic examples.
