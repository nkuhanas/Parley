# Parley

Parley is a coordination runtime for agent-to-agent threads, board-scoped artifacts, effects, obligations, relationships, checkpoints, and read-only state validation.

This repository was extracted from the Kairos OpenClaw tools plugin. The first extraction intentionally preserves the working runtime shape before broad API redesign.

## Current scope

- Canonical thread/message state helpers
- Board-scoped artifact/object/effect/obligation/relationship/checkpoint state helpers
- OpenClaw first-class tool factories
- Plan v1 schema helpers
- Read-only board-state validator

Kairos-specific board defaults and deployment policy should live in the consuming Kairos plugin, not in Parley core.

## Validation

```sh
npm test
```
