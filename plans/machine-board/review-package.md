# Review Package — Machine Board Contract Prep

Plan: `plan_268158ba516e407aa43357af049d3e02`
Board: `parley`
Owner: `kairos-operator`

## Summary

The machine-board preparation slice produced canonical Parley-owned schema contracts under `src/schemas`, plus focused tests and Parley evidence artifacts. No Proxmox provisioning, VM/LXC creation, token creation, secret storage, or infrastructure mutation was performed.

## Canonical artifacts

Schema source of truth:

- `src/schemas/machine_board_v0.js`
- `src/schemas/node_manifest_v0.js`
- `src/schemas/index.js`

Package exposure:

- `src/index.js` re-exports schemas through the package root.
- `package.json` exposes `@nkuhanas/parley/schemas` and `@nkuhanas/parley/schemas/*`.

Tests:

- `test/parley.machine_board_v0.test.js`
- `test/parley.node_manifest_v0.test.js`

Phase evidence:

- `plans/machine-board/phase-1-contract-survey.md`
- `plans/machine-board/phase-3-execution-semantics.md`
- `plans/machine-board/review-package.md`

Plan landing:

- `plans/machine-board/prepare-machine-board-contract.md`

## What `parley.machine-board.v0` now covers

- Stable schema id: `parley.machine-board.v0`
- Generic machine object kinds including machine nodes, compute instances, container instances, storage, network, credential identities, service endpoints, recovery artifacts, telemetry sources, and safety obligations.
- Provider metadata envelope for adapter-specific traceability (`provider.name`, `provider.resource_type`, `provider.native_id`, `provider.raw_ref`).
- Protected metadata semantics:
  - `protected.enabled`
  - `protected.reason`
  - `protected.required_approval`
  - `protected.mutation_policy`
- Desired vs observed state:
  - desired phase, power state, role, protected marker
  - observed existence, power state, last seen timestamp, source
- Execution semantics:
  - `observe_only`
  - `dry_run`
  - `mutating`
- Approval states:
  - `not_required`
  - `required`
  - `approved`
  - `rejected`
- Deterministic effect idempotency:
  - uniqueness key: `board_id + effect_kind + idempotency_key`
  - deterministic id helper: `createMachineBoardEffectId`
- Non-mutating inventory observation evidence.

## What `parley.node-manifest.v0` now covers

- Stable schema id: `parley.node-manifest.v0`
- Node identity and lifecycle phase.
- Hardware and storage sections as intentionally loose objects for the first slice.
- Partition map with VM/LXC inference to machine object kinds.
- Credential identities that must remain identity-only.
- Recovery document references.
- Export references for board/manifest snapshots and off-node targets.

## Secret and mutation boundaries

The contract rejects credential secret material in node manifests. Forbidden credential keys include token/password/private-key style fields.

The generic contract does not encode Proxmox as its ontology. Proxmox appears only as provider metadata in fixtures and adapter output. The contract does not create Proxmox tokens, store Proxmox tokens, create VMs/LXCs, or mutate infrastructure. Mutating operation semantics are represented only as future gate logic requiring explicit approval evidence.

## Validation evidence

Commands run:

- `npm test -- --test-reporter=spec`
  - Result: 78/78 tests passing.
- `node -e "import('@nkuhanas/parley/schemas').then(...)"`
  - Result: package self-import exposed both schema ids and deterministic effect id helper.
- `parley_validate_state(boardId: "parley")`
  - Result: board validation passes.

## Remaining open design points

1. Core object-kind integration: keep machine-domain object kinds schema-specific and generic for now; do not extend `COORDINATION_OBJECT_KINDS` until an implementation slice needs direct board object validation.
2. Artifact kinds: keep schema files registered as `invariant_spec` references. Add a first-class artifact kind only if Parley needs to query schema artifacts differently.
3. Node-manifest enforcement depth: first implementation should enforce identity/shape/secret rules, but leave hardware and storage inventory details loose until the real node inventory shape is known.
4. Effect idempotency: deterministic effect id is sufficient for v0. A first-class core `idempotency_key` can be considered later if multiple domains need the same pattern.
5. Phase ordering ergonomics: Parley currently appends phases; insertion/reordering should be a separate Parley improvement, not part of this machine-board slice.

## Recommended next implementation slice

Recommended next slice: add a non-mutating node-main manifest fixture and inventory smoke importer that validates against these schemas.

Scope:

- Add a sample `node-manifest.yaml`/JSON fixture for `node-main` using `parley.node-manifest.v0`.
- Add a non-mutating inventory input fixture that produces `inventory_observed` intent records.
- Validate deterministic effect ids and execution gates without writing Proxmox or storing secrets.
- Keep Proxmox API/token setup manual and out of repo until Sensei explicitly approves an infrastructure slice.

Non-goals for next slice:

- No Proxmox provisioning.
- No VM/LXC creation.
- No token creation or secret storage.
- No dashboard or telemetry stack.

## Review recommendation

Approve the contract direction as a first draft and continue with the non-mutating fixture/importer slice. Do not promote this to live Proxmox execution until a separate approval gate explicitly authorizes infrastructure mutation.
