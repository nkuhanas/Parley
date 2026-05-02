# Parley MVP Thread Protocol Spec

Status: active
Authority: canonical-contract
Owner: Kairos operator + orchestrator
Scope: MVP protocol and tool/runtime contract for agent-to-agent messaging threads
Concrete plugin identity: Parley

## 1. Purpose

Define the first formal MVP contract for Parley, a reusable agent-to-agent communication thread runtime.

This protocol is messaging-centric.
It is not limited to task assignment.
The core primitive is a protocol-managed thread that can carry coordination, decisions, incidents, and status interactions.

## 2. Architecture Decision

### 2.1 Canonical model

The canonical thread model is owned by the Parley plugin/runtime.

OpenClaw native session messaging remains the transport and execution substrate only.
It is not the canonical protocol thread state machine.

### 2.2 Consequences

- `sessions_send` and related native session messaging surfaces are transport internals, not the public protocol contract.
- The plugin/tool owns canonical thread state, message correlation, turn control, probing, and settling semantics.
- Protocol control data lives in structured tool/runtime data, not in normal prose.
- Agents should not hand-author protocol declarations inside prose bodies.
- The plugin/tool may render or transport a parseable block containing protocol declaration plus prose when needed, but that formatting is tool-managed rather than authored as normal message text.
- Routing policy is out of scope for the plugin/tool. The plugin handles literal message threads and protocol state, not who should be selected as a recipient.

## 3. MVP Scope

### 3.1 In scope

- First-class plugin/tool-managed messaging threads
- Two-party operational model
- Structured thread state and message state
- Explicit turn claiming, probing, settling, escalation, and conclusion
- Support for agent-created threads that do not necessarily return results to the user
- Explicit thread-level report-back obligations when a thread is expected to produce a human-facing summary

### 3.2 Out of scope

- Plugin-owned routing policy
- Prompt-side or workspace-file protocol doctrine as the primary control surface
- Full global authority hierarchy or agent rank lattice
- Native OpenClaw thread hijacking or replacement at the platform-internal lifecycle level
- Multiparty operational behavior in MVP

## 4. Terminology

### 4.1 Thread

A protocol-managed exchange between agents.
A thread is the canonical unit of communication state.

### 4.2 Message

A committed communication event within a thread.
Messages may carry substantive prose and structured control metadata.

### 4.3 Turn

The currently active obligation to produce the next meaningful contribution in a thread.
Turn control is explicit and protocol-managed.

### 4.4 Settling message

A message that explicitly settles the current turn.
Settling messages must declare a settling marker.

### 4.5 Naming conventions

Public protocol identifiers should use lowercase `snake_case`.

Naming rules for the MVP:

- `thread` is the canonical public noun. `exchange` may be used informally in discussion, but should not be used as a schema field, action name, or control marker token in the MVP contract.
- Public state fields should be noun-oriented, for example `thread_id`, `control_mode`, and `next_action_owner`.
- Public actions should use imperative verb names, using compound verb-object forms when the object needs to be explicit, for example `open_thread`, `claim_turn`, `settle_turn`, and `conclude_thread`.
- Lifecycle state and thread intent must not reuse the same identifier. For that reason, the lifecycle field is named `thread_state`, while `status` remains an allowed thread `kind` value.

## 5. MVP Thread Model

### 5.1 Thread kinds

MVP uses a closed set of kinds:

- `coordination`
- `decision`
- `incident`
- `status`

Every thread must declare exactly one `kind`.

### 5.2 Participants

MVP is operationally two-party only:

- `initiator`
- `recipient`

Schema and storage should remain future-friendly for multiparty evolution, but the MVP runtime should enforce two active participants only.

### 5.3 Control modes

MVP uses a closed set of thread-local control modes:

- `peer`
- `directed`

These are thread-local interaction modes, not a global hierarchy system.

#### `peer`

- Both participants may meaningfully steer the exchange.
- Either participant may become `next_action_owner` through valid protocol transitions.
- Either participant may settle a turn.
- Only the initiator may conclude the thread.

#### `directed`

