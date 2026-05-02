# Parley MVP Implementation Plan

Status: implemented
Authority: implementation-note
Owner: Kairos operator + orchestrator
Scope: first Parley plugin/runtime implementation plan and build boundary
Concrete plugin identity: Parley
Depends on: `docs/mvp-thread-protocol-spec.md`

## Purpose

Turn the MVP thread protocol spec into a buildable implementation plan.

This plan is intentionally bounded.
It aims to produce a usable first Parley runtime on top of native OpenClaw transport without widening into routing policy, multiparty orchestration, or platform-internal thread replacement.
The public contract should remain reusable beyond Kairos even though the first implementation lands in the Kairos repo and plugin package.

## Build now

### Functional target

Build the first usable Parley plugin/runtime surface that:

- owns canonical thread state
- exposes the MVP action surface
- persists structured thread and message records outside docs
- uses native OpenClaw session messaging as transport only
- keeps protocol declarations out of normal agent prose
- supports two-party operational threads in `peer` and `directed` modes

### MVP action surface

Implement these public actions first:

- `open_thread`
- `claim_turn`
- `reply`
- `probe`
- `settle_turn`
- `conclude_thread`

### Runtime target

The runtime must persist enough state to survive:

- compaction
- message formatting changes
- transport retries/failures
- delayed follow-up probing

## Do not build yet

- routing policy or recipient selection logic
- multiparty operational semantics
- full authority hierarchy or role lattice
- native OpenClaw thread interception as canonical lifecycle control
- generalized workflow/task planner semantics on top of the thread layer
- broad protocol extensions not justified by the MVP spec

## Boundary

### Canonical boundary

The plugin/tool runtime is the canonical owner of:

- thread identity
- message correlation
- turn control
- settling semantics
- thread state persistence

Native OpenClaw messaging owns:

- delivery transport
- session-to-session message execution
- existing platform thread/session behavior as substrate only

### Naming boundary

Implementation must preserve the public naming rules from the protocol spec:

- `thread` is the canonical public noun
- public identifiers use `snake_case`
- lifecycle state uses `thread_state`
- `status` remains a thread `kind`, not a lifecycle field
- action names remain imperative verb forms

## Proposed implementation shape

### Plugin location

Use the existing plugin package:

- `apps/kairos-openclaw-tools/`

Do not create a second plugin package for MVP.
Extend the current plugin package with the new Parley surface.

### Extraction-readiness rule

Even while Parley lives inside the Kairos host plugin package, implementation should stay extraction-ready.
That means:

- keep Parley logic under a clearly bounded `src/` subtree
- avoid unnecessary references to Kairos-specific runtime concepts inside Parley modules
- keep host-package wiring thin and concentrated near the top-level plugin entrypoint
- prefer default/config/path assumptions that can be replaced later without changing Parley action semantics or record shapes

### Internal module split

The current plugin is a thin single-file wrapper.
For the Parley MVP, split the implementation into bounded modules inside the same plugin package.

Suggested internal layout:

- `apps/kairos-openclaw-tools/index.js`
  - plugin entrypoint only
  - registers existing Kairos tools plus the new Parley tools
- `src/config.js`
  - runtime path resolution
  - config defaults
  - validation of plugin config relevant to agent comms
- `src/store.js`
  - canonical thread/message record persistence
  - record lookup and atomic-ish write helpers
- `src/schema.js`
  - runtime validators for kinds, control modes, settling markers, and state transitions
- `src/transport.js`
  - native transport adapter over `sessions_send` or equivalent OpenClaw plugin context facilities
  - transport formatting generation for parseable blocks when needed
- `src/actions/open_thread.js`
- `src/actions/claim_turn.js`
- `src/actions/reply.js`
- `src/actions/probe.js`
- `src/actions/settle_turn.js`
- `src/actions/conclude_thread.js`
- `src/render.js`
  - parseable transport block rendering
  - human-readable response shaping that keeps protocol declaration out of prose
- `src/ids.js`
  - canonical `thread_id` and `message_id` generation
- `src/time.js`
  - timestamp helpers and probe deadlines

Exact filenames may vary, but the implementation should preserve these separations of concern.

## Runtime state placement

### Preferred runtime root

Use a gitignored runtime area, not `docs/`.

