# Phase 1 Contract Survey — Machine Board Prep

Plan: `plan_268158ba516e407aa43357af049d3e02`
Phase: `phase_1_contract_survey`
Board: `parley`
Owner: `kairos-operator`

## Purpose

Survey existing Parley contract and schema conventions before drafting `parley.machine-board.v0` and `parley.node-manifest.v0`.

This is phase evidence, not the canonical machine-board schema. Sensei's landing decision is that schema definitions should use `src/schemas` as canonical source of truth; documentation may explain semantics and examples.

## Findings

### 1. Canonical executable schemas currently live under `src/core`, not `src/schemas`

`src/schemas/` exists but is currently empty. Existing executable schema/assertion logic is concentrated in:

- `src/core/board/board_schema.js`
- `src/core/schema/plan_v1.js`
- `src/core/protocol/schema.js`
- `src/core/plan/plan_state.js`

Implication for this plan: the new machine-board work should deliberately establish `src/schemas` as the canonical source of truth for this domain rather than casually adding another `src/core/*_schema.js` file. Integration wrappers can import from `src/schemas` or a thin re-export.

### 2. Board state is typed through frozen enums plus assert/normalize functions

Existing board-level conventions use frozen enum arrays and assertion functions:

- `ARTIFACT_KINDS`, `COORDINATION_OBJECT_KINDS`, `EFFECT_TYPES`, `OBLIGATION_TYPES` in `src/core/board/board_schema.js`
- `assertArtifactRecord`, `assertCoordinationObjectRecord`, `assertEffectRecord`, `assertObligationRecord` in the same file
- IDs are constrained with `assertRecordId` and `assertBoardId`

Reference lines:

- `src/core/board/board_schema.js:3` — artifact kinds
- `src/core/board/board_schema.js:15` — coordination object kinds
- `src/core/board/board_schema.js:41` — effect types
- `src/core/board/board_schema.js:65` — obligation types
- `src/core/board/board_schema.js:139` — record id assertion
- `src/core/board/board_schema.js:155` — board id assertion
- `src/core/board/board_schema.js:612` onward — artifact/object/effect/obligation record assertions

Implication: `parley.machine-board.v0` should follow the same explicit enum + assertion style, even if the canonical file lands under `src/schemas`.

### 3. Versioned artifact schemas use explicit schema IDs and schema descriptors

`parley.plan.v1` has:

- a stable exported schema id (`PARLEY_PLAN_V1_SCHEMA_ID`)
- a schema descriptor object (`PARLEY_PLAN_V1_SCHEMA`)
- validator/parser/render helpers in the same module family
- tests that assert schema identity and behavior

Reference lines:

- `src/core/schema/plan_v1.js:10` — `PARLEY_PLAN_V1_SCHEMA_ID = "parley.plan.v1"`
- `src/core/schema/plan_v1.js:67` — `PARLEY_PLAN_V1_SCHEMA`
- `test/parley.plan_v1.test.js:48` — test asserts schema id identity

Implication: the new contracts should use stable ids such as:

- `parley.machine-board.v0`
- `parley.node-manifest.v0`

and expose descriptor constants plus validation helpers.

### 4. Plan setup and lifecycle are separate from final contract artifacts

Plan setup state requires only overview + at least one phase:

- `src/core/plan/plan_state.js:5` — `PLAN_SETUP_REQUIRED = ["overview", "phase"]`
- `src/core/plan/plan_state.js:99` — plan setup assertion

Implication: the Parley plan should coordinate and record work, but not become the canonical source for machine-board semantics. Phase outputs should create/modify dedicated artifacts.

### 5. Effects are append-only by storage behavior, but generic idempotency is not a first-class effect field yet

Existing effect storage enforces append-only uniqueness by `effect_id`:

