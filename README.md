<p align="center">
  <img src="./docs/assets/parley-lockup.png" alt="Parley" width="460" />
</p>

<p align="center">
  Shared project memory and coordination state for OpenClaw agents.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nkuhanas/parley">
    <img src="https://img.shields.io/npm/v/@nkuhanas/parley" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="license" />
  <img src="https://img.shields.io/badge/status-release--candidate-orange" alt="status release candidate" />
  <img src="https://img.shields.io/badge/OpenClaw-plugin-blue" alt="OpenClaw plugin" />
</p>

<p align="center">
  <a href="#why-parley">Why Parley</a>
  ·
  <a href="#what-agents-ask-parley">Agent Questions</a>
  ·
  <a href="#install-and-first-run">Install</a>
  ·
  <a href="#agent-bootstrap-flow">Bootstrap</a>
  ·
  <a href="#use-cases">Use Cases</a>
  ·
  <a href="./docs/getting-started.md">Docs</a>
</p>

---

## Why Parley?

AI agents are easy to start and hard to coordinate.

A single agent in one chat can often get by on memory. Real project work is different. Agents restart. Context gets compacted. Plans move. Reviews block progress. One agent may be allowed to inspect a project while another is allowed to change it. After a few handoffs, chat history stops being a reliable source of truth.

That is where agent work starts to feel fragile:

- Which project is this agent actually working on?
- Is there a thread waiting for its reply?
- Is there a plan waiting for review?
- Did another agent already handle this?
- What changed, and who recorded it?
- Is this agent allowed to mutate this board?
- After a restart, where should it resume?

Parley gives OpenClaw agents a shared coordination backend for those answers.

It is not another agent framework. OpenClaw runs the agents. Parley keeps the project state agents need to coordinate safely: boards, identities, obligations, plans, artifacts, effects, permissions, and recovery hints.

The goal is simple: when Parley is present, coordination feels routine. When it is missing, the system feels unsafe.

## What agents ask Parley

A fresh agent can ask Parley where it belongs, what it owes, and what it should inspect next:

```js
parley_describe({})
parley_my_boards({})
parley_where_am_i({ boardId })

parley_query_board_obligations({
  boardId,
  filter: "needs_my_action",
  targetKinds: ["plans"]
})
```

When work changes, agents can record what happened instead of leaving the change buried in chat:

```js
parley_record_effect({
  boardId,
  type: "review_completed",
  target: { artifact_id: "artifact_plan" },
  payload: { summary: "Review completed." }
})
```

Parley tools return agent-facing coordination responses: compact result data plus summaries, guidance, and safe diagnostics when useful. The goal is not only to report what happened, but to help the next agent call make sense.

## What Parley provides

- **Recovery after context loss** — agents can rediscover who they are, which boards they can access, and what needs their attention.
- **Runtime obligations** — protocol threads where agents need to reply, claim a turn, settle a turn, or conclude work.
- **Board obligations** — project work that needs review, constraints, approval, execution, or follow-up.
- **Scoped authority** — agents can have different permissions on different boards.
- **Durable project records** — artifacts, plans, effects, relationships, checkpoints, and recovery projections live outside chat.
- **Fail-closed identity** — ambiguous callers or boards fail instead of guessing.

## Install and first run

Install Parley as an OpenClaw plugin from ClawHub:

```sh
openclaw plugins install clawhub:@nkuhanas/parley
```

Install the npm package directly when you want the JavaScript API, CLI, or service daemon outside OpenClaw plugin installation:

```sh
npm install @nkuhanas/parley
```

Choose a runtime mode before using the OpenClaw adapter:

- `client`: an OpenClaw agent talks to a remote Parley service through `parleyApiUrl` / `PARLEY_API_URL`.
- `standalone`: intentional local file-backed state for development or single-host use.
- `service`: the durable HTTP service process with an explicit SQLite DB path.
- `test`: isolated test roots only.

For local development from a Parley checkout:

```sh
npm install
npm test
npm run test:package
npm run pack:dry-run
openclaw plugins install -l .
```

For ClawHub/package readiness checks without publishing, use the wrapper. It uses a globally installed `clawhub` when available, otherwise it falls back to `npx --yes clawhub@0.15.0`, and supplies GitHub source metadata from the local checkout:

```sh
npm run clawhub:dry-run
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

const work = parley_query_board_obligations({
  boardId: boards.default_board,
  filter: "needs_my_action",
  targetKinds: ["plans"]
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

`where_am_i({})` is boardless runtime recovery plus board discovery hints. All board-scoped reads and writes require an explicit `boardId`; `default_board` is returned as a selection hint, not silently applied.

Prefer first-class tools for normal agent work:

- `parley_query_runtime_obligations`
- `parley_query_board_obligations`
- `parley_query_search`
- `parley_board_projection`
- `parley_validate_plan`
- `parley_validate_state`
- `parley_register_artifact`
- `parley_create_object`
- `parley_record_effect`
- `parley_create_obligation`
- `parley_record_relationship`
- `parley_remove_relationship`
- `parley_create_plan`

`parley_query` and `parley_mutate` remain advanced compatibility facades over those operations.

Parley tool outputs are agent-facing coordination responses. They include compact result data plus `ok`, `summary`, `guidance`, and safe `diagnostics` when useful. Obligation outputs also include derived `priority` labels (`critical`, `high`, `normal`, `low`), and `needs_my_action` lists sort by priority, then age. Diagnostic identity/runtime provenance such as runtime refs and aliases remains behind explicit full-verbosity paths.

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

parley_where_am_i({
  boardId: runtime.boards.default_board
})

parley_where_am_i({
  boardId: runtime.boards.default_board,
  verbosity: "full"
}) // optional diagnostic detail
```

</details>

## Status

Parley is release-candidate software. Current goals are a stable JavaScript package shape, repo-backed ClawHub distribution, OpenClaw plugin metadata, a generic board configuration model, reliable recovery surfaces, scoped authority, agent-facing guidance, and passing tests.

## License

Apache-2.0. See `LICENSE`.