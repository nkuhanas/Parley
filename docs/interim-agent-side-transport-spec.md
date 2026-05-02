# Parley Interim Agent-Side Transport Spec

Status: implemented
Authority: canonical-contract
Owner: Kairos operator + orchestrator
Scope: interim Parley transport branch using existing OpenClaw session-messaging surfaces
Concrete plugin identity: Parley
Implementation branch: no-FR/no-PR interim branch
Depends on:
- `docs/mvp-thread-protocol-spec.md`
- `plans/mvp-implementation-plan.md`

## 1. Purpose

Define the interim Parley branch that can work with currently available OpenClaw surfaces, without requiring a new upstream plugin runtime API or platform change.

This branch keeps Parley as the canonical thread and protocol runtime.
Parley returns a transport handoff payload, and delivery may then be performed either by the caller or by a bounded helper tool that consumes that handoff and records the result back into canon.

## 1.1 Implementation reality check, 2026-04-22

The local Kairos branch is no longer hypothetical.
Live testing on 2026-04-22 verified the original caller-managed helper path, and the current local branch now narrows the normal path further:

- `parley_open_thread` still returns `transport_required` plus `transport_request` when the opening message still needs explicit delivery
- `parley_reply_thread`, `parley_settle_turn`, and `parley_conclude_thread` auto-dispatch after persisting canonical state
- `parley_claim_turn` stays local-only by default so bodyless claims do not emit empty visible messages
- recipient-side return routing resolves back to the initiator-side session key when `initiatorSessionKey` / `participantSessionKeys` are present in canonical transport correlation
- `parley_dispatch_transport_request` remains available for still-pending canonical messages and fallback/debug use

## 2. Architecture decision

### 2.1 Canonical ownership

Parley remains the canonical owner of:

- thread identity
- message identity
- turn control
- settling semantics
- protocol rendering
- transport correlation state
- transport status recorded against canonical messages

Native OpenClaw messaging remains substrate only.
In this branch, the actual delivery call is made by the caller rather than by Parley runtime internals.

### 2.2 Consequence

This branch deliberately splits:

- **Parley-owned canon and rendering**
- **delivery execution performed outside the main action mutation step**

That delivery execution may be caller-managed or delegated to a bounded helper such as `parley_dispatch_transport_request`.
The caller must treat Parley output as a transport artifact, not as normal assistant-authored prose.

## 3. Branch scope

### 3.1 In scope

- existing Parley thread and message canon
- existing Parley action surface
- explicit transport handoff payloads returned by Parley actions
- use of existing `sessions_send` semantics for actual delivery
- explicit recording of accepted or failed delivery back into Parley state
- preservation of thread-level accountability metadata such as `origin_kind` and `report_back_policy`
- the local helper tool `parley_dispatch_transport_request` as a bounded bridge that consumes a canonical handoff and records outcome back into Parley state

### 3.2 Out of scope

- new OpenClaw plugin runtime transport APIs
- a stable first-class upstream plugin runtime transport surface for `sessions.send`
- reply-target semantics beyond explicit session-key targeting
- transcript-entry identifiers
- transport history introspection beyond what Parley explicitly records
- automatic recovery of missing delivery acknowledgements without follow-up action

## 4. Core transport rule

Parley-generated outbound text is an opaque transport artifact.

The caller must:

- send it exactly as returned
- not rewrite it
- not summarize it
- not partially embed it in ordinary prose
- not hand-author protocol blocks as a substitute for calling Parley

This rule exists to prevent protocol formatting from becoming part of normal agent speaking style.

## 5. Action surface

This branch keeps the existing first-class Parley actions:

- `parley_open_thread`
- `parley_claim_turn`
- `parley_reply_thread`
- `parley_probe_thread`
- `parley_settle_turn`
- `parley_conclude_thread`

Any Parley action that creates an outbound communication obligation may return a transport handoff payload.

## 6. Transport handoff contract

### 6.1 Result shape

When delivery is required, a Parley action must return:

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

When no delivery is required, `transport_required` should be `false` or omitted.

### 6.2 Required fields

#### `mode`

Fixed value for this branch:

- `agent_sessions_send`

This makes the dispatch path explicit and branch-specific.

#### `target_session_key`

The literal OpenClaw target session key the caller must send to.

This branch does not perform label resolution or routing inference.

#### `outbound_text`

The exact rendered transport text to send.

This value is opaque to the caller.
It may contain protocol-managed formatting and should not be edited.

#### `idempotency_key`

A canonical Parley-generated idempotency key.

