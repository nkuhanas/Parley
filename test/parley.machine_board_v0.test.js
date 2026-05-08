import test from "node:test";
import assert from "node:assert/strict";

import {
  MACHINE_BOARD_DOMAIN_EFFECT_KINDS,
  MACHINE_BOARD_OBJECT_KINDS,
  MACHINE_BOARD_PROTECTED_REASONS,
  PARLEY_MACHINE_BOARD_V0_SCHEMA,
  PARLEY_MACHINE_BOARD_V0_SCHEMA_ID,
  assertMachineBoardDefinition,
  assertMachineBoardEffectIntent,
  assertMachineBoardInventoryObservation,
  assertMachineBoardObject,
  createMachineBoardEffectId,
  evaluateMachineBoardExecutionGate
} from "../src/schemas/machine_board_v0.js";

function validMachineObject(overrides = {}) {
  return {
    schema: PARLEY_MACHINE_BOARD_V0_SCHEMA_ID,
    object_ref: "node-main/vm/100",
    kind: "proxmox.vm",
    title: "Primary application VM",
    role: "app",
    protected: {
      enabled: true,
      reason: "control_plane",
      required_approval: "explicit_human",
      mutation_policy: "blocked_without_approval"
    },
    state: {
      desired: {
        phase: "active",
        power_state: "running",
        role: "app",
        protected: true
      },
      observed: {
        exists: true,
        power_state: "running",
        last_seen_at: "2026-05-08T22:00:00.000Z",
        source: "manual"
      }
    },
    metadata: {
      parley_object_id: "object_node_main_vm_100"
    },
    ...overrides
  };
}

test("machine-board v0 exposes stable canonical schema metadata", () => {
  assert.equal(PARLEY_MACHINE_BOARD_V0_SCHEMA.schema_id, PARLEY_MACHINE_BOARD_V0_SCHEMA_ID);
  assert.equal(PARLEY_MACHINE_BOARD_V0_SCHEMA.canonical_location, "src/schemas/machine_board_v0.js");
  assert.ok(MACHINE_BOARD_OBJECT_KINDS.includes("proxmox.node"));
  assert.ok(MACHINE_BOARD_OBJECT_KINDS.includes("api.credential_identity"));
  assert.ok(MACHINE_BOARD_PROTECTED_REASONS.includes("credential"));
  assert.ok(MACHINE_BOARD_DOMAIN_EFFECT_KINDS.includes("inventory_observed"));
  assert.match(PARLEY_MACHINE_BOARD_V0_SCHEMA.idempotency_rule, /board_id \+ effect_kind \+ idempotency_key/);
});

test("machine-board object validation normalizes protected desired and observed state", () => {
  const object = assertMachineBoardObject(validMachineObject());

  assert.equal(object.schema, PARLEY_MACHINE_BOARD_V0_SCHEMA_ID);
  assert.equal(object.kind, "proxmox.vm");
  assert.equal(object.protected.enabled, true);
  assert.equal(object.protected.required_approval, "explicit_human");
  assert.equal(object.protected.mutation_policy, "blocked_without_approval");
  assert.equal(object.state.desired.phase, "active");
  assert.equal(object.state.observed.source, "manual");
});

test("machine-board rejects unknown object kinds and extra payload fields", () => {
  assert.throws(() => assertMachineBoardObject(validMachineObject({ kind: "proxmox.cluster" })), /kind must be one of/);
  assert.throws(() => assertMachineBoardObject(validMachineObject({ surprise: true })), /surprise is not allowed/);
});

test("machine-board definition defaults enum declarations and validates objects", () => {
  const definition = assertMachineBoardDefinition({
    schema: PARLEY_MACHINE_BOARD_V0_SCHEMA_ID,
    board: {
      id: "node-main",
      domain_type: "machine",
      protocol: PARLEY_MACHINE_BOARD_V0_SCHEMA_ID,
      purpose: "Coordinate node-main without granting mutation authority."
    },
    objects: [validMachineObject()]
  });

  assert.deepEqual(definition.object_kinds, [...MACHINE_BOARD_OBJECT_KINDS]);
  assert.deepEqual(definition.protected_reasons, [...MACHINE_BOARD_PROTECTED_REASONS]);
  assert.equal(definition.objects[0].object_ref, "node-main/vm/100");
});

test("machine-board domain effects use deterministic idempotent effect ids", () => {
  const effectId = createMachineBoardEffectId({
    board_id: "node-main",
    effect_kind: "inventory_observed",
    idempotency_key: "scan:2026-05-08T22:00Z"
  });

  const intent = assertMachineBoardEffectIntent({
    board_id: "node-main",
    effect_kind: "inventory_observed",
    idempotency_key: "scan:2026-05-08T22:00Z",
    effect_id: effectId,
    target_object_ref: "node-main/vm/100",
    evidence_ref: "repo://exports/node-main/inventory.json"
  });

  assert.equal(intent.effect_id, effectId);
  assert.match(intent.effect_id, /^effect_machine_board_[a-f0-9]{32}$/);
  assert.throws(() => assertMachineBoardEffectIntent({
    board_id: "node-main",
    effect_kind: "inventory_observed",
    idempotency_key: "scan:2026-05-08T22:00Z",
    effect_id: "effect_machine_board_wrong"
  }), /must equal deterministic machine-board effect id/);
});

test("machine-board execution gates separate observation from protected mutation approval", () => {
  assert.deepEqual(evaluateMachineBoardExecutionGate({ mode: "observe_only", protected: true }).executable, true);

  const blocked = evaluateMachineBoardExecutionGate({ mode: "mutating", protected: true });
  assert.equal(blocked.executable, false);
  assert.match(blocked.reason, /approval evidence required/);

  const approved = evaluateMachineBoardExecutionGate({
    mode: "mutating",
    protected: true,
    approval_state: "approved",
    approval_ref: "effect_human_approval"
  });
  assert.equal(approved.executable, true);
});

test("machine-board inventory observation is observe-only evidence", () => {
  const observation = assertMachineBoardInventoryObservation({
    board_id: "node-main",
    observed_at: "2026-05-08T22:00:00.000Z",
    source: "proxmox_inventory",
    observations: [
      {
        object_ref: "node-main/vm/100",
        kind: "proxmox.vm",
        exists: true,
        power_state: "running",
        raw_ref: "pve/qemu/100"
      }
    ],
    export_ref: "repo://exports/node-main/inventory-20260508.json"
  });

  assert.equal(observation.schema, PARLEY_MACHINE_BOARD_V0_SCHEMA_ID);
  assert.equal(observation.observations[0].object_ref, "node-main/vm/100");
  assert.throws(() => assertMachineBoardInventoryObservation({
    board_id: "node-main",
    observed_at: "not-a-date",
    observations: []
  }), /observed_at must be an ISO timestamp/);
});
