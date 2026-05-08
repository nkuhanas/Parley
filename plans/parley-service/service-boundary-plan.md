---
schema: parley.plan.v1
artifact_kind: plan
authority:
  owner:
    type: agent
    id: kairos-operator
  createdBy:
    type: agent
    id: kairos-operator
plan_id: plan_parley_service_boundary_v1
board_id: parley
title: Decouple Parley into a dedicated service with OpenClaw facade clients
status: draft
version: 2
created_at: "2026-05-08T23:25:20.000Z"
updated_at: "2026-05-08T23:33:00.000Z"
owner: kairos-operator
participants:
  - kairos-operator
scope:
  summary: Draft the service boundary for Parley as a dedicated app/service while keeping OpenClaw tools as facade clients and preserving a future dashboard path.
  in:
    - Define Parley service ownership boundary
    - Disambiguate application service, service process, deployment, transport, and client/facade terminology
    - Define OpenClaw facade/client responsibilities
    - Define dashboard-ready API and projection expectations
    - Define plan tool output slimming requirements
    - Define normalized caller context and compact response envelope requirements
    - Define explicit artifact-read behavior
    - Preserve explicit plan-phase addition flows
    - Identify migration slices from embedded runtime usage to service-backed usage
  out:
    - Implementing the service in this draft slice
    - Building HTTP/RPC transport, parleyd, or dashboard UI
    - Replacing existing OpenClaw tools immediately
    - Changing board-state semantics without explicit follow-up approval
    - Adding authentication or multi-tenant policy beyond boundary placeholders
    - Adding database migration, telemetry stack, Proxmox integration, machine-board execution flows, token management, or OpenClaw tool removal
landing:
  namespace: parley_plans
  subpath: parley-service
  filename: service-boundary-plan.md
  uri: "repo://plans/parley-service/service-boundary-plan.md"
  landing_root: /home/agent/workspace/Parley/plans
  resolved_path: /home/agent/workspace/Parley/plans/parley-service/service-boundary-plan.md
review:
  required_reviewers: []
  approvals: []
  objections: []
relationships:
  supersedes: []
  superseded_by: []
  extracts_from: []
  constrains: []
  constrained_by: []
  depends_on: []
  blocks: []
  blocked_by: []
  related_to: []
parley:
  object_id: null
  artifact_id: null
  source_thread_id: null
  source_message_id: null
coordination_mode: single_agent
---

# Decouple Parley into a dedicated service with OpenClaw facade clients

## Purpose

Define the next Parley architecture slice: move Parley toward a dedicated app/service boundary, with OpenClaw tools acting as clients/facades rather than Parley's conceptual or runtime owner. The design must support both current agent-tool workflows and a possible future dashboard connected to the same service.

## Background

Parley currently ships substantial coordination behavior through in-process library code and OpenClaw tool adapters. This was useful for dogfooding, but it couples Parley too tightly to one runtime surface. Sensei wants Parley to stand alone as the durable coordination service, while OpenClaw remains one consumer of that service.

Recent plan-tool usage also exposed a UX issue: plan-related tool calls can return the entire plan artifact, which is noisy for agents and chat surfaces. Outputs should prefer artifact refs/paths and compact state summaries; agents can read the artifact explicitly when they need the full body.

## Scope

This plan is a design/specification slice only. It should produce a concrete implementation roadmap for a service boundary without prematurely rewriting Parley internals or dashboarding.

### In Scope

- Specify Parley's service boundary and ownership model.
- Specify how OpenClaw tools become facade/client adapters.
- Specify dashboard-ready read APIs, projections, and event/update surfaces.
- Specify compact tool response contracts for plan-related actions.
- Preserve and clarify explicit plan phase addition flows.
- Identify staged migration slices that keep existing tests and tool behavior stable.

### Out of Scope

- Building the service implementation in this draft slice.
- Building HTTP/RPC transport, `parleyd`, or dashboard UI.
- Introducing Proxmox/node work or machine-board execution flows.
- Creating or storing tokens/secrets.
- Creating a telemetry stack.
- Creating a new database requirement before storage migration is designed.
- Removing existing OpenClaw tools before service-backed replacements exist.
- Redesigning Parley board/object/effect/obligation/relationship/plan/trigger semantics without explicit approval.

## Current State

- Parley core logic lives as package/library code.
- OpenClaw adapters expose Parley operations as first-class tools.
- File-backed board state and artifacts are already useful, but access is primarily in-process.
- Guided plan tools can create/update plan artifacts and phases, but response payloads can be too large because they include full plan artifact content.
- Future dashboard needs are not yet represented as first-class service/API constraints.

