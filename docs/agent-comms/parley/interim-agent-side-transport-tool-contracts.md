# Parley Interim Agent-Side Transport Tool Contracts

Status: implemented
Authority: canonical-contract
Owner: Kairos operator + orchestrator
Scope: public Parley tool contract deltas for the interim transport branch
Concrete plugin identity: Parley
Implementation branch: no-FR/no-PR interim branch
Depends on:
- `docs/agent-comms/parley/mvp-thread-protocol-spec.md`
- `plans/agent-comms/parley/mvp-implementation-plan.md`
- `docs/agent-comms/parley/interim-agent-side-transport-spec.md`

## 1. Purpose

Define the implementation-ready public tool contract deltas for the interim Parley branch where Parley owns canon and rendering, while delivery execution happens through existing `sessions_send` semantics rather than a new upstream runtime transport API.

This document is intentionally concrete.
It describes the expected result shape, follow-up transport recording tool, and caller flow changes needed to move the branch from architectural intent to buildable contract.

## 1.1 Implementation reality check, 2026-04-22

The local Kairos implementation now matches the core contract described here.
Live verification on 2026-04-22 confirmed that:

- `parley_open_thread` still returns caller-managed transport handoff when a real outbound message still needs explicit dispatch
- `parley_reply_thread`, `parley_settle_turn`, and `parley_conclude_thread` now auto-dispatch after persisting canonical state
- `parley_claim_turn` now records a local-only control marker by default so bodyless claims do not emit empty visible messages
- recipient-side return routing resolves to the initiator-side session key when canonical transport correlation includes `initiatorSessionKey` / `participantSessionKeys`
- `parley_dispatch_transport_request` remains available as a fallback/debug helper for still-pending canonical messages
- visible return delivery back into the origin Discord session occurred during the live round-trip test
- `parley_open_thread` now also returns generated `human_summary_anchor_request` output for human-origin `summary_to_human` threads when no caller-supplied anchor is provided
- `parley_record_human_summary_anchor` now records the caller-delivered human-visible anchor into canonical thread state
- `parley_settle_turn` now also returns a sparse `human_summary_update_request` when a recorded human-summary anchor exists and a meaningful settled state should be reflected back to the human

## 2. Contract posture

Source-of-truth order for Parley behavior in this interim branch is:

1. tool-enforced behavior and returned result fields
2. global Parley docs in `docs/agent-comms/`
3. agent-local guidance such as workspace `TOOLS.md`

Agent-local docs may summarize how a specific caller should react to returned fields, but they should not redefine, extend, or outrank the protocol encoded in the tool surface itself.

The existing public action names remain unchanged:

- `parley_open_thread`
- `parley_claim_turn`
- `parley_reply_thread`
- `parley_probe_thread`
- `parley_settle_turn`
- `parley_conclude_thread`

This branch changes the result contract of those actions when an outbound delivery obligation exists.

The current result shape returns `transport_sent` and `transport` based on an immediate runtime dispatch attempt.
In the interim branch, those fields should be replaced by an explicit handoff contract that separates:

- canonical state mutation
- transport dispatch requirement
- later transport outcome recording

## 2.1 Bounded default posture

For the bounded normal path, `parley_open_thread` should be easy to call correctly with minimal doctrine.
The current local implementation therefore defaults omitted fields as follows:

- `kind` -> `coordination`
- `controlMode` -> `peer`
- `nextActionOwner` -> `recipient`
- `originKind` -> `agent`

These are convenience defaults, not hidden alternate semantics.
They should keep the common operator↔orchestrator path short without weakening canonical state.

The important boundary is that `originKind` is still a caller-intent field, but human-summary policy is no longer a normal caller-facing knob.
Callers should set `originKind` explicitly when the thread exists because of a human request.
Do not rely on opening-body phrasing such as "under my request" or similar prose hints to derive those values after the fact.

For the current bounded path:
- explicitly pass `originKind = human` when the thread exists because of a human request
- when `originKind = human`, Parley should derive the internal `report_back_policy = summary_to_human` by default
- if a caller wants a human-origin thread with no final human summary, it should explicitly pass `suppressHumanSummary = true`
- `reportBackPolicy` is archived from the active caller contract and should not be used in normal tool calls

## 3. Standard action result shape

All Parley actions should continue returning a structured result with:

```json
{
  "tool": "string",
  "thread": {},
  "message": {},
  "note": "string",
  "status": {
    "headline": "string",
    "bounded_thread": true,
    "thread": {},
    "message": {},
    "transport": {},
    "human_summary": {},
    "workflow": {
      "phase": "string",
      "settled_to_initiator": true,
      "report_back_due": false,
      "ready_for_human_report": false,
      "blocked_on_anchor": false,
      "next_steps": ["string"]
    }
  }
}
```

