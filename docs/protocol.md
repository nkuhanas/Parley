# Protocol

Parley protocol state is stored as structured records, not implied by prose.

## Thread protocol

The thread tools support opening, replying, claiming, probing, settling, and concluding coordination threads. Thread control markers are structured fields and should not be inferred from message text.

## Board-state protocol

Board state is built from:

1. artifacts
2. coordination objects
3. effects
4. obligations
5. relationships
6. checkpoints

Effects are append-only. Projections derive current state from records and deterministic ordering.

## Recovery protocol

Recommended recovery sequence:

```txt
my_boards -> where_am_i({ boardId: default_board }) -> obligations({ boardId, filter: needs_my_action }) -> where_am_i({ boardId: each other active board })
```

`my_boards` is the only boardless discovery query. All board-scoped queries and mutations require explicit `boardId`; `default_board` is a discovery hint, not implicit routing.

Use `parley_query({ action: "obligations", boardId, input: { filter: "needs_my_action", targetKinds: ["threads", "plans"] } })` when a caller needs obligation-centric recovery across target kinds without making each target kind its own query action. `scope` is accepted as an alias for `targetKinds`.

Use `parley_query({ action: "search", boardId, input: { query, namespaces } })` to search board-registered reference namespaces. This keeps discovery routed through board namespace policy instead of host-specific search tools.

Stay quiet when there is no actionable state. Surface blockers, stale approvals, active obligations, thread reply obligations, or validation errors.