## Target State

Parley has a clear service-oriented architecture:

- `@nkuhanas/parley` core remains runtime-neutral and owns schemas, storage semantics, projections, validation, lifecycle logic, and domain rules.
- An application service boundary exposes stable commands/queries over the core.
- A future Parley service process may expose the application service over HTTP, Unix socket, stdio/RPC, IPC, or another transport.
- OpenClaw tools call the service through a thin client/facade layer.
- A future dashboard can use the same service APIs and projections as OpenClaw.
- Tool responses return compact summaries plus artifact refs/paths, not full artifact bodies by default.
- Phase addition remains an explicit, guided operation with clear setup/lifecycle status responses.

Architectural framing:

- Parley is the coordination service/substrate.
- OpenClaw is an agent command surface over Parley.
- Dashboard is a read/projection surface over Parley.
- Telemetry is a signal-writing client.
- Machine-board is a Parley domain profile.
- External systems are observed or mutated substrates, not Parley's owner.

## Plan

Use an incremental extraction approach. First define API contracts and response envelopes, then introduce an in-process service facade, then move OpenClaw tools onto that facade, and only then decide whether to run the service out-of-process over HTTP/RPC.

Service terminology:

- **Parley core/domain logic** — existing board, object, effect, obligation, relationship, trigger, plan, storage, projection, and schema modules. No OpenClaw dependency.
- **Application service** — command/query boundary over Parley core. Owns request/response contracts, transaction semantics, response shaping, normalized caller context handling, and domain operation orchestration. This is the immediate implementation target.
- **Service process** — future long-running `parleyd` process exposing the application service through a transport. Not part of the first implementation slice.
- **Service deployment** — future packaging/deployment shape such as local daemon, systemd service, container, or other host-specific deployment. Not part of the first implementation slice.
- **Transport adapter** — HTTP, Unix socket, stdio/RPC, IPC, or embedded adapter. No domain logic.
- **Client/facade** — OpenClaw tools, CLI, dashboard, telemetry bridge, or other callers that invoke the application service.

Recommended service layers:

1. **Core domain layer** — existing board, plan, storage, trigger, projection, and schema modules. No OpenClaw dependency.
2. **Application service layer** — command/query functions with stable request/response contracts. Owns transaction boundaries and compact response shaping.
3. **Transport layer** — future HTTP/RPC/IPC adapter. No domain logic.
4. **Client/facade layer** — OpenClaw tools, CLI, dashboard, telemetry bridge, and future clients.

Caller context policy:

All service commands/queries should receive normalized caller context before finalized auth exists. Mutations must not be anonymous. OpenClaw-specific identity extraction stays in the OpenClaw adapter; the application service receives normalized context.

```ts
type CallerContext = {
  actor_id: string;
  actor_type: "agent" | "human" | "service";
  runtime?: "openclaw" | "cli" | "dashboard" | "telemetry" | "bootstrap" | string;
  board_id?: string;
  request_id?: string;
  capabilities?: string[];
};
```

This is not a full authentication or multi-tenant policy. It is the minimal request envelope needed to keep service calls accountable and transport-safe.

Response envelope policy:

- Mutations return handles, deltas, summaries, and next actions.
- Mutations do not return full artifact bodies by default.
- Full artifact bodies are returned only through explicit read/include-body requests.
- Plan-specific mutations must not return entire plan Markdown by default.
- Plan setup/status responses should be bounded and should include `plan_id`, `artifact_id`, `artifact_ref`, `artifact_path`, setup completeness, missing fields, active/current phase, and recommended next action.

```ts
type MutationResponse = {
  status: "ok" | "blocked" | "needs_review" | "error";
  ids?: Record<string, string>;
  artifact_ref?: string;
  artifact_path?: string;
  artifact_version?: number;
  summary?: string;
  effects_recorded?: Array<unknown>;
  obligations_created?: Array<unknown>;
  obligations_resolved?: Array<unknown>;
  next_actions?: Array<unknown>;
  warnings?: Array<string>;
};
```

Artifact-read policy:

- The service should expose explicit artifact-read commands/queries.
- Filesystem paths may be returned for local clients, but clients should not be required to scrape private storage directly.
- Artifact-read queries should support `include_body?: boolean`; default should be `false` where the body may be large.
- Initial artifact queries should include `readArtifact({ artifact_id })`, `readArtifactByRef({ artifact_ref })`, `readPlanArtifact({ plan_id })`, and `getPlanStatus({ plan_id })`.

