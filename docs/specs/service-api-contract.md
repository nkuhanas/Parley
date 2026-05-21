# Service API Contract

Status: draft Phase 1 contract  
Related plan: `plans/parley-service/service-boundary-plan.md`

## Purpose

This document maps the current Parley OpenClaw tool surface into application service commands and queries. It is a contract draft for the service boundary, not an implementation migration.

## Request Envelope

Every application service call receives normalized caller context plus command/query input.

```ts
type ServiceRequest<TInput = Record<string, unknown>> = {
  caller: CallerContext;
  input: TInput;
};

type CallerContext = {
  actor_id: string;
  actor_type: "agent" | "human" | "service";
  runtime?: "openclaw" | "cli" | "dashboard" | "telemetry" | "bootstrap" | string;
  board_id?: string;
  request_id?: string;
  capabilities?: string[];
};
```

`request_id` is trace metadata in Phase 1. It is not a general idempotency key.

## Board Target Rules

- Board-scoped mutations require explicit `input.board_id` unless a command contract explicitly says otherwise.
- Board-scoped queries should accept explicit `input.board_id`; read-only defaulting from `caller.board_id` may be allowed by specific query contracts.
- If both `input.board_id` and `caller.board_id` are present, `input.board_id` wins.
- Runtime protocol queries/commands are not board-affined unless a command documents `board_id` as a filter.

## Commands

Command names below are service-level names. Existing OpenClaw tools should become facades that map tool input into these commands.

### Runtime protocol commands

The HTTP/service command boundary exposes runtime protocol operations through command `runtime` with input shape:

```json
{
  "action": "open_thread",
  "input": { "...": "tool-specific params" }
}
```

Service-hosted runtime commands persist canonical thread/message state and return caller-managed `transport_request` handoffs. Service clients that actually dispatch through a host runtime must call `record_transport_result` after delivery. The service process must not assume it can call a client runtime such as OpenClaw `sessions.send` locally.

| Runtime action | Current tool | Notes |
| --- | --- | --- |
| `open_thread` | `parley_open_thread` | Create runtime thread/message records and pending dispatch metadata. |
| `reply_thread` | `parley_reply_thread` | Append a substantive runtime protocol message. |
| `claim_turn` | `parley_claim_turn` | Record a control claim without settling the turn. |
| `probe_thread` | `parley_probe_thread` | Record first stalled-thread probe. |
| `settle_turn` | `parley_settle_turn` | Set current turn control marker and next action owner. |
| `conclude_thread` | `parley_conclude_thread` | Conclude a live thread by initiator. |
| `dispatch_transport_request` | `parley_dispatch_transport_request` | Return a caller-managed transport request for fallback/debug dispatch. |
| `record_transport_result` | `parley_record_transport_result` | Persist accepted/failed dispatch outcome. |
| `record_human_summary_anchor` | `parley_record_human_summary_anchor` | Persist delivered human-summary anchor. |

### Board artifact/object/effect commands

| Service command | Current tool | Notes |
| --- | --- | --- |
| `registerArtifact` | `parley_register_artifact` | Registers artifact references and may import plan artifacts. |
| `createObject` | `parley_create_object` | Creates board-scoped coordination object. |
| `recordEffect` | `parley_record_effect` | Appends immutable board effect. |
| `recordRelationship` | `parley_record_relationship` | Adds relationship plus effect. |
| `removeRelationship` | `parley_remove_relationship` | Logical relationship removal through effect. |

### Board obligation and trigger commands

| Service command | Current tool | Notes |
| --- | --- | --- |
| `createObligation` | `parley_create_obligation` | Creates active board-scoped obligation. |
| `resolveObligation` | `parley_resolve_obligation` | Resolves obligation and evaluates obligation-bound triggers. |
| `createTrigger` | `parley_create_trigger` | Creates trigger record. |

### Plan setup and lifecycle commands