The `status` block is a compact observability layer.
It should let a caller answer "what happened" without re-deriving meaning from multiple raw fields.
It is explanatory rather than canonical; canonical truth still lives in the persisted `thread` and `message` records.
The `workflow` subsection is specifically for bounded-flow obviousness: it should make the next likely operator action legible without moving authority out of the canonical protocol fields.

When no outbound transport is required, the result should additionally contain:

```json
{
  "transport_required": false
}
```

When outbound transport is required, the result must additionally contain:

```json
{
  "transport_required": true,
  "transport_request": {
    "mode": "agent_sessions_send",
    "target_session_key": "string",
    "outbound_text": "string",
    "idempotency_key": "parley:<thread_id>:<message_id>",
    "canonical_thread_id": "string",
    "canonical_message_id": "string"
  }
}
```

When a recorded human-summary anchor exists and the action wants to surface a sparse human-visible state reflection, the result may also contain:

```json
{
  "human_summary_update_available": true,
  "human_summary_update_request": {
    "mode": "caller_reply",
    "style": "state_update",
    "target_message_id": "string",
    "canonical_thread_id": "string",
    "canonical_message_id": "string",
    "update_text": "string"
  }
}
```

The associated `thread` record should also carry any thread-level accountability metadata already established by the protocol, including `origin_kind`, derived internal `report_back_policy`, and `human_summary_anchor` when applicable.
These fields do not change the transport handoff shape, but they do affect what the initiator still owes after the thread settles back, including whether the final human-facing completion update must reply to a canonical anchor/sendoff message.

A likely next iteration is standardized Parley-generated anchor/sendoff text plus caller-managed anchor recording. That follow-up contract is drafted in `docs/agent-comms/parley/human-summary-anchor-contract.md`.

## 4. Required result-field semantics

### 4.1 `tool`

The tool id that performed the canonical mutation.

### 4.2 `thread`

The post-mutation canonical thread record.
This record must already be persisted before the result is returned.

### 4.3 `message`

The newly persisted canonical message record.
This record must exist even when transport has not yet been dispatched.

### 4.4 `note`

Human-readable summary of what changed.
In this branch the note must describe the result as canonical state mutation plus transport handoff generation, not as successful send.

### 4.5 `status`

Compact derived observability summary for the caller.
This block should make the bounded thread lifecycle, latest message type, transport state, and human-summary anchor state obvious at a glance.
It should not become a second source of canonical truth.

The `workflow` subsection should remain narrow and practical.
It exists to reduce caller-side doctrine by surfacing the likely next bounded-flow step, not to become a planner or policy engine.

### 4.6 `transport_required`

Boolean indicator that the caller must perform a follow-up transport step.

### 4.7 `transport_request`

Opaque transport handoff payload generated by Parley.
The caller may inspect routing fields, but must not rewrite `outbound_text`.

## 5. Recommended note wording

To avoid semantic drift, notes for transport-bearing actions should use language like:

- `Canonical Parley records created and transport handoff generated for caller-managed dispatch.`
- `Substantive reply recorded in canonical state and transport handoff generated for caller-managed dispatch.`
- `Turn settled in canonical state and transport handoff generated for caller-managed dispatch.`

Avoid wording like:

- `transport dispatch attempted`
- `sent`
- `accepted`

unless those claims are being made by the separate transport-result recording tool.

## 6. Which actions should return `transport_required: true`

For the interim branch, transport defaults are now action-specific.

That means the expected default is:

- `parley_open_thread` -> usually `true`
- `parley_claim_turn` -> usually `false` for the default bodyless control marker
- `parley_reply_thread` -> auto-dispatches and therefore returns `false`
- `parley_probe_thread` -> usually `true`
- `parley_settle_turn` -> auto-dispatches and therefore returns `false`
- `parley_conclude_thread` -> auto-dispatches and therefore returns `false`

If a future case exists where a canonical mutation should stay local only, that action may return `transport_required: false`.

For the bounded normal path, `parley_conclude_thread` should also fail closed unless the initiator currently owns the next action.
That keeps conclusion aligned with explicit turn ownership instead of letting callers terminate threads from the wrong side of the handoff.

## 7. Transport-request field details

### 7.1 `mode`

Fixed branch value:

- `agent_sessions_send`

### 7.2 `target_session_key`

Must be copied from canonical transport correlation state.
This branch requires explicit target session addressing.

### 7.3 `outbound_text`

Must be the exact value produced by Parley rendering.
This field is opaque and verbatim-send only.

### 7.4 `idempotency_key`