- `src/core/storage/board_store.js:263` — append-only save rejects existing file
- `src/core/storage/board_store.js:285` — `saveEffectRecord`
- `src/core/storage/board_store.js:287` — effects saved with `{ appendOnly: true }`
- `docs/concepts.md:45` — effects are append-only facts

There is deterministic duplicate handling in trigger firing, but not a generic effect idempotency-key contract for arbitrary infrastructure effects.

Implication: machine-board infra effects should define idempotency explicitly. Minimal compatible approach: deterministic `effect_id` derived from `board_id + effect kind + idempotency key`, or an allowed `payload.idempotency_key` plus uniqueness helper. The former fits current append-only storage better without schema expansion.

### 6. Board configuration treats artifact namespaces as trust boundaries

Board config owns storage roots, artifact namespaces, members, and policy:

- `docs/concepts.md:5` — board as coordination boundary
- `src/core/config.js:159` — board normalization
- `docs/configuration.md:65` — artifact namespaces as trust boundaries

Implication: machine-board canonical schemas should not require unsafe broad landing roots. Runtime node manifests and exported board state should be explicit artifacts under configured namespaces, not implicit writes to arbitrary paths.

### 7. Existing object kinds are coordination-oriented and closed

`COORDINATION_OBJECT_KINDS` is a closed enum containing plan/review/handoff/etc. It does not currently include domain objects like `proxmox.vm`, `storage.pool`, or `service.endpoint`.

Implication: one design decision is required before implementation:

- Option A: extend board object kinds to include machine-domain object kinds.
- Option B: add domain/profile-specific object validation layered on top of generic `object` records.
- Option C: add a domain object payload model without expanding core coordination object kind semantics.

Recommendation for the next phase: prefer a profile-specific schema under `src/schemas` first, then decide the minimal integration into core board validation after the contract is clear.

### 8. Phase insertion/reordering is currently an ergonomics gap

The added `phase_0_artifact_landing_contract` was appended to the plan rather than inserted before phase 1. This was recorded as a plan decision/effect. Current plan phase ordering should be treated as append-driven unless Parley adds insertion/reorder support.

Implication: this does not block the machine-board contract, but it should become a Parley improvement candidate after this slice.

## Constraints for `parley.machine-board.v0`

The contract should:

1. Use `src/schemas` as canonical source of truth.
2. Export stable schema ids and descriptors.
3. Use explicit enum sets for machine object kinds, protected reasons, desired/observed state fields, and effect kinds.
4. Provide assertion/validation helpers similar to existing Parley schema modules.
5. Keep secrets out of schema and manifest fields; token records must be identity-only.
6. Keep OpenClaw as a facade/client, not the conceptual owner of the schema.
7. Avoid Proxmox provisioning or mutation in this contract slice.
8. Treat docs as explanatory mirrors/examples, not canonical schema definitions.

## Candidate canonical files for next phase

Recommended canonical files:

- `src/schemas/machine_board_v0.js`
- `src/schemas/node_manifest_v0.js`
- `src/schemas/index.js`

Recommended explanatory docs, if useful after canonical schemas exist:

- `docs/machine-board/machine-board-v0.md`
- `docs/machine-board/node-manifest-v0.md`

Recommended tests:

- `test/parley.machine_board_v0.test.js`
- `test/parley.node_manifest_v0.test.js`

## Open design points for Phase 2

1. Whether machine object kinds should extend core `COORDINATION_OBJECT_KINDS` immediately or remain profile-specific until integration is needed.
2. Whether idempotent infra effects should use deterministic `effect_id`, a new first-class `idempotency_key` field, or both.
3. Whether `node-manifest` should be a pure export artifact or also have a board artifact kind.
4. Whether desired/observed state lives inside machine-domain object payloads, companion artifacts, or derived projections.

## Phase 1 exit check

- Existing conventions relevant to machine-board v0 are listed with references: yes.
- No new parallel subsystem is introduced: yes; recommendation is schema-profile first under `src/schemas`, with later integration only after contract review.