Recommended format:

- `parley:<thread_id>:<message_id>`

#### `canonical_thread_id`
- canonical Parley thread identifier

#### `canonical_message_id`
- canonical Parley message identifier associated with this outbound send

## 7. Caller obligations

The caller workflow is:

1. invoke a Parley action
2. inspect the result
3. if `transport_required` is not true, stop unless you are handling a separate human-summary obligation or explicitly debugging a failed transport state
4. if `transport_required` is true, do one of the following:
   - preferred local Kairos interim path: call `parley_dispatch_transport_request(threadId=thread.thread_id, messageId=message.message_id)`
   - generic branch contract path: call `sessions_send` with:
     - `sessionKey = target_session_key`
     - `message = outbound_text`
5. capture accepted or failed transport outcome
6. record that outcome back into Parley state, either inside the helper tool or explicitly through `parley_record_transport_result`
7. if the thread carries `report_back_policy = summary_to_human`, preserve the separate obligation for the initiator to send a concise human-facing summary after the agent-to-agent exchange settles back

As of the current local branch, the preferred local helper path remains available, but it is no longer the normal path for reply/settle/conclude because those actions auto-dispatch.

The caller must not treat a rendered transport request as already delivered.

## 8. Transport result recording

This branch requires an explicit Parley-side result recording step so canonical state does not confuse rendered output with successful delivery.

### 8.1 Recommended tools

Generic branch contract:

- `parley_record_transport_result`

Current local Kairos helper path:

- `parley_dispatch_transport_request`
- `parley_record_transport_result` remains available when explicit manual outcome recording is still desired

### 8.2 Suggested parameters

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

### 8.3 Semantics

- `accepted` means the caller received successful acceptance from `sessions_send`
- `failed` means delivery did not reach accepted state
- `transportMessageRef` stores the best available accepted transport handle when one exists
- `error` stores normalized transport failure data when delivery fails
- when using `parley_dispatch_transport_request`, these updates are performed by the helper tool rather than a second explicit caller step
- helper dispatch should fail closed unless the addressed message is still the thread's latest `pending_dispatch` message

## 9. Canonical transport state

Each canonical Parley message should track transport state independently from protocol state.

Recommended transport states:

- `not_required`
- `pending_dispatch`
- `accepted`
- `failed`

Recommended related fields:

- `transport_target_session_key`
- `transport_idempotency_key`
- `transport_message_ref`
- `transport_error`
- `transport_attempted_at`
- `transport_accepted_at`

## 10. Failure model

### 10.1 Rendered is not sent

A Parley action that returns a transport payload has only completed protocol rendering, not delivery.

### 10.2 Caller drop risk

If the caller fails to execute `sessions_send`, the canonical Parley message remains unsent.

This branch therefore depends on explicit result recording for correctness.

### 10.3 Recovery posture

This branch does not require automatic transport reconciliation.

If stronger recovery is later needed, it should be added as a bounded enhancement rather than changing thread canon.

## 11. Anti-contamination rule

This branch must explicitly document the following operating rule:

> Parley protocol text is tool-managed transport payload, not normal assistant-authored prose.

The intended workflow is:

- Parley renders
- caller dispatches
- caller records result

The intended workflow is not:

- agent imitates Parley formatting manually
- agent rewrites Parley protocol text in chat style
- agent learns protocol block authoring as a general habit

## 12. Implementation guidance

### 12.1 Rendering boundary

Keep protocol block and outbound text rendering entirely inside Parley modules.
Do not move transport formatting rules into agent prompts.

### 12.2 Thin caller glue

Prefer a tiny helper or wrapper path around `sessions_send` if available, so the conceptual operation remains:

- dispatch Parley transport request

rather than:

- manually compose and send special text

The current local Kairos implementation provides that wrapper as `parley_dispatch_transport_request`, and live testing verified that it can resolve transport from canonical ids and record accepted dispatch in Parley canon.

### 12.3 Extraction readiness

Even in this interim branch, the Parley-specific contract should remain extraction-ready.
Only the transport dispatch step is provisional.
Canonical thread records, message records, and protocol semantics should remain compatible with a later native transport adapter.

## 13. Graduation path

When a native plugin-safe transport surface becomes available, only the transport execution boundary should change.

Target future shape:

- caller no longer dispatches `sessions_send`
- Parley transport adapter performs native send directly
- canonical thread and message records remain valid
- public thread semantics remain unchanged

This keeps the interim branch as a practical stepping stone rather than a dead-end fork.
