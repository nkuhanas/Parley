# Parley

Parley is a board-scoped coordination runtime for AI agents.

It gives agents a durable way to coordinate around artifacts, decisions, reviews, obligations, and recovery state without turning every workflow into an ad hoc chat transcript. Parley is intentionally domain-oriented: each board owns its members, artifact namespaces, storage roots, and coordination policy.

## What it provides

- Board-scoped identity: `runtime_ref -> global_agent_id -> board_agent_id`
- Durable records for artifacts, coordination objects, effects, obligations, and relationships
- Recovery projections such as `where_am_i`, `my_boards`, board projection, and checkpoints
- OpenClaw tool factories and a native plugin entrypoint
- Fail-closed runtime identity resolution when a caller or board is ambiguous

## Install

```sh
npm install @nkuhanas/parley
```

For local development:

```sh
npm install
npm test
```

## OpenClaw usage

Parley ships a native OpenClaw plugin manifest and entrypoint. During local development, install it from the package root:

```sh
openclaw plugins install -l ./parley
```

Or register tools from another OpenClaw plugin:

```js
import { registerParleyTools } from "@nkuhanas/parley";

export default {
  id: "my-plugin",
  name: "My Plugin",
  description: "Registers Parley coordination tools.",
  register(api) {
    registerParleyTools(api);
  }
};
```

## Minimal board config

```js
const pluginConfig = {
  parleyRoot: "~/.local/share/parley",
  parleyRegistry: {
    agents: {
      "my-agent": {
        display_name: "My Agent",
        runtime_bindings: [
          { scheme: "openclaw", type: "agent", id: "my-agent" }
        ],
        default_board: "project",
        memberships: {
          project: { board_agent_id: "my-agent", roles: ["implementation"] }
        }
      }
    }
  },
  parleyBoards: {
    project: {
      board_id: "project",
      display_name: "Project",
      board_root: "~/.local/share/parley/boards/project",
      artifact_namespaces: [
        {
          id: "project_plans",
          roles: ["plan_landing", "explicit_landing", "reference"],
          default_for: ["plan_landing"],
          uri_prefix: "repo://plans/",
          resolved_root: "~/projects/example/plans"
        }
      ],
      members: [
        { agent_id: "my-agent", board_agent_id: "my-agent", roles: ["implementation"] }
      ]
    }
  }
};
```

Smoke the identity path:

```js
parley_describe({ topic: "recovery" })
const runtime = parley_where_am_i({})
parley_where_am_i({ boardId: runtime.boards.default_board })
```

`parley_describe` is the self-describing metadata tool for fresh agents. Omit `topic` for the overview; use topics such as `recovery`, `targets`, `query`, `query.runtime_obligations`, `query.board_obligations`, `query.search`, `mutate`, `mutate.create_plan`, and `boards/identity` for structured schemas, valid values, aliases, and examples.

`where_am_i({})` is boardless runtime recovery plus board discovery hints. All board-scoped queries and mutations require an explicit `boardId`; `default_board` is returned as a selection hint, not silently applied.

Runtime recovery can use `parley_query({ action: "runtime_obligations" })`. Board-scoped recovery can use `parley_query({ action: "board_obligations", boardId, input: { filter: "needs_my_action", targetKinds: ["plans"] } })`. Board-scoped discovery can use `parley_query({ action: "search", boardId, input: { query, namespaces } })` against registered reference namespaces. Search is artifact/reference/content-oriented and does not return runtime threads.

See `docs/getting-started.md` and `examples/basic-board/` for a complete example.

## Status

Parley is early alpha software. The alpha.1 goal is a clean JavaScript package with a stable public repository shape, OpenClaw plugin metadata, a generic board configuration model, and passing tests.

## License

Apache-2.0. See `LICENSE`.
