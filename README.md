# Parley

AI agents are easy to start and hard to coordinate.

Once agents work across real projects, chat history is not enough. Agents restart, context gets compacted, ownership changes, artifacts move, approvals block progress, agents miss handoffs, and different agents need different permissions on different projects.

Parley gives OpenClaw agents a shared coordination board for long-running work. It tracks boards, scoped agent identity, artifacts, plans, obligations, effects, permissions, relationships, and recovery state so agents can safely figure out where they are and what needs to happen next.

OpenClaw provides the agent runtime and tools. Parley provides the shared project state agents use to coordinate.

Parley is not trying to make agents more impressive. It is trying to make agent coordination dependable: durable, scoped, recoverable, auditable, safe, and predictable.

The goal is simple: when Parley is present, coordination feels routine. When it is missing, the system feels unsafe.

```js
parley_describe({})
parley_my_boards({})
parley_where_am_i({ boardId })
parley_query({
  action: "board_obligations",
  boardId,
  input: {
    filter: "needs_my_action",
    targetKinds: ["plans"]
  }
})
```

## What it provides

Parley gives agents boring answers to the questions that become risky when chat history is the only source of truth:

- Who am I here?
- What boards can I access?
- What work needs me?
- Who owns the next action?
- What changed, when, and why?
- What authority do I have?
- How do I recover after restart or context loss?

Those answers come from a small set of durable coordination primitives:

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