Projection/read-model policy:

- Canonical state lives in Parley core storage.
- Consumer-facing state should be exposed through service projections/read models.
- Dashboard, OpenClaw, CLI, and telemetry clients should prefer projections unless they need raw artifacts.
- Dashboard should consume board projections and artifact refs through the service, not by reading private OpenClaw session state.
- Initial read models should include `getBoardOverview()`, `listPlans()`, `getPlanStatus()`, `listObligations()`, `listRecentEffects()`, `listObjects()`, `listRelationships()`, and `readArtifact()`.
- Live updates can be deferred, but effect cursors/checkpoints should be shaped so polling or later SSE/WebSocket support is straightforward.

Transport policy:

- Transport is deferred. First implementation uses an embedded/in-process application service module.
- Contracts must be shaped so they can later be exposed through HTTP, Unix socket, stdio/RPC, IPC, or another transport without changing domain semantics.
- Likely later deployment is local `parleyd` over HTTP or Unix socket.
- Dashboard later likely favors HTTP plus SSE or WebSocket-style updates.
- No transport implementation should happen in Phase 1.

OpenClaw facade policy:

OpenClaw adapter owns:

- Tool descriptors.
- Runtime identity extraction.
- Delivery formatting.
- OpenClaw-specific errors.
- Mapping tool calls to service commands/queries.

OpenClaw adapter does not own:

- Board semantics.
- Plan lifecycle rules.
- Obligation lifecycle logic.
- Effect semantics.
- Artifact mutation rules.
- Projection construction.

## Phases

### Phase 1 — Service boundary and API contract spec

Kind: implementation
Status: proposed
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Sensei approves service-boundary planning as the next Parley slice.

Work:
- Inventory current OpenClaw tool actions and map them to service commands/queries.
- Define command/query envelope conventions, including normalized `CallerContext`.
- Define compact mutation response envelopes as a hard API rule.
- Define explicit artifact-read queries and `include_body` behavior.
- Define compact response shape for plan tools.
- Define dashboard-oriented read models and pagination/cursor expectations.

Exit criteria:
- A service API contract document exists, preferably under `docs/specs/service-api-contract.md` or equivalent repo-appropriate location.
- Response envelope and artifact-read behavior are specified before implementation, preferably under `docs/specs/response-envelopes.md` or equivalent repo-appropriate location.
- Service-boundary terminology is captured in `docs/specs/service-boundary.md` or this plan is promoted to an equivalent spec document.
- OpenClaw facade responsibilities are explicitly separated from Parley service responsibilities.
- No implementation migration begins before the boundary is reviewed.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
- Service API contract draft is ready for Sensei review.

Deferral reason:
TBD

Non-goals before activation:
- Do not implement HTTP/RPC transport.
- Do not implement `parleyd`.
- Do not implement dashboard UI, auth/multi-tenant policy, database migration, telemetry stack, Proxmox integration, machine-board execution flows, token management, OpenClaw tool removal, or semantic redesign of core records.
- Do not alter existing tool behavior beyond documentation.

### Phase 2 — In-process application service facade

Kind: implementation
Status: proposed
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Phase 1 contract accepted.

Work:
- Add `src/service/` application command/query modules over existing core functions.
- Keep storage and domain logic in existing core modules.
- Add tests proving service commands match current tool behavior.
- Implement compact response shaping for plan commands at the service layer.
- Keep explicit add-plan-phase service commands as guided plan setup/lifecycle operations.

Exit criteria:
- Service layer can perform existing key Parley operations in-process.
- OpenClaw-independent tests cover the service facade.
- Full artifact bodies are not returned by default for plan mutations.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
- Service facade tests pass and response shapes are inspectable.

Deferral reason:
TBD

Non-goals before activation:
- Do not add network server yet.
- Do not remove OpenClaw tools.

### Phase 3 — Move OpenClaw tools onto service client boundary

Kind: implementation
Status: proposed
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- In-process service facade exists and passes tests.

Work:
- Refactor OpenClaw tools to call service commands/queries instead of directly owning domain orchestration.
- Keep OpenClaw-specific caller identity, transport, and tool descriptor behavior in the OpenClaw adapter.
- Update tests so OpenClaw tools are verified as facade clients.
- Slim plan tool outputs to artifact paths/refs plus compact status summaries.