Preferred path:

- `/home/agent/workspace/Kairos/.kairos-runtime/parley/`

### Runtime files

Initial MVP runtime layout should be simple and inspectable:

- `.kairos-runtime/parley/threads/<thread_id>.json`
- `.kairos-runtime/parley/messages/<thread_id>/<message_id>.json`
- `.kairos-runtime/parley/index/thread_by_transport.json` or equivalent lookup index
- `.kairos-runtime/parley/index/open_threads_by_agent.json` only if needed for efficient lookup

Prefer plain JSON files first.
Do not introduce SQLite or a more complex embedded store unless file-based state proves insufficient.

### Gitignore

Ensure `.kairos-runtime/` remains gitignored.
If the repo does not already ignore it, add the minimal ignore entry during implementation.

## Canonical record shapes

### Thread record

The first implementation should persist a canonical thread record with at least:

- `thread_id`
- `kind`
- `control_mode`
- `initiator`
- `recipient`
- `origin_kind`
- `report_back_policy`
- `next_action_owner`
- `last_speaker`
- `meaningful_turn_pending`
- `thread_state`
- `created_at`
- `updated_at`
- `opened_by_action`
- `transport`
- `transport_correlation`

Recommended additional MVP fields:

- `human_summary_anchor`
- `probe_count`
- `last_claimed_at`
- `last_probe_at`
- `concluded_at`
- `failure_reason`

### Message record

Persist each committed protocol message with at least:

- `message_id`
- `thread_id`
- `sender`
- `message_class` (`control`, `substantive`, or `settling`)
- `control_marker` when present
- `body_text`
- `next_action_owner` when relevant
- `created_at`
- `transport_message_ref`

### Transport correlation

The runtime must preserve enough correlation data to map between:

- canonical `thread_id`
- canonical `message_id`
- transport session target
- transport reply or thread identifiers when available

This mapping is necessary for compaction recovery and for later hook-based enhancements.

## Public tool contracts

### Contract posture

Public tools are the contract.
Internal storage shape may evolve as long as the contract stays consistent with the MVP spec.

### Suggested first-class tool ids

Prefer an explicit generic prefix, for example:

- `parley_open_thread`
- `parley_claim_turn`
- `parley_reply_thread`
- `parley_probe_thread`
- `parley_settle_turn`
- `parley_conclude_thread`

This keeps the public naming reusable beyond the first implementation host.

If a different public prefix is later preferred, it should still preserve:

- `snake_case`
- imperative action naming
- explicit `thread` terminology

### Parameter design guidance

- Prefer required explicit fields over inferred state when the action changes ownership or lifecycle.
- Do not infer settling markers from prose.
- Require `kind` and `control_mode` on thread creation.
- Require explicit `origin_kind` and `report_back_policy` on thread creation, or apply clear defaults rather than leaving them implicit.
- For human-origin `summary_to_human` threads, require an anchored sendoff path so the final report can reply to a canonical human-visible message.
- Require explicit `next_action_owner` on `settle_turn` except when concluding.
- Require explicit target identifiers for transport-facing actions.
- Keep request objects narrow and semantic.

## Transport strategy

### Initial strategy

Start with an explicit transport adapter layer inside the plugin.
Do not scatter raw native messaging calls across action handlers.

The transport layer should own:

- outbound formatting
- parseable block generation
- transport metadata capture
- reply-target handling
- retries or failure wrapping if minimal retry logic is added

### Parseable block policy

If transport requires a parseable block, generate it in one place.
Do not let action handlers or calling agents freehand protocol formatting.

### No native thread hijacking

The implementation should not attempt to replace OpenClaw’s internal thread lifecycle.
It should correlate with transport behavior, not depend on platform-internal thread semantics as canon.

## Validation and transition enforcement

### Transition checks

Implement deterministic validation for:

- allowed `kind` values
- allowed `control_mode` values
- allowed `origin_kind` values
- allowed `report_back_policy` values
- bounded-thread lifecycle state enum consistency: `active`, `awaiting_next_action`, `awaiting_decision`, `concluded`, `failed`
- initiator-only `thread_conclude`
- bounded-path `thread_conclude` only when the initiator currently owns the next action
- directed-thread `turn_pass` returning only to the initiator
- `claim_turn` only by the current `next_action_owner`
- explicit settling marker requirement
- explicit `next_action_owner` on non-concluding settling actions
- bounded transition clarity so open/settle/probe states read cleanly with `next_action_owner`
- two-party enforcement

