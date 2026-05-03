# Protocol

Parley protocol state is stored as structured records, not implied by prose.

## Thread protocol

The thread tools support opening, replying, claiming, probing, settling, and concluding coordination threads. Thread control markers are structured fields and should not be inferred from message text.

Threads are runtime protocol records. They are not board-state artifacts or board coordination objects, and they are not board-affined by default.

## Board-state protocol

Board state is built from:

1. artifacts
2. coordination objects
3. effects
4. obligations
5. relationships
6. checkpoints

Effects are append-only. Projections derive current state from records and deterministic ordering.

The board storage record class remains `obligation`. The external target/query kind `board_obligation` is used only when Parley must distinguish board obligations from runtime obligations.

## Target protocol

Targetability is shared. Resolution is scope-specific. Actionability is derived.

Runtime target kinds do not require `boardId` and resolve through runtime protocol state:

- `thread`
- `message`
- `turn`

Board target kinds require `boardId` and resolve through board state:

- `plan`
- `artifact`
- `object`
- `phase`
- `relationship`
- `checkpoint`
- `board_obligation`

Resolver rules:

- runtime target + no `boardId` is valid
- runtime target + `boardId` is rejected unless an action explicitly documents `boardId` as a filter, not a resolver
- board target + no `boardId` is rejected
- board target + `boardId` resolves through board state

Scope is not durability: runtime targets may be persisted, and board targets may reference external documents. Scope is about ownership and resolution, not whether JSON or files exist.

## Recovery protocol

Recommended recovery sequence:

```txt
parley_describe({ topic: "recovery" }) -> parley_where_am_i({}) -> parley_where_am_i({ boardId: default_board }) -> parley_query_board_obligations({ boardId, filter: "needs_my_action" }) -> parley_where_am_i({ boardId: each other active board })
# add verbosity: "full" to where_am_i only when diagnostic detail is needed
```

`parley_describe` is metadata/introspection and does not mutate board state. Topic omitted returns an overview. Unknown topics return valid topics plus a describe hint. `parley_describe({ boardId })` returns board metadata only, not board state records.

`parley_where_am_i({})` returns runtime identity, runtime protocol obligations, and available boards/default board metadata. It does not imply there is no board work when runtime obligations are empty.

`parley_where_am_i({ boardId })` returns compact separate runtime and board sections by default. The runtime section contains runtime protocol obligations. The board section contains action-oriented board-local identity, board obligations, deferred work, approvals, checkpoints, and projection summaries. Use `parley_where_am_i({ boardId, verbosity: "full" })` for full diagnostic detail.

`my_boards` remains a boardless discovery query. All board-scoped queries and mutations require explicit `boardId`; `default_board` is a discovery hint, not implicit routing.

Use `parley_query_runtime_obligations({ filter: "needs_my_action" })` when a caller needs runtime protocol obligations such as pending thread turns.

Use `parley_query_board_obligations({ boardId, filter: "needs_my_action", targetKinds: ["plans"] })` when a caller needs board-scoped obligations. `targetKinds` filters board target kinds only; it does not accept runtime targets such as threads.

Use `parley_query_search({ boardId, query, namespaces })` to search board-registered reference namespaces. Search is artifact/reference/content-oriented and does not return runtime threads or messages. Future runtime thread discovery should use an explicit runtime query action.

`parley_query` and `parley_mutate` are advanced compatibility facades over first-class read/write tools. Prefer first-class tools in agent-facing workflows because the tool name should match the caller's operational intent.

## Agent-facing output protocol

Parley tool responses are coordination-service responses, not raw developer API returns. A successful response includes compact state plus `ok`, `summary`, optional `guidance.next`, optional `guidance.avoid`, and safe `diagnostics` such as tool/action/board/agent context. Operational guidance text is centralized under `src/adapters/openclaw/guidance/` rather than embedded throughout tool implementations.

Guidance is advisory. A suggested next call helps the agent inspect or continue safely; it does not grant authority to activate, promote, mutate, or act for another participant. Diagnostic identity/runtime provenance remains available only through explicit diagnostic/full-verbosity paths.

Stay quiet when there is no actionable state. Surface blockers, stale approvals, active runtime obligations, active board obligations, thread reply obligations, or validation errors.
