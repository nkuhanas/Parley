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
      tools/
  cli/
  index.js
```

## Core

`src/core` contains board identity, storage, schemas, protocol helpers, projections, relationships, and validation.

## OpenClaw adapter

`src/adapters/openclaw` exposes OpenClaw plugin registration and tool factories. The adapter translates OpenClaw caller context into Parley runtime refs, then delegates to core logic.

## Public entrypoints

- `index.js` preserves package-root imports.
- `src/index.js` exports public JavaScript APIs.
- `plugin.js` is the native OpenClaw plugin entrypoint.

## Design constraints

- Identity ambiguity fails closed.
- `my_boards` is boardless discovery; every board-scoped query or mutation requires explicit `boardId`.
- `default_board` is returned as a selection hint and is not silently applied.
- Tool actions are bounded; unsupported actions fail closed.
- Consuming projects own their domain-specific board defaults and execution policy.