### Failure posture

Fail closed on invalid transitions.
Do not silently coerce illegal state changes into valid ones.

Return structured errors that make clear whether the failure is:

- contract validation
- transport failure
- runtime persistence failure
- correlation failure

## Sequencing

### Phase 1. Runtime substrate

Build:

- runtime path resolution
- id generation
- JSON record persistence
- thread/message schema validation helpers
- basic test fixtures for record read/write

Output:

- inspectable local runtime store with canonical thread/message records

### Phase 2. Core action implementation

Build:

- `open_thread`
- `claim_turn`
- `reply`
- `settle_turn`
- `conclude_thread`

Defer `probe` until the other actions are stable enough to produce real stalled-thread scenarios.

Output:

- full happy-path thread lifecycle without probe automation yet

### Phase 3. Transport integration

Build:

- dedicated transport adapter
- parseable block rendering
- transport correlation capture
- basic failure wrapping around outbound sends

Output:

- canonical thread state linked to actual OpenClaw transport events

### Phase 3.5. Human-summary anchor standardization

Follow-up after the current anchored human-summary flow:

- generate standardized anchor/sendoff text from Parley at thread open
- return that sendoff text as caller-managed output rather than forcing the caller to author it ad hoc
- add a separate caller-recorded anchor step so canonical thread state can move from pending anchor to recorded anchor

Draft contract reference:
- `docs/human-summary-anchor-contract.md`

### Phase 4. Probe and stalled-thread handling

Build:

- `probe`
- probe timestamp tracking
- first-probe-before-failure enforcement
- terminal broken-thread marking after failed continuation

Output:

- recoverable stalled-thread handling matching the protocol spec

### Phase 5. Review and tighten

Build:

- naming consistency pass in code and runtime records
- docs/examples update
- boundary review against the protocol spec
- targeted cleanup of any action or field names that drifted during implementation

Output:

- implementation aligned with the naming and semantic discipline in the spec

## Testing plan

### Must validate

- open thread in each MVP `kind`
- open thread in each control mode
- open thread starts in `awaiting_next_action` for the bounded default path
- valid `claim_turn` moves the thread to `active`
- invalid `claim_turn` by non-owner
- substantive `reply` keeps the thread `active`
- valid `turn_pass` in `peer`
- `turn_complete` and `turn_pass` move the thread to `awaiting_next_action`
- `decision_escalate` moves the thread to `awaiting_decision`
- directed `turn_pass` back to initiator
- invalid directed `turn_pass` to non-initiator
- initiator-only `thread_conclude`
- explicit settling marker enforcement
- state survives reload/rehydration from runtime files using only the canonical lifecycle names
- probe occurs before terminal failure path

### Good first test shape

Prefer deterministic Node-level tests around pure validation/state modules first.
Then add thin integration tests around transport formatting and correlation.

Do not start with end-to-end multi-agent live tests as the only validation method.

## Operational rollout

### Initial exposure

Expose the MVP surface to:

- `kairos-operator`
- `kairos-orchestrator`

Do not broaden visibility until the action surface and runtime state behavior are proven.

### Usage posture

Treat the first rollout as real but experimental.
Expect iteration on:

- runtime record details
- transport formatting details
- whether any additional helper action is justified by real use

Do not change the core public naming or thread model casually once rollout begins.

## Follow-up after implementation

After the first usable implementation exists, the next decision layer should be:

1. whether the runtime should stay file-backed or move to a more transactional store
2. whether a slightly more brokered transport/runtime layer is needed
3. whether real use justifies any additional action surface beyond the MVP six actions
4. whether any thread-state enum tightening is needed based on observed failure modes

## Judgment boundary

Agents remain responsible for:

- deciding who to message
- determining whether a thread should be opened
- choosing substantive content
- making routing and workflow judgments above the thread layer

The Parley runtime should own:

- deterministic protocol enforcement
- canonical state transitions
- transport formatting
- correlation and persistence
- probe and turn-settlement discipline