| Service command | Current tool | Notes |
| --- | --- | --- |
| `createPlan` | `parley_create_plan` | Creates tracked plan setup shell only. |
| `writePlanOverview` | `parley_write_plan_overview` | Writes/replaces overview band. |
| `addPlanPhase` | `parley_add_plan_phase` | Adds one explicit phase. |
| `addPlanCheckpoint` | `parley_add_plan_checkpoint` | Adds human checkpoint/gate phase. |
| `requestPlanReview` | `parley_request_plan_review` | Moves setup-complete plan into review and creates reviewer obligations. |
| `recordReviewDecision` | `parley_record_review_decision` | Reviewer decision for active review obligation. |
| `markPlanReady` | `parley_mark_plan_ready` | Owner marks setup-complete plan ready without review. |
| `activatePlan` | `parley_activate_plan` | Owner activates ready plan and creates lifecycle obligations. |
| `pausePlan` | `parley_pause_plan` | Owner pauses active plan. |
| `resumePlan` | `parley_resume_plan` | Owner resumes paused/blocked plan. |
| `recordHitlInput` | `parley_record_hitl_input` | Owner/shepherd records explicit human input for current HITL phase. |
| `recordPhaseOutcome` | `parley_record_phase_outcome` | Owner records current phase outcome and advances cursor; completion is accepted with criteria/evidence review and required human-notification guidance; HITL completion requires prior approving HITL input. |
| `recordPlanDisposition` | `parley_record_plan_disposition` | Owner terminally dispositions or archives plan. |

Plan setup remains guided and explicit. The service should not accept arbitrary complete plan replacement as the normal setup path. Human checkpoint/approval phases are gated: completion must be preceded by an explicit `recordHitlInput` event tied to the current phase and source evidence.

## Queries

### Discovery and recovery queries

| Service query | Current tool | Notes |
| --- | --- | --- |
| `describe` | `parley_describe` | Tool/workflow metadata and board metadata. |
| `myBoards` | `parley_my_boards` | Boardless discovery and identity resolution. |
| `whereAmI` | `parley_where_am_i` | Runtime recovery, board-local recovery when `board_id` is explicit. |

### Board/projection queries

Phase 2 should implement current-tool-aligned service query names first. Dashboard-friendly names such as `getBoardOverview` or combined `listObligations` can be added later as aliases or thin wrappers when tests or consumers require them.

| Service query | Current tool | Notes |
| --- | --- | --- |
| `getBoardProjection` | `parley_board_projection` | Compact board-scoped projection; raw records and detailed derived state are opt-in. Implement now. |
| `checkpointProjection` | `parley_checkpoint_projection` | Inspect/advance projection checkpoint. Implement now. |
| `listRuntimeObligations` | `parley_query_runtime_obligations` | Runtime obligations; no board id. Implement now. |
| `listBoardObligations` | `parley_query_board_obligations` | Board-local obligations with target-kind filters. Implement now. |
| `searchReferences` | `parley_query_search` | Board namespace search. |
| `validatePlan` | `parley_validate_plan` | Validate plan Markdown/path and optional setup state. |
| `validateState` | `parley_validate_state` | Validate board records/references/derived state. |
| `getPlanSetupStatus` | `parley_get_plan_setup_status` | Plan setup completeness and setup guidance. |
| `getPlanStatus` | `parley_get_plan_status` / `parley_query(action="plan_status")` | Compact lifecycle position, current phase, HITL readiness, and next lifecycle action. |
| `getPlanOverview` | `parley_get_plan_overview` / `parley_query(action="plan_overview")` | Overview band and compact plan metadata for a tracked plan. |
| `getPlanPhases` | `parley_get_plan_phases` / `parley_query(action="plan_phases")` | Full phase definitions and phase counts for a tracked plan. |
| `getPlanReviewStatus` | `parley_get_plan_review_status` / `parley_query(action="plan_review_status")` | Required reviewers, pending/invalid reviewers, approvals, objections, and lifecycle review obligations. |
| `getPlanRelationships` | `parley_get_plan_relationships` / `parley_query(action="plan_relationships")` | Declared and board-recorded relationships touching a tracked plan. |
| `readPlanProjection` | `parley_read_plan_projection` / `parley_query(action="read_plan_projection")` | Service-rendered tracked plan Markdown projection for recovery/cache misses. |