- The initiator starts the thread with asymmetric control over the exchange direction.
- The recipient may claim a turn, answer, report, pass the turn back, or escalate for decision.
- The recipient must not create fresh obligations upward or sideways arbitrarily.
- `turn_pass` in a directed thread returns control to the initiator only.
- If the recipient believes another participant is better suited, that should be expressed as guidance to the initiator rather than recipient-controlled reassignment.
- Only the initiator may conclude the thread.

## 6. Canonical State Model

### 6.1 Required thread fields

Each thread must minimally track:

- `thread_id`
- `kind`
- `control_mode`
- `initiator`
- `recipient`
- `origin_kind`
- `report_back_policy`
- `next_action_owner`
- `last_speaker` (informational only)
- `meaningful_turn_pending`
- `thread_state`
- `created_at`
- `updated_at`

When `origin_kind = human` and `report_back_policy = summary_to_human`, the thread should also track a canonical `human_summary_anchor` record for the user-visible sendoff message that the final completion update should reply to.

### 6.2 Ownership model

A single overloaded `owner` field is rejected.
The canonical split is:

- `initiator`: thread opener and only actor allowed to emit `thread_conclude`
- protocol custodian: the plugin/tool runtime
- `next_action_owner`: the actor currently expected to take the next meaningful action
- `last_speaker`: informational only, never authoritative by itself

### 6.3 Origin and report-back model

Some threads exist purely for agent-to-agent coordination.
Some threads are part of work that still owes a human-facing update.

To keep those cases explicit, the canonical thread model must distinguish:

- `origin_kind`: where the thread obligation came from
- `report_back_policy`: whether the initiator still owes a human-facing summary when the thread settles back
- `human_summary_anchor`: the canonical reference for the user-visible anchor/sendoff message when anchored human follow-up is required

Recommended MVP enums:

- `origin_kind`: `human`, `agent`, `system`
- `report_back_policy`: `none`, `summary_to_human`

`origin_kind` is descriptive.
`report_back_policy` is normative.

A thread may be human-originated without requiring a user summary, and a thread may require a user summary even if the thread was opened by an agent on its own initiative.
The protocol should therefore key obligations off `report_back_policy`, not off `origin_kind` alone.

Caller-facing note for the current bounded rollout: `report_back_policy` remains canonical thread state, but `reportBackPolicy` is archived as an active caller field on `parley_open_thread`. Normal callers should set `originKind` and let Parley derive the internal policy, using `suppressHumanSummary = true` only for the rare human-origin suppression override.

For human-origin threads with `report_back_policy = summary_to_human`, anchored reply correlation should be part of the protocol rather than left to caller memory. The thread should preserve a `human_summary_anchor` object with at least the human-visible message reference and enough channel context to reply to that message when the final summary is ready.

### 6.4 Lifecycle state guidance

The `thread_state` field is lifecycle state, not thread kind.
The `status` kind remains reserved for status-oriented threads.

For the current bounded-thread MVP, prefer this explicit lifecycle enum:

- `active`
- `awaiting_next_action`
- `awaiting_decision`
- `concluded`
- `failed`

State meanings for the bounded MVP:

#### `active`

The current `next_action_owner` has already taken the turn into active handling.
This means the thread is in-flight under the current owner rather than waiting on a fresh handoff.
Typical examples:

- immediately after `claim_turn`
- after a substantive `reply` that does not settle the turn yet

#### `awaiting_next_action`

The thread is waiting for the declared `next_action_owner` to take the next meaningful bounded action.
This is the default post-open and post-settlement waiting state for non-decision cases.
It should read cleanly together with `next_action_owner` without implying which participant was the prior speaker.

#### `awaiting_decision`

A `decision_escalate` handoff occurred and the thread is explicitly waiting on the participant who now holds the decision turn.
In the two-party MVP this will normally be the initiator.

#### `concluded`

The thread is terminally complete.
`next_action_owner` must be cleared.

#### `failed`

The thread entered a terminal broken state, for example after transport/protocol failure or unrecoverable stalled-thread handling.
`next_action_owner` must be cleared.

