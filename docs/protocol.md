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
my_boards -> where_am_i(default board) -> where_am_i(each other active board)
```

Stay quiet when there is no actionable state. Surface blockers, stale approvals, active obligations, or validation errors.
