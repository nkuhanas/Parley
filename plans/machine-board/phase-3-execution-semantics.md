# Phase 3 Execution Semantics — Machine Board Prep

Plan: `plan_268158ba516e407aa43357af049d3e02`
Phase: `phase_3_execution_semantics`
Board: `parley`
Owner: `kairos-operator`

## Canonical implementation references

Canonical schema source:

- `src/schemas/machine_board_v0.js`
- `src/schemas/node_manifest_v0.js`
- `src/schemas/index.js`

Focused tests:

- `test/parley.machine_board_v0.test.js`
- `test/parley.node_manifest_v0.test.js`

## Semantics defined

### Protected changes

Machine-board protected metadata is represented with:

- `protected.enabled`
- `protected.reason`
- `protected.required_approval`
- `protected.mutation_policy`

Allowed approval policy in v0:

- `explicit_human`

Allowed mutation policy in v0:

- `blocked_without_approval`

A protected mutating operation is not executable unless explicit approval evidence is present.

### Execution gates

Execution modes:

- `observe_only`
- `dry_run`
- `mutating`

`observe_only` operations are executable because they do not mutate infrastructure. `dry_run` operations are executable only as analysis when no mutation is requested. `mutating` operations require `approval_state: approved` plus `approval_ref`.

The schema helper `evaluateMachineBoardExecutionGate` returns an explicit `executable` boolean and reason instead of silently authorizing work.

### Idempotent domain effects

Machine-board domain effects use deterministic uniqueness from:

`board_id + effect_kind + idempotency_key`

The schema helper `createMachineBoardEffectId` derives an `effect_machine_board_<sha256-prefix>` id from those fields. `assertMachineBoardEffectIntent` rejects caller-supplied effect ids that do not match the deterministic id.

This aligns with existing Parley append-only effect storage while avoiding a new core effect field in this slice.

### Non-mutating inventory smoke loop

The first inventory smoke loop is represented as observe-only evidence using `assertMachineBoardInventoryObservation`.

Required inventory observation fields:

- `board_id`
- `observed_at`
- `source`
- `observations[]`

Each observation records:

- `object_ref`
- `kind`
- `exists`
- `power_state`
- optional `raw_ref`

This creates inspectable evidence without requiring a mutation token or changing Proxmox resources.

### Secret exclusion

Credential semantics remain identity-only. `parley.node-manifest.v0` rejects secret-bearing fields including token/password/private-key style fields. Proxmox token creation and storage remain out of scope.

## Validation evidence

- `npm test -- --test-reporter=spec` passed: 78/78 tests.
- Package self-import passed for `@nkuhanas/parley/schemas`, including both schema ids and deterministic effect id helper.
- Parley board validation passed after registering the phase artifacts.

## Phase 3 exit check

- Approval is distinct from obligation resolution: yes; explicit approval evidence is required for protected/mutating execution.
- Effect idempotency has a deterministic uniqueness key: yes; `board_id + effect_kind + idempotency_key`.
- Inventory smoke loop requires no mutation token: yes; it is represented as observe-only evidence.