Must be generated by Parley, not by the caller.
Recommended format:

- `parley:<thread_id>:<message_id>`

### 7.5 `canonical_thread_id`

Must equal `thread.thread_id` in the same result.

### 7.6 `canonical_message_id`

Must equal `message.message_id` in the same result.

## 8. New follow-up tool

This branch should add one new public tool:

- `parley_record_transport_result`

### 8.1 Purpose

Record the caller-observed outcome of the separate transport dispatch step.
This is the point at which a message becomes canonically accepted or failed for transport.

### 8.2 Parameters

```json
{
  "threadId": "string",
  "messageId": "string",
  "status": "accepted | failed",
  "transportMessageRef": "string?",
  "error": {
    "code": "string",
    "message": "string"
  }?
}
```

### 8.3 Validation rules

- `threadId` required
- `messageId` required
- `status` required
- `status = accepted` may include `transportMessageRef`
- `status = failed` should include `error`
- `threadId` and `messageId` must identify an existing canonical message on the same thread
- result recording should be idempotent for repeated identical accepted/failure submissions where possible

### 8.4 Canonical effects

#### Accepted

Update the canonical message with at least:

- `transport_state = accepted`
- `transport_message_ref = transportMessageRef ?? existing value ?? null`
- `transport_accepted_at = now`
- `transport_error = null`

#### Failed

Update the canonical message with at least:

- `transport_state = failed`
- `transport_error = { code, message }`
- `transport_attempted_at = now`

The thread record may also optionally track a top-level failure hint, but message-level truth is canonical.

## 9. Recommended message-record deltas

The current message record shape already includes:

- `message_id`
- `thread_id`
- `sender`
- `message_class`
- `control_marker`
- `body_text`
- `next_action_owner`
- `created_at`
- `transport_message_ref`

For the interim branch, add:

- `transport_state`
- `transport_target_session_key`
- `transport_idempotency_key`
- `transport_error`
- `transport_attempted_at`
- `transport_accepted_at`

### 9.1 Initial values on action execution

When a Parley action creates a transport-bearing message, initialize:

```json
{
  "transport_state": "pending_dispatch",
  "transport_target_session_key": "<target session key>",
  "transport_idempotency_key": "parley:<thread_id>:<message_id>",
  "transport_message_ref": null,
  "transport_error": null,
  "transport_attempted_at": null,
  "transport_accepted_at": null
}
```

## 10. Caller reference workflow

The intended caller algorithm is:

1. call a Parley action
2. inspect `transport_required`
3. if false, stop unless you are explicitly debugging a failed transport state or handling a separate human-summary obligation
4. if true, do one of the following:
   - preferred local Kairos interim path: call `parley_dispatch_transport_request(threadId=thread.thread_id, messageId=message.message_id)`
   - generic branch contract path: invoke `sessions_send` with:
     - `sessionKey = transport_request.target_session_key`
     - `message = transport_request.outbound_text`
5. if using manual dispatch, then:
   - if `sessions_send` is accepted, call `parley_record_transport_result(status=accepted, transportMessageRef=...)`
   - if `sessions_send` fails, call `parley_record_transport_result(status=failed, error=...)`

The caller must not report delivery completion until the helper tool or explicit result-recording step has occurred.
As of the current local branch, the helper path is primarily fallback/debugging for still-pending messages because reply/settle/conclude auto-dispatch by default.
If `report_back_policy = summary_to_human`, the caller must also preserve the separate human-summary obligation after transport succeeds and after the agent-to-agent thread settles.

## 11. Concrete delta from the previous implementation

The previous implementation path used immediate runtime transport dispatch during action execution and returned:

- `transport_sent`
- `transport`

The current interim branch now does the following instead:

- stops immediate runtime transport dispatch inside action execution
- replaces dispatch with transport-request generation
- initializes canonical message transport state as `pending_dispatch`
- returns `transport_required` plus `transport_request`
- provides `parley_record_transport_result` to finalize accepted/failed transport outcome
- provides `parley_dispatch_transport_request` as the local thin helper that resolves the canonical pending message by ids and performs the bounded dispatch + result-recording pair

## 12. Compatibility and graduation

This contract is intentionally shaped so it can later graduate to a native transport adapter with minimal public churn.

When native transport becomes available:

- `transport_request.mode` may change or disappear
- caller-managed dispatch may be removed
- `parley_record_transport_result` may become internal or optional
- any temporary helper such as `parley_dispatch_transport_request` may disappear or collapse into the native adapter boundary

But the following should remain stable:

- action names
- canonical thread ids
- canonical message ids
- message-level transport correlation concepts
- Parley ownership of canon and rendering
