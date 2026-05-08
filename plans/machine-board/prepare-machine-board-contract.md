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
plan_id: plan_268158ba516e407aa43357af049d3e02
board_id: parley
title: Prepare machine-board contract for Proxmox node coordination
status: complete
version: 1
created_at: "2026-05-08T22:09:26.447Z"
updated_at: "2026-05-08T22:40:44.190Z"
owner: kairos-operator
participants:
  - kairos-operator
scope:
  summary: Single-agent Rio-owned Parley-side planning/specification slice only. No Proxmox provisioning, no infrastructure mutation, no token creation, and no dashboard build.
  in:
    - Define parley.machine-board.v0 contract shape
    - Define node-main board model semantics
    - Define machine object kinds and protected metadata semantics
    - Define desired vs observed state model
    - Define parley.node-manifest.v0 schema expectations
    - Define idempotent effect recording contract
    - Define approval/execution gating semantics
    - Define first non-mutating inventory ingestion smoke loop
    - Clarify OpenClaw facade boundary over standalone Parley concepts
  out:
    - Provisioning Proxmox host resources
    - Creating VMs/LXCs
    - Creating or storing Proxmox tokens
    - Implementing telemetry stack or dashboard
    - GPU worker flows
    - Backup automation
    - Changing Parley runtime deployment topology
landing:
  namespace: parley_plans
  subpath: machine-board
  filename: prepare-machine-board-contract.md
  uri: "repo://plans/machine-board/prepare-machine-board-contract.md"
  landing_root: /home/agent/workspace/Parley/plans
  resolved_path: /home/agent/workspace/Parley/plans/machine-board/prepare-machine-board-contract.md
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

# Prepare machine-board contract for Proxmox node coordination

## Purpose

Prepare a bounded Parley machine-board contract for representing and coordinating a future Proxmox-based agent infrastructure node before any node automation or Proxmox mutation work begins.

## Background

Sensei is planning a Proxmox agent infrastructure node. The agreed boundary is that physical/Proxmox bootstrap does not depend on Parley, while Parley can be prepared now as the durable coordination contract used later by admin-vm, architect/execution flow, and non-mutating inventory smoke tests.

## Scope

Single-agent Rio-owned Parley-side planning/specification slice only. No Proxmox provisioning, no infrastructure mutation, no token creation, and no dashboard build.

### In Scope

- Define parley.machine-board.v0 contract shape
- Define node-main board model semantics
- Define machine object kinds and protected metadata semantics
- Define desired vs observed state model
- Define parley.node-manifest.v0 schema expectations
- Define idempotent effect recording contract
- Define approval/execution gating semantics
- Define first non-mutating inventory ingestion smoke loop
- Clarify OpenClaw facade boundary over standalone Parley concepts

### Out of Scope

- Provisioning Proxmox host resources
- Creating VMs/LXCs
- Creating or storing Proxmox tokens
- Implementing telemetry stack or dashboard
- GPU worker flows
- Backup automation
- Changing Parley runtime deployment topology

## Current State

Parley board exists and is accessible to Rio. The machine-node concept is currently a design direction from chat/spec discussion, not yet a durable Parley contract artifact.

## Target State

A reviewed contract/spec plan exists that can guide later implementation of a machine-board profile, manifest schema, facade boundary, and non-mutating inventory smoke test.

## Plan

Keep the first slice as contract/spec work. Separate required MVP contract items from later operational convenience primitives to avoid accidentally rebuilding the full Parley platform.

## Phases

### Phase 1 — Survey existing Parley contract and schema conventions

Kind: implementation
Status: complete
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Plan approved for single-agent spec preparation.

Work:
- Inspect existing Parley board/object/effect/obligation/schema conventions.
- Identify reusable versioning and validation patterns.
- Record constraints that machine-board v0 must follow.

Exit criteria:
- Existing conventions relevant to machine-board v0 are listed with references.
- No new parallel subsystem is introduced.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
TBD

Deferral reason:
TBD

Non-goals before activation:
TBD

### Phase 2 — Draft machine-board and manifest contract

Kind: implementation
Status: complete
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Relevant Parley conventions are known.

Work:
- Draft parley.machine-board.v0 semantics.
- Draft allowed object kinds and protected metadata semantics.
- Draft desired vs observed state model.
- Draft parley.node-manifest.v0 schema expectations.

Exit criteria:
- Machine-board v0 and node-manifest v0 draft semantics exist.
- Contract explicitly excludes secrets and Proxmox mutation automation.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
TBD

Deferral reason:
TBD

Non-goals before activation:
TBD

### Phase 3 — Define approval, execution, and effect semantics

Kind: implementation
Status: complete
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Machine-board object/state model draft exists.

Work:
- Define protected-change approval gates.
- Define conditions for executable obligations.
- Define idempotent effect recording uniqueness rule.
- Define non-mutating inventory smoke loop outputs.

Exit criteria:
- Approval is clearly distinct from obligation resolution.
- Effect idempotency has a deterministic uniqueness key.
- Inventory smoke loop requires no mutation token.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
TBD

Deferral reason:
TBD

Non-goals before activation:
TBD

### Phase 4 — Prepare review package and next implementation recommendation

Kind: implementation
Status: complete
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Contract and execution semantics drafts are complete.

Work:
- Summarize required vs later primitives.
- Identify likely files/artifacts for implementation.
- Prepare Sensei review notes and recommended next slice.

Exit criteria:
- Review package is ready for Sensei decision.
- Implementation scope is bounded and does not include Proxmox provisioning.

Supporting agents:
None.

Activation conditions:
TBD

Review trigger:
TBD

Deferral reason:
TBD

Non-goals before activation:
TBD

### Phase 5 — Confirm artifact landing locations for machine-board outputs

Kind: implementation
Status: complete
Owner: kairos-operator

Required from:
N/A

Requested decision:
N/A

Due at:
N/A

Entry criteria:
- Plan accepted as the single-agent Parley-board test before activation.

Work:
- Confirm explicit landing paths for conventions, schemas, and semantics before implementation begins.
- Record that the plan overview is coordination context, not the canonical home for the resulting contract.
- Use phase outputs to produce dedicated artifacts rather than burying final semantics inside individual phase notes.

Exit criteria:
- Machine-board conventions/semantics have an explicit target artifact path.
- Node-manifest schema has an explicit target artifact path.
- Future validator/code locations are identified separately from spec documentation.

Supporting agents:
None.

Activation conditions:
- Complete before phase_1_contract_survey begins.

Review trigger:
TBD

Deferral reason:
TBD

Non-goals before activation:
- Do not activate implementation phases until artifact landing locations are explicit.

## Acceptance Criteria

- Plan remains single-agent owned by kairos-operator/Rio.
- Plan clearly separates contract/spec work from Proxmox provisioning.
- Required machine-board semantics are enumerated.
- Non-mutating inventory smoke loop is defined.
- Protected-change approval semantics distinguish obligation existence from execution approval.
- Idempotent effect recording contract includes a deterministic uniqueness rule.

## Risks and Constraints

- Scope creep into full standalone Parley platform rebuild.
- Premature automation before recovery and authority boundaries are defined.
- Conflating OpenClaw facade shape with Parley core semantics.

## Open Questions

- Should the first contract artifact live in Parley repo docs, plans, or a formal schema directory?
- Which existing Parley schema/versioning conventions should machine-board v0 reuse directly?
- How much of node-manifest v0 should be enforced by validator in the first implementation slice?

## Review and Approval

No review recorded yet.

## Change Log

- v1: Generated from Parley plan setup state.
