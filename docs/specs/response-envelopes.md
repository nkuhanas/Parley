# Service Response Envelopes

Status: draft Phase 1 contract  
Related plan: `plans/parley-service/service-boundary-plan.md`

## Purpose

This document defines compact response envelopes for Parley application service commands and queries. The goal is to give agents and clients enough structured recovery/action context without returning large artifacts or private storage bodies by default.

## Common Result Envelope

All service responses should be serializable and transport-safe.

```ts
type ResponseStatus = "ok" | "blocked" | "needs_review" | "error";

type ServiceResponse<T = unknown> = {
  status: ResponseStatus;
  code?: string;
  message?: string;
  data?: T;
  summary?: string;
  next_actions?: NextAction[];
  warnings?: string[];
  diagnostics?: Diagnostics;
};

type NextAction = {
  label?: string;
  command?: string;
  query?: string;
  args?: Record<string, unknown>;
  reason?: string;
};

type Diagnostics = {
  request_id?: string;
  board_id?: string;
  actor_id?: string;
  tool?: string;
  action?: string;
  [key: string]: unknown;
};
```

Rules:

- `status` is required.
- `code` is machine-readable recovery context, especially for `blocked` and `error` responses.
- `message` is a short human-readable explanation for `blocked` and `error` responses.
- Clients must not parse `summary` or `warnings` to determine why a call failed or blocked.
- `diagnostics` should remain safe and bounded; verbose provenance should be opt-in.
- `next_actions` are guidance, not authority.

Example blocked response:

```json
{
  "status": "blocked",
  "code": "MISSING_BOARD_PERMISSION",
  "message": "Caller lacks mutate permission for board parley.",
  "summary": "Mutation was not applied.",
  "next_actions": [
    {
      "query": "my_boards",
      "reason": "Confirm accessible boards and permissions."
    }
  ]
}
```

## Mutation Envelope

Mutations return handles, deltas, summaries, and next actions. They do not return full artifact bodies by default.

```ts
type MutationResponse = {
  status: ResponseStatus;
  code?: string;
  message?: string;
  ids?: Record<string, string>;
  artifact_ref?: string;
  artifact_path?: string;
  artifact_version?: number;
  projection?: PlanProjectionPayload;
  projection_materialization?: ProjectionMaterializationResult;
  summary?: string;
  effects_recorded?: EffectSummary[];
  obligations_created?: ObligationSummary[];
  obligations_resolved?: ObligationSummary[];
  next_actions?: NextAction[];
  warnings?: string[];
  diagnostics?: Diagnostics;
};
```

Top-level artifact fields are primary artifact fields for MVP ergonomics:

- `artifact_ref`: stable artifact reference/URI when available
- `artifact_path`: local path for trusted local clients when available
- `artifact_version`: version of the primary artifact represented by this response

If a later mutation naturally touches multiple artifacts, add a plural `artifacts` array instead of overloading the primary fields:

```ts
type ArtifactHandle = {
  artifact_id?: string;
  artifact_ref?: string;
  artifact_path?: string;
  artifact_version?: number;
  role?: "primary" | "supporting" | "generated" | "updated" | string;
};
```

Do not add `artifacts` until a concrete command needs it.

## Query Envelope

Queries return bounded read models or artifact handles. Large bodies are opt-in.

```ts
type QueryResponse<T = unknown> = {
  status: "ok" | "blocked" | "error";
  code?: string;
  message?: string;
  data?: T;
  summary?: string;
  cursor?: string;
  next_actions?: NextAction[];
  warnings?: string[];
  diagnostics?: Diagnostics;
};
```

Rules:

- Queries should prefer projections/read models over raw storage records.
- Pagination or cursor fields should be included for lists that can grow.
- Bounded excerpts are acceptable; full artifacts require explicit artifact-read behavior.
- Facade board reads (`parley_query(action="board")`) must remain compact: include only board metadata and scalar counts, omit raw `records`, and omit detailed derived state. Callers that need bounded raw record excerpts should use `parley_board_projection({ includeRecords: true })`. Callers that need detailed derived graph/approval/checkpoint/nested-count state should use `parley_board_projection({ includeDerivedDetails: true })` or the compatibility alias `includeDetails: true`. For plan-specific overview, phase, review, or relationship data, prefer the scoped plan read tools before fetching broad board projections or full rendered plan projections.

## Plan Mutation Responses

Plan mutation responses should be compact by default.

Minimum plan response handle:

```ts
type PlanHandle = {
  plan_id: string;
  artifact_id?: string;
  artifact_ref?: string;
  artifact_path?: string;
  artifact_version?: number;
  status: string;
  setup_complete?: boolean;
  missing_required?: string[];
  current_phase_id?: string;
  current_phase_title?: string;
  next_required_action?: NextAction | null;
  next_recommended_actions?: NextAction[];
};
```

Plan commands that create or update plan artifacts should return:

- plan id
- artifact id/ref/path/version for the primary plan artifact
- setup completeness
- missing required fields, if any
- active/current phase, if lifecycle-active
- HITL readiness for human checkpoint/approval phases
- recommended next action
- lifecycle obligations created/resolved, summarized

Interactive/client-facing plan mutations may receive a service-rendered plan `projection` payload so clients can materialize local generated mirrors without treating local files as canonical. Tool-facing responses must strip the Markdown body after any materialization and return only compact projection metadata. Arbitrary artifact body access still belongs to explicit artifact reads.

