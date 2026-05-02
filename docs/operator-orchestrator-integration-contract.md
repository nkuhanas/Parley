# Parley Operator-Orchestrator Integration Contract

Status: active
Authority: canonical-contract
Owner: Kairos operator + orchestrator
Scope: minimal first live Parley integration inside Kairos
Date: 2026-04-22
Participants: `kairos-operator`, `kairos-orchestrator`
Depends on:
- `docs/mvp-thread-protocol-spec.md`
- `plans/mvp-implementation-plan.md`
- `docs/interim-agent-side-transport-spec.md`
- `docs/interim-agent-side-transport-tool-contracts.md`

## 1. Purpose

Define the smallest acceptable Parley usage contract for the first real Kairos integration.

This contract is intentionally narrow.
It is for live usage between operator and orchestrator only.
It is not yet the rollout contract for specialists or for broad Kairos-wide messaging.

## 2. Readiness statement

Parley is ready for this narrow integration phase because the following are now verified:

- canonical thread and message persistence are live
- the MVP action surface is live
- mixed transport behavior is live: opening/anchor-sensitive paths may still return caller-managed handoff, while reply/settle/conclude now auto-dispatch by default
- `parley_dispatch_transport_request` remains live as a fallback/debug helper
- recipient-side return routing back to the initiator session is live
- one full visible round trip back into the origin Discord session was verified on 2026-04-22

This means the next work is usage validation, not core transport rescue.

## 3. Integration scope

### 3.1 In scope

The first live integration may be used for:

- bounded operator/orchestrator coordination
- bounded operator/orchestrator status exchanges
- requests that benefit from explicit turn ownership
- requests where follow-up silence or handoff ambiguity would otherwise create confusion

### 3.2 Out of scope for the first rollout

Do not use Parley yet for:

- specialist-facing threads
- end-user-facing thread semantics
- broad task routing across multiple agents
- incident handling with more than two active participants
- heavy decision workflows unless a specific test case is intentionally chosen
- replacing all ordinary operator/orchestrator messaging by default

## 4. Allowed initial thread kinds

For the first rollout, prefer only:

- `coordination`
- `status`

Hold these for later unless a deliberate test is being run:

- `decision`
- `incident`

## 5. Allowed initial control modes

Default to:

- `peer`

Do not use `directed` by default in the first rollout.
Use `directed` only if a specific thread clearly benefits from asymmetric control and the initiator intends to preserve that structure deliberately.

## 6. When to use Parley vs ordinary messaging

### 6.1 Use Parley when at least one of these is true

- the exchange needs explicit `next_action_owner`
- the exchange may span multiple back-and-forth messages
- a later probe may be needed if silence occurs
- the exchange would benefit from canonical thread persistence outside normal chat transcript flow
- the sender wants explicit turn settlement rather than conversational drift

### 6.2 Do not use Parley when all of these are true

- the message is one-shot and informal
- no explicit turn ownership is needed
- no structured follow-up or probing is expected
- ordinary `sessions_send` is sufficient

## 7. Initial opening rules

### 7.1 Who may open

Either operator or orchestrator may open a Parley thread during this phase.

### 7.2 Required defaults

Unless there is a clear reason otherwise:

- `kind = coordination` or `status`
- `controlMode = peer`
- `originKind = human` when the thread exists because of an explicit user request; otherwise set it explicitly to the actual source
- let Parley derive the internal `report_back_policy = summary_to_human` for normal human-origin threads
- use `suppressHumanSummary = true` only for the rare human-origin thread that should not produce a final human summary
- for human-origin summary threads, create or record a short anchor/sendoff message up front and preserve its message ref as the human-summary anchor
- `transport = openclaw_runtime_subagent` only as canonical label if already in use locally, while actual delivery continues through the verified interim helper path
- include both participant session keys in canonical transport correlation when available

### 7.3 Operator/orchestrator Discord landing lock

During the current operator/orchestrator rollout, Parley coordination must land in explicit Discord-backed sessions.
Do not infer a coordination landing from heartbeat, `main`, `last`, or other activity-derived sessions.

Current default targets:

- operator opening to orchestrator: `targetSessionKey = agent:kairos-orchestrator:discord:channel:1492408840862433480`
- orchestrator opening to operator, when the operator Discord origin is known: `targetSessionKey = agent:kairos-operator:discord:channel:1494492383726010418`
- replies should preserve the initiating participant session key through canonical transport correlation rather than resolving through heartbeat/main session state

Do not target these for normal operator/orchestrator Parley coordination:

- `agent:kairos-orchestrator:main`
- `agent:kairos-operator:main`
- any `:heartbeat` session
- any session chosen only because it was most recently active

If the explicit Discord-backed target is unavailable, stop and report the routing blocker rather than silently falling back to `main` or heartbeat state.

### 7.4 Opening-body style

Opening bodies should be:

- short
- concrete
- scoped to one bounded exchange
- explicit about the immediate requested next action

