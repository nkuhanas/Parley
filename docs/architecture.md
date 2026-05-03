# Architecture

Parley is organized so the core coordination model is not tied to one host runtime.

```txt
src/
  core/
    board/
    protocol/
    schema/
    storage/
    errors/
  adapters/
    openclaw/
      guidance/
      tools/
  cli/
  index.js
```

## Core

`src/core` contains board identity, storage, schemas, protocol helpers, projections, relationships, and validation.

## OpenClaw adapter

`src/adapters/openclaw` exposes OpenClaw plugin registration and tool factories. The adapter translates OpenClaw caller context into Parley runtime refs, then delegates to core logic.

The `guidance/` package centralizes agent-facing response text and next-call guidance. Tool implementations should return structured facts; shared response helpers enrich those facts with compact `ok`, `summary`, `guidance`, and `diagnostics` fields. Obligation priority is derived by shared obligation helpers before guidance chooses which obligation class to inspect first. Avoid scattering prompt-like/plaintext operational guidance through individual tool files.

## Public entrypoints

- `index.js` preserves package-root imports.
- `src/index.js` exports public JavaScript APIs.
- `plugin.js` is the native OpenClaw plugin entrypoint.

## Design constraints

- Identity ambiguity fails closed.
- Targetability is shared, resolution is scope-specific, and actionability is derived.
- Runtime protocol records such as threads, messages, and turns are not board-affined by default.
- Board targets require explicit `boardId`; runtime targets do not use `boardId` as a resolver.
- `my_boards` is boardless discovery; every board-scoped query or mutation requires explicit `boardId`.
- `where_am_i` without `boardId` is runtime recovery plus board discovery hints; with `boardId` it returns separate runtime and board sections.
- `default_board` is returned as a selection hint and is not silently applied.
- Tool actions are bounded; unsupported actions fail closed.
- First-class tools are the preferred agent-facing affordance; `parley_query` and `parley_mutate` remain advanced compatibility facades.
- Tool outputs should be operational and actionable without becoming verbose; diagnostics are opt-in when they expose provenance or runtime identity details.
- Consuming projects own their domain-specific board defaults and execution policy.
