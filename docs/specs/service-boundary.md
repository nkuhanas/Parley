# Parley Service Boundary

Status: draft Phase 1 contract  
Owner: Parley board / kairos-operator  
Related plan: `plans/parley-service/service-boundary-plan.md`

## Purpose

This document defines the first service boundary for Parley. The boundary is an application-service contract over the existing Parley core, not a commitment to a daemon, network server, dashboard, database, or transport.

## Boundary Statement

Parley is the coordination service/substrate. Host runtimes, CLIs, dashboards, telemetry bridges, and other integrations are clients or facades over Parley.

OpenClaw is one client surface. It may expose Parley commands as tools and format responses for agents, but it must not own Parley board semantics, lifecycle rules, storage rules, artifact mutation rules, or projections.

## Terms

- **Core/domain logic**: runtime-neutral Parley modules for boards, artifacts, objects, effects, obligations, relationships, triggers, plans, schemas, storage, validation, and projections.
- **Application service**: command/query boundary over core logic. It owns request/response contracts, transaction boundaries, response shaping, caller context normalization, and operation orchestration.
- **Service process**: possible future long-running `parleyd` process exposing the application service over a transport. Deferred.
- **Service deployment**: possible future packaging shape such as local daemon, systemd service, container, or hosted service. Deferred.
- **Transport adapter**: HTTP, Unix socket, stdio/RPC, IPC, embedded call, or another transport. Transport adapters contain no domain logic.
- **Client/facade**: OpenClaw tools, CLI commands, dashboard, telemetry bridge, or other callers that invoke the application service.

## Layering

```txt
clients/facades
  OpenClaw tools, CLI, dashboard, telemetry bridge
        |
transport adapter (optional/future)
  embedded, HTTP, Unix socket, stdio/RPC, IPC
        |
application service
  commands, queries, caller context, response envelopes
        |
core/domain
  board state, protocol state, plans, projections, schemas, storage
```

Phase 1 specifies the application service contract while the implementation may remain embedded/in-process.

## Ownership Rules

The Parley core/application service owns:

- board identity, membership, and fail-closed resolution rules
- board/object/effect/obligation/relationship/checkpoint semantics
- plan lifecycle and setup semantics
- artifact registration and artifact-read semantics
- trigger evaluation and obligation lifecycle transitions
- projection/read-model construction
- schema validation
- storage transaction boundaries
- compact response envelopes

The OpenClaw adapter owns:

- OpenClaw tool descriptors and registration
- runtime identity extraction from OpenClaw context
- mapping tool input into service command/query input
- delivery-specific output formatting
- OpenClaw-specific diagnostics and transport errors
- compatibility facades such as `parley_query` and `parley_mutate`

The OpenClaw adapter must not own:

- board semantics
- plan lifecycle rules
- obligation lifecycle logic
- effect semantics
- artifact mutation rules
- projection construction

## Caller Context

Application service commands and queries receive normalized caller context after any host-specific identity extraction.

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

Rules:

- Mutations must not be anonymous.
- Host-specific runtime refs stay outside the service contract unless explicitly normalized into `CallerContext` or command input.
- `request_id` is trace metadata in Phase 1, not a blanket idempotency guarantee.
- Idempotency, when needed, should be defined per mutating command through a separate `command_id` or `idempotency_key`.

## Board Target Precedence

Board affinity is explicit for mutations.

- If command/query input includes `board_id`, it is the explicit operation target.
- `CallerContext.board_id` may provide default board context for reads only.
- Mutations requiring board affinity must receive explicit `board_id` in command input unless a specific command contract says otherwise.
- `default_board` discovery hints must not silently route board-scoped mutations.

This preserves existing Parley fail-closed behavior around board ambiguity.

## Command and Query Families

The application service exposes commands for state transitions and queries for read/projection access.

Initial command families:

- runtime protocol: open/reply/claim/probe/settle/conclude threads, record dispatch/human-summary anchors
- artifacts and objects: register artifacts, create objects, record effects, record/remove relationships
- obligations and triggers: create/resolve obligations, create triggers
- plans: create plan, write overview, add phase/checkpoint, request review, record review, mark ready, activate, pause/resume, record phase outcome, record plan disposition

Initial query families:

- discovery and recovery: describe, my boards, where am I
- current-tool-aligned board projections: board projection, checkpoint projection
- current-tool-aligned obligations: runtime obligations, board obligations
- validation: plan validation, board state validation
- reference search: board-registered namespace search
- artifact reads: explicit artifact and plan artifact reads

## Dashboard Readiness

Dashboard support is a read/projection contract, not a Phase 1 UI or transport implementation.

Dashboard and agent clients should consume service projections/read models rather than scraping OpenClaw runtime state or private storage. Phase 2 should implement current-tool-aligned service query names first, such as `getBoardProjection`, `listBoardObligations`, and `listRuntimeObligations`, so the service extraction does not invent new projection semantics.

Dashboard-friendly read model names can be added later as aliases or thin wrappers when dashboard tests or consumers need them:

- `getBoardOverview`
- `listPlans`
- `getPlanStatus`
- `listObligations`
- `listRecentEffects`
- `listObjects`
- `listRelationships`
- `readArtifact`

Effect cursors/checkpoints should be shaped so polling or future SSE/WebSocket support can be added without changing domain semantics.

## Transport Policy

No transport implementation is required in Phase 1. Contracts should remain transport-safe so the same service can later be exposed through embedded calls, HTTP, Unix socket, stdio/RPC, IPC, or another adapter.

Transport adapters must not introduce domain behavior. They translate wire format into application service calls and translate application service responses back to clients.

## Non-goals for Phase 1

- no `parleyd` daemon
- no HTTP/RPC/IPC implementation
- no dashboard UI
- no auth or multi-tenant policy beyond placeholders in caller context
- no database migration
- no telemetry stack
- no Proxmox or machine-board execution expansion
- no token/secret management
- no OpenClaw tool removal
- no redesign of existing board/object/effect/obligation/relationship/plan/trigger semantics
