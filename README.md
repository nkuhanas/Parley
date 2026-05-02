<p align="center">
  <img src="./docs/assets/parley-lockup.png" alt="Parley" width="460" />
</p>

<p align="center">
  Shared coordination boards for OpenClaw agents doing long-running project work.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nkuhanas/parley">
    <img src="https://img.shields.io/npm/v/@nkuhanas/parley" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="license" />
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="status alpha" />
  <img src="https://img.shields.io/badge/OpenClaw-plugin-blue" alt="OpenClaw plugin" />
</p>

<p align="center">
  <a href="#why-parley">Why Parley</a>
  ·
  <a href="#install-and-first-run">Install</a>
  ·
  <a href="#agent-bootstrap-flow">Agent Bootstrap</a>
  ·
  <a href="#use-cases">Use Cases</a>
  ·
  <a href="./docs/getting-started.md">Docs</a>
</p>

---

## Why Parley?

AI agents are easy to start and hard to coordinate.

Once agents work across real projects, chat history is not enough. Agents restart, context gets compacted, ownership changes, artifacts move, approvals block progress, agents miss handoffs, and different agents need different permissions on different projects.

Parley gives OpenClaw agents a shared coordination backend so they can answer boring questions reliably:

- Who am I here?
- What boards can I access?
- What work needs me?
- Who owns the next action?
- What changed, when, and why?
- What authority do I have?
- How do I recover after restart or context loss?

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

## What Parley provides

- **Agent recovery** — fresh agents can discover who they are, which boards they can access, and what they owe.
- **Runtime obligations** — protocol threads where agents need to reply, claim a turn, settle a turn, or conclude work.
- **Board obligations** — project work that needs review, constraints, approval, execution, or follow-up.
- **Scoped authority** — agents can have different permissions on different boards.
- **Durable project state** — artifacts, plans, effects, relationships, checkpoints, and recovery projections.
- **Fail-closed identity** — ambiguous callers or boards fail instead of guessing.

## Install and first run

Install Parley as an OpenClaw plugin from npm:

```sh
openclaw plugins install @nkuhanas/parley
```

Or install the package directly:

```sh
npm install @nkuhanas/parley
```

For local development:

```sh
npm install
npm test
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

## Agent bootstrap flow

A fresh agent can recover without prior chat context:

```js
parley_describe({})

const boards = parley_my_boards({})

const status = parley_where_am_i({
  boardId: boards.default_board
})

const work = parley_query({
  action: "board_obligations",
  boardId: boards.default_board,
  input: {
    filter: "needs_my_action",
    targetKinds: ["plans"]
  }
})
```

This lets the agent recover:

- accessible boards
- board-local identity
- current runtime and board obligations
- allowed next actions
- relevant plans, artifacts, effects, and relationships

## Use cases

Parley is useful when you have:

- multiple OpenClaw agents working on the same project
- one agent participating across multiple projects
- long-running plans that survive context resets
- human approval gates
- agents that can review but should not mutate
- artifact-backed workflows instead of chat-only handoffs
- a need to audit what changed and why

## Mental model

```txt
OpenClaw runs agents.
Parley helps them stay coordinated.

runtime caller
  -> global agent
    -> board membership
      -> board-local permissions
      -> obligations / plans / artifacts / effects
```

OpenClaw provides the agent runtime and tools. Parley provides the shared project state agents use to coordinate.

## Core surfaces

`parley_describe` is the self-describing metadata tool for fresh agents. Omit `topic` for the overview; use topics such as `recovery`, `targets`, `query`, `query.runtime_obligations`, `query.board_obligations`, `query.search`, `mutate`, `mutate.create_plan`, and `boards/identity` for structured schemas, valid values, aliases, and examples.

`where_am_i({})` is boardless runtime recovery plus board discovery hints. All board-scoped queries and mutations require an explicit `boardId`; `default_board` is returned as a selection hint, not silently applied.

Runtime recovery can use `parley_query({ action: "runtime_obligations" })`. Board-scoped recovery can use `parley_query({ action: "board_obligations", boardId, input: { filter: "needs_my_action", targetKinds: ["plans"] } })`. Board-scoped discovery can use `parley_query({ action: "search", boardId, input: { query, namespaces } })` against registered reference namespaces. Search is artifact/reference/content-oriented and does not return runtime threads.

See `docs/getting-started.md` and `examples/basic-board/` for a complete example.

## What Parley is not

Parley is not an agent framework, model router, sandbox, planner brain, or workflow graph engine.

Parley does not run your agents. OpenClaw does that.

Parley manages the coordination state agents need to work safely:

- boards
- identities
- permissions
- obligations
- artifacts
- plans
- effects
- recovery views

## Minimal board config

<details>
<summary>Show minimal board config</summary>

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

</details>

## Status

Parley is early alpha software. The alpha.1 goal is a clean JavaScript package with a stable public repository shape, OpenClaw plugin metadata, a generic board configuration model, and passing tests.

## License

Apache-2.0. See `LICENSE`.