Use these lifecycle names directly in canonical runtime records.
Do not preserve alternate legacy aliases in the long-term Parley contract.

## 7. Message and Control Model

### 7.1 Message classes

The protocol distinguishes between:

- control messages, which mutate turn/thread state
- substantive messages, which carry meaningful content
- settling messages, which explicitly settle the current turn

Intent/control should remain distinct from stream-of-consciousness prose.

### 7.2 Turn claim

The protocol primitive formerly discussed as `reply_proceed` is formally named:

- `claim_turn`

`claim_turn` means:

- the actor is taking the current turn
- the initial response requirement is satisfied at the protocol level
- follow-up timing begins
- the turn is not yet substantively complete

`claim_turn` is a control event, not a substantive answer.

### 7.3 No `reply_blocked`

The protocol does not define `reply_blocked` as a control primitive.

If an actor is blocked, that should be expressed in substantive content and then settled with an explicit settling action such as:

- `turn_pass`
- `decision_escalate`
- `turn_complete`

Blocked is a reason/state description, not a top-level reply-intent primitive.

### 7.4 Settling markers

A message that settles the current turn must explicitly declare one of:

- `turn_complete`
- `turn_pass`
- `decision_escalate`
- `thread_conclude`

When a turn is settled, the settling marker must always be explicit.
Do not rely on silent/default tool inference to settle turns.

### 7.5 Next action owner on settling

Every settling action except `thread_conclude` must explicitly declare the resulting `next_action_owner`.

For `thread_conclude`, ownership clears and the thread enters a terminal concluded state.

## 8. Turn Transition Rules

### 8.1 General rules

- Thread open sets the initial `next_action_owner` and should place the bounded thread in `awaiting_next_action` unless a narrower special case is explicitly defined later.
- `claim_turn` may only be emitted by the current `next_action_owner` unless the tool/runtime defines an explicit override flow later.
- `claim_turn` moves the thread into `active`.
- A substantive `reply` that does not settle the turn keeps the thread in `active`.
- `turn_complete` and `turn_pass` settle the current turn and move the thread into `awaiting_next_action` under the declared `next_action_owner`.
- `decision_escalate` settles the current turn and moves the thread into `awaiting_decision` under the declared `next_action_owner`.
- `thread_conclude` moves the thread into `concluded` and clears `next_action_owner`.
- `last_speaker` never overrides `next_action_owner`.
- If `report_back_policy = summary_to_human`, settling the thread back to the initiator does not by itself satisfy the human-facing obligation.

### 8.2 Silence handling

After silence following an acknowledged turn claim or other intent signal:

1. first follow-up is a `probe`
2. if continuation still fails, the runtime may mark a terminal failure or equivalent broken-thread state

The first follow-up after silence is status probing, not immediate failure.

### 8.3 Decision escalation

`decision_escalate` transfers ownership upward immediately.
Here, "upward" means toward the participant who holds decision authority in the current thread context, not toward a global hierarchy.
In the two-party MVP, this will normally resolve to the initiator.
The target of the escalation becomes the declared `next_action_owner`.

### 8.4 Thread conclusion

Only the initiator may emit `thread_conclude`.
This rule applies in both `peer` and `directed` control modes for MVP.
For the bounded normal path, the initiator should only conclude when they currently own the next action.

### 8.5 Human-summary obligation

If a thread has `report_back_policy = summary_to_human`, the initiator remains responsible for producing a concise human-facing summary after the relevant agent-to-agent exchange settles back or concludes.

For human-origin threads, that summary should not float free. The initiator should create or record a short human-visible anchor/sendoff message near thread open, preserve it in `human_summary_anchor`, and reply to that anchor with the final completion update after settlement.

Parley canon should not treat agent-to-agent settlement alone as equivalent to user-visible closure.
The report-back obligation is satisfied only when the initiator performs the separate human-facing update tied to the anchor when one exists, or when a later protocol/runtime extension explicitly records that completion.

## 9. MVP Plugin Action Surface

The preferred MVP action surface is:

