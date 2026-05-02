# Concepts

## Board

A board is a coordination boundary for a domain of work. It owns storage roots, artifact namespaces, members, and policy.

## Runtime ref

A `runtime_ref` identifies the concrete caller, such as an OpenClaw agent, session, or subagent.

## Global agent

A global agent is the durable Parley-wide identity resolved from runtime bindings.

## Board agent

A board agent is the identity used inside one board's records. One global agent can have different board-local identities on different boards.

## Runtime protocol record

A runtime protocol record belongs to Parley's communication/control-plane layer, not to board state.

Initial runtime protocol records are:

- thread
- message
- turn

Threads may be persisted, but they are not board-affined. Their ownership and resolution come from the runtime protocol layer.

## Artifact

An artifact references a plan, source file, document, output, or managed local body.

## Coordination object

A coordination object is the thing being coordinated, such as a plan, review request, decision, or handoff.

## Plan

A plan is a board-state coordination subject. In the current model, a plan is represented through board artifact/object state rather than a separate required storage table.

## Effect

An effect is an append-only fact about something that happened.

## Obligation

A board obligation is an actionable assignment to a board agent. The board storage record class remains `obligation`; external query and target surfaces use `board_obligation` when they must distinguish board obligations from runtime obligations.

A runtime obligation is an actionable assignment derived from runtime protocol state, such as a pending thread turn or a human-summary anchor requirement. Runtime obligations are not resolved through board membership.

## Targetable entity

A targetable entity is anything Parley can reference from obligations, effects, relationships, checkpoints, approvals, projections, or query results.

Targetability is shared. Resolution is scope-specific. Actionability is derived.

Targetability does not imply the entity currently needs attention. An entity becomes actionable only when an active obligation or projection requires attention.

## Target scopes

Runtime targets do not require `boardId` and are resolved by the runtime protocol layer:

- `thread`
- `message`
- `turn`

Board targets require `boardId` and are resolved by board state:

- `plan`
- `artifact`
- `object`
- `phase`
- `relationship`
- `checkpoint`
- `board_obligation`

## Scope is not durability

Runtime targets may be persisted, and board targets may reference external documents. The distinction is not whether a record is saved. The distinction is ownership and resolution:

- Runtime targets are owned and resolved by the runtime protocol layer.
- Board targets are owned and resolved by board state.

## Projection

A projection derives useful current state from durable records or runtime protocol records, such as active board obligations, runtime obligations, or stale approvals.
