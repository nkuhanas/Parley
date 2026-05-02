# Parley

Parley is a domain-oriented coordination runtime for AI agents.

It gives agents a durable way to coordinate across boards, across participants, and across state without turning every task into an ad hoc chat transcript. Parley tracks who is involved, what board the work belongs to, what artifacts are being coordinated, what effects have happened, what obligations remain, and what each agent should recover when it wakes back up.

Parley v2 is still early and being field-tested. The public shape will keep improving as real users and real boards flow through it, but the core direction is already clear: **Parley is coordination infrastructure for multi-agent work that needs memory, routing, review, self-healing, and board-scoped accountability.**

## Why Parley

Most agent coordination today is either:

- loose chat messages that disappear into context windows,
- task queues with little protocol state,
- project-management records that do not understand agent identity,
- or bespoke glue that works for one workflow and breaks under multi-board operation.

Parley is different. It models coordination as a first-class domain:

```txt
runtime caller -> global agent -> board membership -> board-local identity

artifact -> coordination object -> effect -> obligation -> projection
```

That means Parley can answer questions that ordinary chat or task tools cannot answer reliably:

- Who is this agent globally?
- Which boards can it operate on?
- What is its default board?
- What identity does it use inside each board?
- What obligations are active on this board?
- Which approvals are stale because the artifact changed?
- What relationships exist between plans, reviews, decisions, and artifacts?
- What should an agent recover when it wakes up after compaction, restart, or handoff?

## What Parley is good for

Use Parley when work needs coordinated state, not just a message.

Strong fits:

- multi-agent review and handoff
- implementation plans that need approvals or objections
- long-running board-scoped work across multiple repos or project areas
- agent obligations that must survive context loss
- artifact-backed coordination around plans, docs, source, decisions, or generated outputs
- cross-board agent operation where one agent participates in several domains
- heartbeat-driven self-healing so agents can rediscover pending work
- human-origin work that needs a final summary back to the human-visible anchor

Poor fits:

- one-off stateless chat
- autonomous execution policy
- general task queues unrelated to coordination
- broad project management with no agent protocol needs
- replacing a repo, vault, or content pipeline as source of truth

Parley coordinates work. It does not own every workflow around the work.

## Core concepts

### Boards

A board is the coordination boundary for a domain of work. A board defines storage roots, artifact namespaces, policy, and board-local members.

Examples:

- `kairos` for Kairos system work
- `parley` for Parley runtime work
- future project boards for product, research, content, operations, or customer-specific domains

Each board has its own state and artifact rules. This keeps obligations and artifacts from different domains from collapsing into one global bucket.

### Global agents and board-local agents

Parley separates global agent identity from board-local identity.

```txt
runtime_ref -> global_agent_id -> board membership -> board_agent_id + permissions
```

- `runtime_ref`: the concrete runtime caller, such as an OpenClaw agent/session/subagent.
- `global_agent_id`: the durable Parley-wide participant identity.
- `board_agent_id`: the identity used inside one board's records and projections.

In simple setups these can use the same string. The model does not require that, which lets one runtime agent participate in many boards without duplicating the agent itself.

### Artifacts, objects, effects, and obligations

Parley board state is built from durable records:

- **Artifacts** reference plans, docs, source files, outputs, or managed local bodies.
- **Coordination objects** represent review requests, plans, decisions, or other coordination targets.
- **Effects** are append-only facts about what happened.
- **Obligations** are actionable assignments derived from coordination.
- **Relationships** connect artifacts and objects into a board graph.
- **Checkpoints** let agents compare and advance what they have seen.

This is the basis for Parley's self-healing behavior: agents do not need to remember every prior message; they can query board state and recover their current obligations.

## Self-healing agent operation

Parley is designed for agents that wake up repeatedly: heartbeats, restarts, compacted sessions, handoffs, and uncertain task recovery.

Recommended standard for heartbeat/self-healing loops:

```txt
my_boards -> where_am_i(default board) -> where_am_i(each other active board)
```

In practice:

1. Call `parley_query({ action: "my_boards" })`.
2. Start with the returned `default_board`.
3. Call `parley_query({ action: "where_am_i", boardId })` for each active board.
4. Stay quiet unless a board has actionable obligations, stale approvals, blockers, or errors.

Recommended standard for ad hoc recovery:

```txt
where_am_i() first, then my_boards if the work may span boards
```

Plain `where_am_i()` intentionally resolves only the caller's default board. That keeps ordinary board-scoped recovery fast and predictable. `my_boards` is the separate map of where the caller can operate.

## OpenClaw tool surface

Parley exports OpenClaw tool factories through `registerParleyTools(api)`.

Current high-level query/mutate façade:

