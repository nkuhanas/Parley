# Parley

Persistent coordination state for AI agents: harness-agnostic, self-describing, and recovery-first.

Parley gives agents durable coordination state outside chat history.

<p align="center">
  <img src="./docs/assets/parley-lockup.png" alt="Parley" width="460" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nkuhanas/parley">
    <img src="https://img.shields.io/npm/v/@nkuhanas/parley" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-green" alt="license" />
  <img src="https://img.shields.io/badge/status-release--candidate-orange" alt="status release candidate" />
  <img src="https://img.shields.io/badge/OpenClaw-primary%20adapter-blue" alt="OpenClaw primary adapter" />
</p>

<p align="center">
  <a href="#what-parley-is">What Parley is</a>
  ·
  <a href="#why-parley-exists">Why Parley exists</a>
  ·
  <a href="#recovery-example">Recovery</a>
  ·
  <a href="#install">Install</a>
  ·
  <a href="#core-surfaces">Core surfaces</a>
  ·
  <a href="./docs/getting-started.md">Docs</a>
</p>

---

## What Parley is

Parley is a coordination backend for long-running and multi-agent workflows.

It gives agents a durable place to recover identity, inspect obligations, record effects, track artifacts, coordinate plans, and understand what changed outside their chat context.

Parley does not run agents. Your harness runs agents.

The primary adapter today is OpenClaw, but Parley's core model is not OpenClaw-specific. OpenClaw agents, Codex CLI agents, custom scripts, or any runtime that can call tools, invoke a CLI, or make HTTP requests can integrate with Parley.

## Why Parley exists

Agents lose continuity when work spans restarts, context compaction, multiple workers, multiple machines, or human review.

Chat history is a working surface, not a reliable source of truth.

Agents need reliable answers to boring but critical questions:

- Who am I in this project?
- What boards can I access?
- What work needs my action?
- What changed, who recorded it, and why?
- Which artifacts, effects, and obligations already exist?
- How do I safely resume after losing context?

The goal is simple: when Parley is present, coordination feels routine. When it is missing, the system feels unsafe.

## How Parley works

Parley separates transient agent conversation from durable coordination state.

```text
Agent runtime / harness
 |
 | tools / CLI / HTTP
 v
Parley adapter or client
 |
 v
Parley service / local store
 |
 v
Boards, plans, artifacts, effects, obligations, triggers, relationships
```

OpenClaw can run the agent. Codex CLI can run the agent. Another system can run the agent.

Parley owns the coordination state those agents need to recover, coordinate, and prove what happened.

## Coordination backend, not orchestration framework

Parley is not a replacement for OpenClaw, Codex CLI, LangGraph, CrewAI, or other agent runtimes.

Those systems decide how agents execute, call tools, route tasks, or manage workflows.

Parley sits underneath or beside them as durable coordination infrastructure:

- identity recovery
- board-scoped authority
- obligations
- artifacts
- effects
- relationships
- plan lifecycle state
- audit and recovery surfaces

## What makes Parley different

### Recovery is first-class

Agents can restart cold, call `parley_where_am_i`, and recover their board access, active obligations, open plan state, and recommended next actions.

### Tool outputs guide agents

Parley tools do not only return raw records. They return summaries, diagnostics, guidance, valid next actions, and scoped identifiers so agents do not need to memorize Parley's protocol in context.

### Authority is scoped

Parley distinguishes read access, mutation access, board scope, runtime identity, and default board hints. Mutations are explicit and board-scoped.

### Coordination state lives outside chat

Important state is recorded as board state: artifacts, effects, obligations, relationships, checkpoints, triggers, and plans. Chat history becomes a working surface, not the source of truth.

## The guidance loop

Parley tools are designed to help agents recover and choose valid next actions.

For example:

1. A cold agent calls `parley_describe`.
2. Parley explains the available capabilities and safe entry points.
3. The agent calls `parley_where_am_i`.
4. Parley returns board access, open obligations, relevant plans, diagnostics, and `needs_my_action` guidance.
5. The agent performs work and records artifacts, effects, or obligation resolutions.
6. Parley returns the next valid operations.

This means agents do not need to keep the whole coordination protocol in their prompt context. Parley returns state-specific guidance at the point of use.

## Recovery example

An agent is assigned phase work, writes an artifact, then crashes before reporting completion.

A fresh agent can restart with no chat history and call:

```text
parley_describe
parley_where_am_i
parley_query_board_obligations
```

Parley can tell it:

- which agent identity it resolved as
- which boards it can access
- which obligations are still open
- which plan phase is active
- which artifacts or effects were already recorded
- what action is needed next

The agent can resume from durable coordination state instead of reconstructing the project from chat logs.

## Identity and authority model

Parley resolves authority through a predictable hierarchy:

```text
runtime caller
 -> global agent identity
 -> board membership
 -> board-local permissions
 -> obligations / plans / artifacts / effects
```

A caller does not gain project authority merely by invoking a tool. Parley resolves the caller, checks board membership, checks board-local permissions, and fails closed when identity or scope is ambiguous.

## What Parley is not

Parley is not:

- an agent framework
- a model router
- a sandbox
- a prompt library
- a workflow graph engine
- a replacement for your harness
- a system for granting host permissions

Parley coordinates durable project state. Your harness still runs the agents.

## Install

### OpenClaw / ClawHub

Install Parley as an OpenClaw plugin from ClawHub:

```sh
openclaw plugins install clawhub:@nkuhanas/parley
```

### npm

Install the npm package directly when you want the JavaScript API, CLI, or service daemon outside OpenClaw plugin installation:

```sh
npm install @nkuhanas/parley
```

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

## Runtime modes

Parley can run in several modes:

| Mode | Use when |
|---|---|
| `standalone` | You are evaluating Parley locally or using one local agent setup |
| `service` | You want a shared Parley backend process |
| `client` | An adapter/plugin should connect to an existing Parley service |
| `test` | Tests need isolated temporary state |

If you are evaluating Parley for the first time, start with `standalone`.

If you are coordinating multiple agents, machines, or runtimes, run a Parley service and point adapters at it in `client` mode.

## Bootstrap flow

A typical first interaction is:

1. Install Parley.
2. Configure an agent identity.
3. Call `parley_describe`.
4. Call `parley_where_am_i`.
5. Inspect available boards and obligations.
6. Record or resolve coordination state.

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

## Core surfaces

| Surface | Examples | Purpose |
|---|---|---|
| Recovery | `parley_describe`, `parley_where_am_i`, `parley_my_boards` | Help agents recover identity, scope, and next work |
| Runtime protocol | threads, messages, turns | Coordinate bounded exchanges outside board state |
| Board records | artifacts, objects, effects, relationships | Persist durable evidence and project context |
| Obligations | create, query, resolve obligations | Track who needs to do what |
| Plans | setup, review, activate, advance, validate | Govern lifecycle-managed work |
| Triggers | create triggers | Bind future coordination events to board state |
| Validation | validate plan/state | Detect invalid or inconsistent coordination state |

`parley_describe` is the self-describing metadata tool for fresh agents. Omit `topic` for the overview; use topics such as `recovery`, `targets`, `query`, `query.runtime_obligations`, `query.board_obligations`, `query.search`, `mutate`, `mutate.create_plan`, and `boards/identity` for structured schemas, valid values, aliases, and examples.

`parley_where_am_i({})` is boardless runtime recovery plus board discovery hints. All board-scoped reads and writes require an explicit `boardId`; `default_board` is returned as a selection hint, not silently applied.

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

## Use cases

Parley is useful for:

- recovering cold agents after restart or context compaction
- coordinating multiple agents on one project
- tracking artifacts and effects across long-running work
- maintaining plan lifecycle state outside chat
- separating agent runtime execution from durable project state
- running OpenClaw agents against a shared coordination backend
- giving Codex CLI agents a durable coordination layer through CLI or HTTP
- using custom scripts or non-OpenClaw runtimes against Parley service APIs
- supporting human review, approvals, and handoffs through obligations

## State synchronization

Parley records coordination state. It does not automatically know about external changes made outside Parley.

If a human, script, or agent changes project files, deployment state, or external systems without recording an artifact, effect, checkpoint, or obligation update in Parley, the board may become stale.

For reliable coordination, significant external changes should be recorded through Parley.

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

## Roadmap

Potential future work:

- more end-to-end recovery and handoff examples
- Codex CLI integration examples
- event/audit export
- webhooks for effect, obligation, and plan events
- richer service deployment docs
- generated schema/reference documentation

## Status

Parley is release-candidate software. Current goals are a stable JavaScript package shape, repo-backed ClawHub distribution, OpenClaw plugin metadata, a generic board configuration model, reliable recovery surfaces, scoped authority, agent-facing guidance, and passing tests.

## License

Apache-2.0. See `LICENSE`.