Do not use Parley openings as long freeform memos.

## 8. Initial turn behavior

### 8.1 Preferred pattern

Preferred live pattern for the first rollout:

1. `parley_open_thread`
2. recipient either responds substantively or uses `parley_claim_turn` if they need to acknowledge and continue later
3. recipient uses `parley_settle_turn` when handing the turn back or completing their part
4. sender continues or concludes based on the resulting `next_action_owner`

In the current branch, `parley_reply_thread`, `parley_settle_turn`, and `parley_conclude_thread` dispatch automatically after persisting canonical state. `parley_claim_turn` stays local-only by default so a bodyless control marker does not emit an empty visible hop.

### 8.2 Claim-turn guidance

Use `parley_claim_turn` only when it helps.
Do not force a claim step if the recipient can answer and settle cleanly in one pass.

### 8.3 Settling guidance

For the first rollout, prefer explicit settling quickly once the meaningful response is ready.
Avoid leaving threads active without a clear reason.

### 8.4 Human-summary guidance

If a pilot thread has `report_back_policy = summary_to_human`, the initiator should send a concise user-visible summary after the thread settles back.
For human-origin threads, that summary should reply to the recorded anchor/sendoff message rather than appearing as an unrelated free-floating completion note.
Do not treat the agent-to-agent settlement itself as the final human-facing closure.

Likely next iteration: standardize the anchor/sendoff text itself as Parley-generated caller-managed output rather than caller-authored prose. Draft contract reference:
- `docs/human-summary-anchor-contract.md`

## 9. Probe policy

Probe sparingly in the first rollout.

Recommended initial posture:

- do not probe immediately on minor delay
- probe only when the thread was actually relying on a timely next action
- treat probing as a real follow-up signal, not as background noise

This phase should validate whether probing is genuinely useful in operator/orchestrator work before it becomes routine.

## 10. Transport path policy

For the first rollout, the default delivery path should be:

1. call the Parley action
2. if the action already returned `transport_required = false` with an accepted or failed dispatch state, do not perform a second send
3. if `transport_required = true`, call `parley_dispatch_transport_request` with the returned canonical thread/message ids rather than replaying a copied transport payload
4. rely on explicit `parley_record_transport_result` only as fallback when helper use is unavailable or debugging is required

Do not prefer manual `sessions_send` unless the helper path is unavailable or under investigation.

### 10.1 Future landing mode: target-agent subagent

This is a design note only; it is not active routing policy for the current rollout.

The preferred future coordination landing is one ephemeral subagent session owned by the target participant per Parley thread.
That would separate substantive coordination from both heartbeat/main maintenance state and human-facing Discord working context.

Candidate lifecycle contract:

- the Parley opener creates the target-agent subagent when opening a thread with a future `routing = target_subagent` policy
- canonical Parley thread state stores the subagent `sessionKey` in transport correlation
- all thread transport for the target participant lands in that subagent for the lifetime of the thread
- the subagent lifetime is derived from thread state: conclude on normal completion, expire on bounded TTL, or escalate on stalled ownership
- cleanup/archive happens only after final settlement and any required human-facing summary/anchor delivery are recorded
- final human-facing summaries return to the initiating Discord/origin anchor, not to the subagent transcript

Open design questions before activation:

- exact creation trigger and idempotency key for subagent spawn
- whether the subagent is `cleanup=delete` or retained/archived for audit
- who owns timeout/TTL cleanup if the thread stalls
- how tool profile, model, and context are inherited from the target agent
- how failures fall back without reintroducing heartbeat/main landing ambiguity

## 11. Logging and continuity policy

During this rollout, preserve continuity in:

- canonical Parley runtime state under `.kairos-runtime/parley/`
- `.agent-state/parley-iteration-status.md` when a meaningful implementation milestone changes
- focused memory notes only when a durable lesson is learned

Do not create prompt-side doctrine that duplicates Parley protocol semantics.

## 12. Success criteria for the first rollout

This rollout is successful if operator and orchestrator can use Parley for a small number of real exchanges and confirm:

- the thread helps rather than slows them down
- turn ownership is clearer than ordinary messaging
- settlement markers feel natural enough in practice
- the helper dispatch path remains reliable
- no major transcript confusion or routing regression appears
- human-initiated threads with `report_back_policy = summary_to_human` do not silently lose the user-facing summary step

## 13. Exit criteria before wider rollout

Before using Parley more broadly in Kairos, verify at least:

- several real operator/orchestrator threads completed cleanly
- no new return-path or helper-dispatch regressions appeared
- the default usage pattern feels stable enough to teach briefly
- operator and orchestrator agree on when Parley is worth invoking vs ordinary messaging

## 14. Immediate next step

Begin with a small real operator/orchestrator pilot using only `coordination` and `status` threads in `peer` mode.

Recommended scale:

- 2 to 5 real threads
- low-risk coordination work
- explicit review afterward of what felt better, worse, or unnecessary