```js
parley_query({ action: "my_boards" })
parley_query({ action: "where_am_i" })
parley_query({ action: "where_am_i", boardId: "parley" })
parley_query({ action: "board" })
parley_query({ action: "validate_state" })

parley_mutate({ action: "register_artifact", input: { /* ... */ } })
parley_mutate({ action: "create_object", input: { /* ... */ } })
parley_mutate({ action: "record_effect", input: { /* ... */ } })
parley_mutate({ action: "create_obligation", input: { /* ... */ } })
parley_mutate({ action: "record_relationship", input: { /* ... */ } })
parley_mutate({ action: "remove_relationship", input: { /* ... */ } })
parley_mutate({ action: "create_plan", input: { /* ... */ } })
```

Lower-level typed tools are also exported for direct integration, including thread control, artifact/object/effect/obligation records, relationships, projection checkpoints, state validation, and human-summary anchors.

Unsupported actions fail closed. Parley should not become an unbounded generic tool bag.

## Quick start for integrators

Parley is currently a local/private package while v2 is being hardened.

```sh
npm install
npm test
```

Register Parley tools from a consuming OpenClaw plugin:

```js
import { registerParleyTools } from "@nkuhanas/parley";

export default {
  id: "my-parley-plugin",
  name: "My Parley Plugin",
  register(api) {
    registerParleyTools(api);
  }
};
```

Provide board and registry configuration through the plugin config:

```js
const pluginConfig = {
  parleyRoot: "/home/agent/.local/share/parley",
  parleyRegistry: {
    agents: {
      "my-agent": {
        display_name: "My Agent",
        kind: "agent",
        runtime_bindings: [
          { scheme: "openclaw", type: "agent", id: "my-agent" }
        ],
        default_board: "project",
        memberships: {
          project: {
            board_agent_id: "my-agent",
            roles: ["implementation"],
            permissions: { preset: "board_admin" }
          }
        }
      }
    }
  },
  parleyBoards: {
    project: {
      board_id: "project",
      display_name: "Project",
      board_root: "/home/agent/.local/share/parley/boards/project",
      artifact_namespaces: [
        {
          id: "project_plans",
          roles: ["plan_landing", "explicit_landing", "reference"],
          default_for: ["plan_landing"],
          uri_prefix: "repo://plans/",
          resolved_root: "/home/agent/workspace/Project/plans"
        }
      ],
      members: [
        {
          agent_id: "my-agent",
          board_agent_id: "my-agent",
          roles: ["implementation"],
          permissions: { preset: "board_admin" }
        }
      ]
    }
  }
};
```

Then smoke the identity path:

```js
parley_query({ action: "my_boards" })
parley_query({ action: "where_am_i" })
```

## Recommended onboarding path

For a new Parley deployment:

1. **Create one board first.** Give it a stable lowercase `board_id`, state root, managed artifact root, and one `plan_landing` namespace.
2. **Register one global agent.** Bind it to the runtime identity that will call Parley.
3. **Choose a default board.** Default-board resolution should be obvious and fail closed if missing.
4. **Add board membership.** Map the global agent to a board-local `board_agent_id`, roles, and permissions.
5. **Run `my_boards`.** Confirm the caller resolves globally and sees the expected board list.
6. **Run `where_am_i`.** Confirm the default board resolves and obligations are empty or expected.
7. **Add a tiny coordination record.** Register an artifact, create an object, record an effect, create an obligation, then verify it appears in `where_am_i`.
8. **Add heartbeat recovery.** Use the recommended self-healing loop across active boards.
9. **Only then add more boards.** Multi-board power is useful after the default path is boringly reliable.

## Current status

Parley v2 is actively iterating. The current repository includes:

- MVP thread protocol runtime
- human-summary anchor support
- board-scoped artifact/object/effect/obligation records
- relationship graph state
- scoped approval/stale approval projections
- activation/deferred-work visibility
- `where_am_i`, `my_boards`, board projection, checkpoints, and validation
- OpenClaw tool factories and query/mutate façades
- Kairos and Parley board adapters used for dogfooding

Still expected to evolve:

- board creation/onboarding helpers
- stronger validation around runtime binding drift
- broader field-tested permission models
- richer docs and examples as real users adopt boards
- cleaner public packaging once the v2 surface stabilizes

## Validation

```sh
npm test
```

The test suite covers thread protocol behavior, plan v1 helpers, board-state identity resolution, projections, relationships, state validation, query/mutate façades, and the current self-healing board lookup path.

## Design docs

- `docs/mvp-thread-protocol-spec.md`
- `docs/human-summary-anchor-contract.md`
- `docs/operator-orchestrator-integration-contract.md`
- `plans/mvp-implementation-plan.md`
- `plans/v2-artifact-backed-coordination-board-plan.md`

## Project boundary

Parley should own coordination state and protocol behavior. Consuming projects should own their domain-specific board defaults, artifact bodies, deployment policy, and execution policy.

That boundary is what lets Parley coordinate across boards, agents, and state without becoming the thing that executes every workflow itself.
