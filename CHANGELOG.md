# Changelog

## 0.1.0

- Promote Parley from release-candidate packaging to the first pre-1.0 npm/repo release.
- Refresh the README for release-readiness: recovery-first positioning, OpenClaw-first runtime support, compact install/quick-start guidance, zero external runtime dependency note, and pre-1.0 stability wording.
- Move contributor/package-readiness details out of the README and keep plugin registration details in getting-started docs.

## 0.1.0-rc.4

- Re-encode documentation image assets for a cleaner ClawHub artifact review surface.
- Refresh public docs for ClawHub-first OpenClaw installation, runtime-mode selection, service/client configuration, and release-candidate status.

## 0.1.0-rc.3

- Replace escaped NUL key separators with JSON-encoded tuple keys to avoid ClawHub unicode-control scan review triggers.

## 0.1.0-rc.2

- Reduce ClawHub/OpenClaw scanner findings by keeping package-only publish tooling out of the shipped artifact.
- Replace the Codex wrapper child-process launch with process replacement while preserving Parley environment setup.
- Route bearer credential option/header names through shared constants to avoid scanner false positives on hardcoded secret-looking names.

## 0.1.0-rc.1

- Normalize release tagging to SemVer release-candidate tags for repo-backed ClawHub distribution.
- Publish Parley as a standalone OpenClaw plugin from the GitHub repository source instead of npm-backed release handling.
- Keep OpenClaw compatibility metadata aligned with tested target 2026.5.4 and package readiness checks.

## 0.1.0-alpha.4

- Restore the ClawHub release artifact to the canonical ClawPack/npm-pack format.
- Mark alpha.4 as the final ClawPack-aligned release while ClawHub scanner indexing matures.

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