HITL phase completion requires an explicit recorded input event before `recordPhaseOutcome(..., outcome="complete")` may advance the cursor:

```ts
type HitlInputSummary = {
  effect_id: string;
  actor?: string;
  decision: "approve" | "request_changes" | "reject" | "defer" | "comment" | "acknowledge" | string;
  summary: string;
  required_from?: string;
  source?: Record<string, unknown>;
  created_at: string;
};

type PlanStatusReadModel = {
  plan: PlanHandle & {
    current_phase_id?: string;
    phase_count?: number;
    lifecycle_revision?: number;
  };
  current_phase?: {
    phase_id: string;
    title: string;
    kind: string;
    status: string;
    hitl?: {
      required: true;
      required_from?: string;
      requested_decision?: string;
      recorded_input_count: number;
      latest_input?: HitlInputSummary;
      approving_input_effect_id?: string;
      completion_ready: boolean;
    };
  } | null;
  phases: Array<Record<string, unknown>>;
  next_action: NextAction & { kind: string; tool?: string };
};
```

When `recordPhaseOutcome(..., outcome="complete")` accepts a phase completion, the command does not re-fight the owner's judgement or require a separate confirmation. It must return advisory completion-review guidance so the agent re-checks the phase criteria, compares the claimed completion against concrete work/evidence, names any gaps, and notifies the human. Human notification is standard for now and has no opt-out flag.

```ts
type PhaseCompletionReview = {
  mode: "advisory_after_completion";
  completion_recorded: true;
  enforcement: "not_blocking_or_reverting_agent_decision";
  plan?: { plan_id: string; title?: string; resulting_status?: string };
  completed_phase?: { phase_id: string; title?: string; kind?: string; owner?: string; status?: string };
  next_phase?: { phase_id: string; title?: string; kind?: string; owner?: string; status?: string } | null;
  recorded_note?: string;
  criteria_snapshot?: {
    entry_criteria?: string[];
    work?: string[];
    exit_criteria?: string[];
    activation_conditions?: string[];
    review_trigger?: string[];
    non_goals_before_activation?: string[];
  };
  introspection_questions: string[];
  checklist: string[];
  human_notification: {
    required: true;
    opt_out_available: false;
    timing: "after_marking_complete";
    guidance: string;
  };
};
```


Plan projection payloads are generated mirrors, not an editing/import channel:

```ts
type PlanProjectionPayload = {
  kind: "plan_markdown";
  planId?: string;
  boardId?: string;
  artifactId?: string;
  artifactVersion?: number;
  uri?: string;
  mediaType: "text/markdown; charset=utf-8";
  contentDigest: string;
  body?: string; // service/client transport input only; omitted from tool-facing output
  bodyOmitted?: true;
  bodyCharLength?: number;
  bodyByteLength?: number;
  bodyLineCount?: number;
  namespace?: string;
  subpath?: string;
  filename?: string;
  serviceLocalPath?: string; // diagnostic only for remote clients
};

type ProjectionMaterializationResult = {
  status: "written" | "unchanged" | "skipped" | "failed";
  localPath?: string;
  reason?: string;
  contentDigest?: string;
};
```

Clients may materialize `projection.body` only into configured adapter-local mirror roots. OpenClaw client mirrors map `repo://plans/...` to `<mirrorRoot>/plans/...`; non-repo projection payloads fall back to namespace/subpath/filename mapping. After materialization, OpenClaw tool output omits `body` and may include `bodyOmitted` plus size metadata. The service remains canonical for state and rendering semantics.

## Artifact Read Responses

Artifact reads are the only default path for full artifact bodies.

```ts
type ArtifactReadInput = {
  board_id: string;
  artifact_id?: string;
  artifact_ref?: string;
  plan_id?: string;
  include_body?: boolean;
};

type ArtifactReadResponse = {
  status: "ok" | "blocked" | "error";
  code?: string;
  message?: string;
  artifact_id: string;
  artifact_ref?: string;
  artifact_path?: string;
  artifact_version?: number;
  title?: string;
  kind?: string;
  content_hash?: string;
  body?: string;
  body_truncated?: boolean;
  summary?: string;
  diagnostics?: Diagnostics;
};
```

Rules:

- `include_body` defaults to `false` for potentially large artifacts.
- Local filesystem paths may be returned for local clients, but clients should not be required to scrape private storage directly.
- If `body` is returned and bounded, `body_truncated` must indicate whether content was omitted.

## Error and Recovery Codes

Codes should be stable enough for tool-guided recovery. Initial code families:

- `MISSING_BOARD_ID`
- `UNKNOWN_BOARD`
- `MISSING_BOARD_PERMISSION`
- `AMBIGUOUS_CALLER_IDENTITY`
- `ANONYMOUS_MUTATION_REJECTED`
- `VALIDATION_FAILED`
- `PLAN_NOT_FOUND`
- `ARTIFACT_NOT_FOUND`
- `OBLIGATION_NOT_FOUND`
- `INVALID_LIFECYCLE_STATUS`
- `CONFLICTING_STATE`
- `UNSUPPORTED_ACTION`
- `INTERNAL_ERROR`

Specific commands may define more precise codes.

## Phase 1 Idempotency Position

`CallerContext.request_id` is trace metadata in Phase 1. It is not a general idempotency key.

Mutating commands may later define a separate `command_id` or `idempotency_key` for replay protection or at-most-once semantics. Until then, callers must not assume retrying a mutation with the same `request_id` is idempotent.