- `open_thread`
- `claim_turn`
- `reply`
- `probe`
- `settle_turn`
- `conclude_thread`

These actions define the first public protocol control surface.
Additional actions may be added later based on real usage, but the MVP should start here.

### 9.1 `open_thread`

Creates a new canonical thread and sends the opening message over native transport.

Expected responsibilities:

- validate `kind`
- validate `control_mode`
- validate two-party constraints
- apply explicit bounded defaults when fields are omitted: `kind = coordination`, `control_mode = peer`, `origin_kind = agent`, `next_action_owner = recipient`
- derive internal `report_back_policy` from caller intent for the bounded rollout, defaulting human-origin threads to `summary_to_human` unless explicitly suppressed
- if anchored human follow-up applies, create or record `human_summary_anchor` in canonical thread state
- establish initial `next_action_owner`
- persist canonical thread state
- send transport message
- create correlation between canonical thread id, any human-summary anchor, and transport message/session context

### 9.2 `claim_turn`

Claims the current turn without pretending the substantive answer is already complete.

Expected responsibilities:

- validate caller is allowed to claim
- record claim timestamp
- update thread timing/probe expectations
- emit transport-visible control output as needed

### 9.3 `reply`

Sends substantive content within an existing thread without necessarily settling the turn.

Expected responsibilities:

- append committed message
- preserve structured control metadata
- keep prose separate from protocol declaration
- avoid implicit turn settlement

### 9.4 `probe`

Performs the first follow-up when a previously claimed or expected response appears stalled.

Expected responsibilities:

- record the probe event
- keep thread correlation intact
- avoid premature terminalization before the first probe

### 9.5 `settle_turn`

Emits one explicit settling marker and updates `next_action_owner`.

Expected responsibilities:

- require one settling marker
- require explicit next owner except for thread conclusion
- validate control-mode restrictions
- persist state transition before or atomically with transport emission where possible

### 9.6 `conclude_thread`

Terminally concludes a thread.

Expected responsibilities:

- verify caller is initiator
- verify the initiator currently owns the next action for the bounded normal path
- clear pending turn ownership
- persist terminal thread state
- emit final transport-visible close event if applicable

## 10. Transport and Rendering Requirements

### 10.1 Transport independence

The canonical protocol must be derivable from structured runtime data even if transport formatting changes.

### 10.2 Parseable transport block

If a parseable block is used for rendering or transport interoperability, the plugin/tool should generate it.
Agents should not manually compose protocol declarations inside natural-language prose.

### 10.3 Compaction resilience

The runtime must preserve enough structured thread state that compaction, timeout, or message formatting changes do not destroy canonical turn state.

## 11. Runtime State Placement

Human-readable docs belong under `docs/`.
Live runtime communication state should live separately in a gitignored runtime area rather than inside documentation.

Preferred direction:

- runtime-managed state under a dedicated runtime path such as `.kairos-runtime/parley/` or equivalent repo-local runtime store
- stable human protocol documentation under `docs/agent-comms/`

The exact runtime path may be finalized during implementation, but documentation and live state must remain separate.

## 12. Non-Goals and Rejections

The MVP explicitly rejects:

- a single overloaded `owner` field
- prompt-side protocol as the primary enforcement layer
- treating routing policy as plugin responsibility
- control primitives that blur intent and meaning, such as `reply_blocked`
- relying on native OpenClaw thread semantics as the canonical protocol state machine
- silent turn settlement by inference

## 13. Implementation Guidance

### 13.1 Implementation posture

Start with plugin-owned logical threads over native OpenClaw transport.
Do not try to hack platform-internal native thread semantics into becoming the canonical protocol model.

### 13.2 Expected iteration

The MVP action surface and some runtime details should be expected to evolve after real usage.
That iteration should happen without breaking the core thread model decisions in this spec.

## 14. Deferred for post-MVP

- true multiparty operational support
- richer authority/control modes beyond `peer` and `directed`
- routing-policy integration layers above the plugin
- more granular delivery and recovery actions if real use shows they are needed
- any protocol additions that can only be justified by implementation evidence rather than current architectural need