### Artifact read queries

These are explicit service queries even if current clients can read local paths directly:

| Service query | Initial input | Notes |
| --- | --- | --- |
| `readArtifact` | `{ board_id, artifact_id, include_body? }` | Reads artifact handle/body by id. |
| `readArtifactByRef` | `{ board_id, artifact_ref, include_body? }` | Reads artifact handle/body by ref/URI. |
| `readPlanArtifact` | `{ board_id, plan_id, include_body? }` | Reads primary artifact for a plan. |

`include_body` defaults to `false` where the body may be large.

## Compatibility Facades

`parley_query`, `parley_mutate`, and the OpenClaw runtime/thread tools are compatibility facades over first-class service queries/commands. They may remain for advanced callers, but the application service should expose first-class command/query functions internally.

Facade action mapping should be mechanical:

- validate action name
- normalize caller context
- validate `input`
- call the corresponding service command/query
- return compact response envelope with facade diagnostics

Unsupported actions must fail closed with `UNSUPPORTED_ACTION`.

## Response Contract

Commands return compact mutation envelopes. Queries return bounded query envelopes. See `docs/specs/response-envelopes.md`.

Key rules:

- mutation responses include `code` and `message` when blocked or errored
- plan mutations normally stay compact, but plan-projection mutations may include a bounded service/client transport `projection` payload (`uri`, `mediaType`, `contentDigest`, optional `body`, and diagnostic `serviceLocalPath`) so adapters can materialize local non-authoritative mirrors without a second round trip; tool-facing output must omit the projection body after any materialization
- `parley_query(action="board")` must return only compact board metadata and scalar counts; it must omit raw `records` and detailed derived state even when record excerpts were requested; use `parley_board_projection({ includeRecords: true })` for explicit bounded record inspection and `parley_board_projection({ includeDerivedDetails: true })` for detailed derived graph/approval/checkpoint/count state
- artifact body access for arbitrary artifacts still requires explicit artifact-read query or `include_body: true`
- top-level artifact fields are primary artifact fields
- multi-artifact responses may add a plural `artifacts` array later when a concrete command needs it

## Initial Migration Slices

1. Keep current behavior unchanged and add service-contract tests/fixtures around commands and query response shapes.
2. Add an embedded application service shell plus response/context utilities.
3. Implement current-tool-aligned read/query service functions first: `describe`, `myBoards`, `whereAmI`, `getBoardProjection`, `listRuntimeObligations`, `listBoardObligations`, and `getPlanSetupStatus`.
4. Add explicit artifact/plan reads plus compact/scoped plan reads: `readArtifact`, `readArtifactByRef`, `readPlanArtifact`, `getPlanStatus`, `getPlanOverview`, `getPlanPhases`, `getPlanReviewStatus`, and `getPlanRelationships`.
5. Migrate plan mutations, then general board mutations, then runtime protocol commands, with HITL phase completion gated by explicit recorded input and ordinary phase completion returning advisory criteria/evidence review plus required human-notification guidance.
6. Move first-class OpenClaw tools onto service commands/queries while preserving tool names.
7. Keep `parley_query`/`parley_mutate` as advanced facades over the same service calls.
8. Defer transport, dashboard, auth, and database decisions until after the embedded service contract is stable.

## Acceptance Criteria for Phase 1

- Current OpenClaw tool actions are mapped to service commands/queries.
- `CallerContext` and board target precedence are defined.
- Compact mutation/query response contracts are defined.
- Explicit artifact-read behavior exists in the contract.
- Dashboard-oriented read models are represented as service queries/projections.
- Transport remains deferred.