Exit criteria:
- OpenClaw adapter contains runtime integration only.
- Parley service layer owns command/query behavior.
- Existing OpenClaw tool tests pass with compact outputs.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
- Facade migration diff is ready for review.

Deferral reason:
TBD

Non-goals before activation:
- Do not break existing tool names or user workflows without explicit migration approval.

### Phase 4 — Dashboard-ready service transport design

Kind: implementation
Status: deferred
Owner: kairos-operator

Required from:
N/A

Requested decision:
- Choose initial service transport shape later: local HTTP, Unix socket, stdio/RPC, or embedded-only with future transport reserved.

Due at:
N/A

Entry criteria:
- OpenClaw tools are facade clients over the service layer.

Work:
- Define transport adapter requirements.
- Define auth/session placeholder boundaries.
- Define dashboard read endpoints and effect cursor semantics.
- Decide whether to ship a local dev service binary/CLI.

Exit criteria:
- Dashboard can be built later without scraping OpenClaw runtime state.
- Transport plan is explicit but not overbuilt.

Supporting agents:
None.

Activation conditions:
- Service facade is stable.
- Sensei approves dashboard/service transport direction.

Review trigger:
- Transport options and recommendation are ready.

Deferral reason:
- Dashboard and network service are future-facing; current need is decoupling ownership and response contracts first.

Non-goals before activation:
- Do not build the dashboard.
- Do not add auth complexity before choosing transport.

## Acceptance Criteria

- A reviewed service-boundary spec exists before implementation migration.
- “Service” terminology is disambiguated into application service, service process, deployment, transport, and client/facade.
- A normalized caller context shape is specified.
- OpenClaw is described as a facade/client, not Parley's runtime owner.
- Future dashboard access is supported by service projections and artifact refs.
- Mutation response envelopes are compact by default.
- Plan mutation outputs are specified as compact by default.
- Plan artifact path/ref is present in relevant outputs.
- Full artifact body return requires explicit artifact-read or `include_body: true`.
- Full plan artifact body is only returned on explicit read/include-body request.
- Add-plan-phase behavior remains an explicit supported flow.
- Dashboard readiness is represented through read models/projections, not dashboard implementation.
- Transport remains deferred, but contracts are transport-safe.
- Existing OpenClaw tool names/workflows are not broken without separate approval.
- No daemon, auth system, database migration, dashboard, telemetry stack, Proxmox integration, machine-board automation, token management, or OpenClaw tool removal is introduced in this planning slice.
- Existing Parley board/object/effect/obligation semantics remain intact unless separately approved.

## Risks and Constraints

- Too-large migration could destabilize already-working Parley tool behavior; keep slices small.
- Introducing transport too early could distract from the cleaner service boundary extraction.
- Dashboard needs can overexpand scope; keep dashboard readiness to read models, cursors, and artifact refs for now.
- Compact outputs must still include enough next-action guidance for agents to proceed safely.
- Boundary extraction must not redesign boards, objects, effects, obligations, relationships, plans, triggers, machine-board semantics, or storage topology without a separate approved plan.
- OpenClaw-specific identity and delivery concerns must not leak into core service concepts.

## Open Questions

- Should the first service transport be HTTP, Unix socket, stdio/RPC, or deferred until the in-process service facade is stable?
- Should compact plan responses include `artifact_path`, `artifact_ref`, or both in all environments?
- Should artifact reads be a generic service endpoint or separate filesystem-backed client concern?
- What dashboard auth model is expected eventually: local-only trusted UI, token-authenticated API, or delegated host auth?
- Should service command responses include effect cursors now, or defer until dashboard/live update work begins?
- Should telemetry be represented first as a signal-writing client in the API contract, or deferred entirely until dashboard/read-model work begins?

## Review and Approval

This draft should be reviewed by Sensei before implementation. The recommended next implementation slice, if approved, is Phase 1 only: write the service API contract and response envelope spec. Implementation of the application service, service process, transport, dashboard, auth, database migration, telemetry stack, Proxmox integration, and OpenClaw tool migration should wait until that contract is reviewed.

## Change Log

- 2026-05-08: Initial draft created from Sensei direction to decouple Parley from OpenClaw, preserve plan-phase flows, support future dashboard access, and slim plan tool outputs.
- 2026-05-08: Folded review feedback into the plan: clarified service terminology, caller context, compact mutation envelopes, artifact reads, projection/read-model policy, deferred transport, OpenClaw facade responsibilities, and stronger non-goals.
