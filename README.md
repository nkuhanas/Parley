<p align="center">
  <img src="./docs/assets/parley-lockup.png" alt="Parley" width="460" />
</p>

<p align="center">
  <strong>Persistent coordination state for AI agents: harness-agnostic, self-describing, and recovery-first.</strong>
</p>

<p align="center">
  Parley gives agents durable coordination state outside chat history.
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
  <a href="#recovery-and-guidance">Recovery</a>
  ·
  <a href="#install">Install</a>
  ·
  <a href="#bootstrap-flow">Bootstrap</a>
  ·
  <a href="#core-surfaces">Core surfaces</a>
  ·
  <a href="./docs/supported-runtimes.md">Runtimes</a>
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

## How Parley fits

Parley separates transient agent execution from durable coordination state.

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

OpenClaw, Codex CLI, LangGraph, CrewAI, or a custom runtime can run agents. Parley sits underneath or beside those systems as durable coordination infrastructure: identity recovery, board-scoped authority, obligations, artifacts, effects, relationships, plan lifecycle state, and audit/recovery surfaces.

A caller does not gain project authority merely by invoking a tool. Parley resolves the caller, checks board membership, checks board-local permissions, and fails closed when identity or scope is ambiguous.

## Recovery and guidance

Parley is recovery-first. A cold agent can call `parley_describe`, `parley_where_am_i`, and obligation queries to recover identity, board access, pending work, and valid next actions.

Parley tools return more than raw records. They include `summary`, `guidance`, diagnostics, scoped identifiers, and safe next operations so agents do not need to keep Parley's protocol in context.

The guidance loop is:

1. A cold agent calls `parley_describe`.
2. Parley explains available capabilities and safe entry points.
3. The agent calls `parley_where_am_i`.
4. Parley returns identity, board hints, obligations, diagnostics, and next actions.
5. The agent chooses an explicit board and records artifacts, effects, or obligation resolutions.
6. Parley returns state-specific guidance for the next valid operations.

Example recovery flow:

```text
parley_describe
parley_where_am_i
parley_query_board_obligations
```

A fresh agent can use those calls to recover:

- resolved identity
- accessible boards
- open obligations
- active plan phase
- recorded artifacts/effects
- next needed action

## What Parley is not

Parley is not an agent framework, model router, sandbox, prompt library, workflow graph engine, replacement for your harness, or system for granting host permissions.

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
2. Configure one agent identity and one board.
3. Call `parley_describe`.
4. Call `parley_where_am_i`.
5. Inspect available boards and obligations.
6. Record or resolve coordination state.

Most Parley workflows need at least one registered board before board-scoped recovery, obligations, artifacts, or plans become useful. For first evaluation, start with one agent, one board, and one artifact namespace. Add more boards, roles, and namespaces only after the identity path works.

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

### Minimal config fields

| Field | What to change | Purpose |
|---|---|---|
| `parleyRoot` | Usually yes | Root directory for local Parley state in standalone/local usage |
| `parleyRegistry.agents` | Yes | Global agent identities Parley can resolve |
| `runtime_bindings` | Yes | Maps runtime caller metadata, such as OpenClaw or Codex, to a Parley agent |
| `default_board` | Usually yes | Board selection hint for recovery and bootstrap flows |
| `memberships` | Yes | Declares which boards the global agent belongs to |
| `parleyBoards` | Yes | Defines available boards and their storage/configuration |
| `board_root` | Yes | Filesystem root for board-local state |
| `artifact_namespaces` | Optional at first | Declares named artifact/search roots for plans, references, or project files |
| `roles` | Usually yes | Assigns board-local capabilities or semantic responsibilities |
| `uri_prefix` | Yes if using artifact namespaces | Stable logical URI prefix exposed to agents |
| `resolved_root` | Yes if using artifact namespaces | Actual filesystem path backing the namespace |
| `members` | Yes | Board-local member list and roles |

</details>

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

A healthy compact `parley_where_am_i({})` response looks like:

```json
{
  "ok": true,
  "summary": "Recovered runtime identity and board discovery hints.",
  "scope": "runtime",
  "runtime": {
    "identity": {
      "global_agent_id": "my-agent",
      "default_board": "project"
    },
    "obligations": []
  },
  "boards": {
    "default_board": "project",
    "available": ["project"]
  },
  "guidance": {
    "next": [
      { "tool": "parley_where_am_i", "args": { "boardId": "project" } }
    ]
  }
}
```

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

This lets the agent recover accessible boards, board-local identity, current runtime and board obligations, allowed next actions, and relevant plans, artifacts, effects, and relationships.

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

See `docs/supported-runtimes.md` for the integration contract used by OpenClaw, Codex CLI, custom scripts, and future adapters.

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

Parley records coordination state, but it does not automatically know about external changes made outside Parley. Significant external changes should be recorded as artifacts, effects, checkpoints, or obligation updates.

## Status

Parley is release-candidate software.

Current focus:

- stabilizing the service/client boundary
- improving OpenClaw primary-adapter ergonomics
- documenting Codex CLI and non-OpenClaw runtime usage
- hardening recovery, obligation, and plan lifecycle flows
- expanding end-to-end examples for mixed-runtime coordination

Potential future work:

- event/audit export
- webhooks for effect, obligation, and plan events
- richer service deployment docs
- generated schema/reference documentation

## License

Apache-2.0. See `LICENSE`.
