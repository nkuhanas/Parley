import { createHash } from "node:crypto";

import { isIsoTimestamp } from "../core/time.js";

export const PARLEY_MACHINE_BOARD_V0_SCHEMA_ID = "parley.machine-board.v0";
export const PARLEY_MACHINE_BOARD_V0_DOMAIN_TYPE = "machine";

export const MACHINE_BOARD_OBJECT_KINDS = Object.freeze([
  "proxmox.node",
  "proxmox.vm",
  "proxmox.lxc",
  "storage.device",
  "storage.pool",
  "network.bridge",
  "backup.job",
  "api.credential_identity",
  "service.endpoint",
  "recovery.artifact",
  "telemetry.source",
  "safety.obligation"
]);

export const MACHINE_BOARD_PROTECTED_REASONS = Object.freeze([
  "host",
  "control_plane",
  "storage",
  "network",
  "credential",
  "backup",
  "recovery",
  "safety"
]);

export const MACHINE_BOARD_APPROVAL_POLICIES = Object.freeze(["explicit_human"]);
export const MACHINE_BOARD_MUTATION_POLICIES = Object.freeze(["blocked_without_approval"]);
export const MACHINE_BOARD_DESIRED_PHASES = Object.freeze(["planned", "planned_later", "active", "retired"]);
export const MACHINE_BOARD_POWER_STATES = Object.freeze(["running", "stopped", "paused", "unknown", "not_applicable"]);
export const MACHINE_BOARD_OBSERVED_SOURCES = Object.freeze([
  "manual",
  "proxmox_inventory",
  "telemetry",
  "parley_export",
  "unknown"
]);

export const MACHINE_BOARD_DOMAIN_EFFECT_KINDS = Object.freeze([
  "inventory_observed",
  "desired_state_recorded",
  "protected_change_requested",
  "approval_recorded",
  "execution_obligation_created",
  "execution_result_recorded"
]);

export const MACHINE_BOARD_EXECUTION_MODES = Object.freeze(["observe_only", "dry_run", "mutating"]);
export const MACHINE_BOARD_APPROVAL_STATES = Object.freeze(["not_required", "required", "approved", "rejected"]);

export const PARLEY_MACHINE_BOARD_V0_SCHEMA = Object.freeze({
  schema_id: PARLEY_MACHINE_BOARD_V0_SCHEMA_ID,
  domain_type: PARLEY_MACHINE_BOARD_V0_DOMAIN_TYPE,
  canonical_location: "src/schemas/machine_board_v0.js",
  purpose: "Represent a machine-scoped operational board for infrastructure nodes without granting mutation authority.",
  object_kinds: MACHINE_BOARD_OBJECT_KINDS,
  protected_reasons: MACHINE_BOARD_PROTECTED_REASONS,
  approval_policies: MACHINE_BOARD_APPROVAL_POLICIES,
  mutation_policies: MACHINE_BOARD_MUTATION_POLICIES,
  domain_effect_kinds: MACHINE_BOARD_DOMAIN_EFFECT_KINDS,
  execution_modes: MACHINE_BOARD_EXECUTION_MODES,
  approval_states: MACHINE_BOARD_APPROVAL_STATES,
  idempotency_rule: "machine-board domain effects use deterministic effect ids derived from board_id + effect_kind + idempotency_key.",
  state_model: Object.freeze({
    desired: Object.freeze(["phase", "power_state", "role", "protected"]),
    observed: Object.freeze(["exists", "power_state", "last_seen_at", "source"])
  }),
  secret_policy: "Credential objects are identity-only. Secret values, token material, passwords, and private keys are never valid machine-board payload fields.",
  execution_policy: "observe_only and dry_run operations may be recorded without infrastructure mutation. mutating operations require explicit approval evidence and remain outside this preparation slice."
});

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} required`);
  return value.trim();
}

function assertOptionalString(value, fieldName) {
  if (value == null) return null;
  return assertNonEmptyString(value, fieldName);
}

function assertEnum(value, allowedValues, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function assertOptionalEnum(value, allowedValues, fieldName, fallback = null) {
  if (value == null) return fallback;
  return assertEnum(value, allowedValues, fieldName);
}

function assertBoolean(value, fieldName) {
  if (typeof value !== "boolean") throw new Error(`${fieldName} must be a boolean`);
  return value;
}

function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value;
}

function assertPlainObjectOrEmpty(value, fieldName) {
  if (value == null) return {};
  return { ...assertObject(value, fieldName) };
}

function assertIsoTimestamp(value, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!isIsoTimestamp(normalized)) throw new Error(`${fieldName} must be an ISO timestamp`);
  return normalized;
}

function assertAllowedKeys(raw, fieldName, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${fieldName}.${key} is not allowed`);
  }
}

function assertStringArray(value, fieldName, { defaultValue = [] } = {}) {
  if (value == null) return defaultValue;
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => assertNonEmptyString(item, `${fieldName}[${index}]`));
}

export function assertMachineBoardObjectKind(value, fieldName = "kind") {
  return assertEnum(value, MACHINE_BOARD_OBJECT_KINDS, fieldName);
}

export function assertMachineBoardProtectedMetadata(value, fieldName = "protected") {
  if (value == null) {
    return {
      enabled: false,
      reason: null,
      required_approval: null,
      mutation_policy: null
    };
  }
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["enabled", "reason", "required_approval", "mutation_policy"]);
  const enabled = assertBoolean(raw.enabled ?? false, `${fieldName}.enabled`);
  if (!enabled) {
    return {
      enabled: false,
      reason: raw.reason == null ? null : assertEnum(raw.reason, MACHINE_BOARD_PROTECTED_REASONS, `${fieldName}.reason`),
      required_approval: raw.required_approval == null ? null : assertEnum(raw.required_approval, MACHINE_BOARD_APPROVAL_POLICIES, `${fieldName}.required_approval`),
      mutation_policy: raw.mutation_policy == null ? null : assertEnum(raw.mutation_policy, MACHINE_BOARD_MUTATION_POLICIES, `${fieldName}.mutation_policy`)
    };
  }
  return {
    enabled: true,
    reason: assertEnum(raw.reason, MACHINE_BOARD_PROTECTED_REASONS, `${fieldName}.reason`),
    required_approval: assertEnum(raw.required_approval ?? "explicit_human", MACHINE_BOARD_APPROVAL_POLICIES, `${fieldName}.required_approval`),
    mutation_policy: assertEnum(raw.mutation_policy ?? "blocked_without_approval", MACHINE_BOARD_MUTATION_POLICIES, `${fieldName}.mutation_policy`)
  };
}

export function assertMachineBoardDesiredState(value, fieldName = "state.desired") {
  const raw = assertPlainObjectOrEmpty(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["phase", "power_state", "role", "protected"]);
  return {
    phase: assertOptionalEnum(raw.phase, MACHINE_BOARD_DESIRED_PHASES, `${fieldName}.phase`, "planned"),
    power_state: assertOptionalEnum(raw.power_state, MACHINE_BOARD_POWER_STATES, `${fieldName}.power_state`, null),
    role: assertOptionalString(raw.role, `${fieldName}.role`),
    protected: raw.protected == null ? null : assertBoolean(raw.protected, `${fieldName}.protected`)
  };
}

export function assertMachineBoardObservedState(value, fieldName = "state.observed") {
  const raw = assertPlainObjectOrEmpty(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["exists", "power_state", "last_seen_at", "source"]);
  return {
    exists: raw.exists == null ? null : assertBoolean(raw.exists, `${fieldName}.exists`),
    power_state: assertOptionalEnum(raw.power_state, MACHINE_BOARD_POWER_STATES, `${fieldName}.power_state`, null),
    last_seen_at: raw.last_seen_at == null ? null : assertIsoTimestamp(raw.last_seen_at, `${fieldName}.last_seen_at`),
    source: assertOptionalEnum(raw.source, MACHINE_BOARD_OBSERVED_SOURCES, `${fieldName}.source`, "unknown")
  };
}

export function assertMachineBoardState(value, fieldName = "state") {
  const raw = assertPlainObjectOrEmpty(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["desired", "observed"]);
  return {
    desired: assertMachineBoardDesiredState(raw.desired ?? {}, `${fieldName}.desired`),
    observed: assertMachineBoardObservedState(raw.observed ?? {}, `${fieldName}.observed`)
  };
}

export function assertMachineBoardObject(value, fieldName = "machine_object") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["schema", "object_ref", "kind", "title", "role", "protected", "state", "metadata"]);
  return {
    schema: assertEnum(raw.schema ?? PARLEY_MACHINE_BOARD_V0_SCHEMA_ID, [PARLEY_MACHINE_BOARD_V0_SCHEMA_ID], `${fieldName}.schema`),
    object_ref: assertNonEmptyString(raw.object_ref, `${fieldName}.object_ref`),
    kind: assertMachineBoardObjectKind(raw.kind, `${fieldName}.kind`),
    title: assertOptionalString(raw.title, `${fieldName}.title`),
    role: assertOptionalString(raw.role, `${fieldName}.role`),
    protected: assertMachineBoardProtectedMetadata(raw.protected, `${fieldName}.protected`),
    state: assertMachineBoardState(raw.state ?? {}, `${fieldName}.state`),
    metadata: assertPlainObjectOrEmpty(raw.metadata, `${fieldName}.metadata`)
  };
}

export function assertMachineBoardDefinition(value, fieldName = "machine_board") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["schema", "board", "object_kinds", "protected_reasons", "objects"]);
  const board = assertObject(raw.board, `${fieldName}.board`);
  assertAllowedKeys(board, `${fieldName}.board`, ["id", "domain_type", "protocol", "purpose"]);
  return {
    schema: assertEnum(raw.schema ?? PARLEY_MACHINE_BOARD_V0_SCHEMA_ID, [PARLEY_MACHINE_BOARD_V0_SCHEMA_ID], `${fieldName}.schema`),
    board: {
      id: assertNonEmptyString(board.id, `${fieldName}.board.id`),
      domain_type: assertEnum(board.domain_type ?? PARLEY_MACHINE_BOARD_V0_DOMAIN_TYPE, [PARLEY_MACHINE_BOARD_V0_DOMAIN_TYPE], `${fieldName}.board.domain_type`),
      protocol: assertEnum(board.protocol ?? PARLEY_MACHINE_BOARD_V0_SCHEMA_ID, [PARLEY_MACHINE_BOARD_V0_SCHEMA_ID], `${fieldName}.board.protocol`),
      purpose: assertOptionalString(board.purpose, `${fieldName}.board.purpose`)
    },
    object_kinds: raw.object_kinds == null
      ? [...MACHINE_BOARD_OBJECT_KINDS]
      : assertStringArray(raw.object_kinds, `${fieldName}.object_kinds`).map((kind, index) => assertMachineBoardObjectKind(kind, `${fieldName}.object_kinds[${index}]`)),
    protected_reasons: raw.protected_reasons == null
      ? [...MACHINE_BOARD_PROTECTED_REASONS]
      : assertStringArray(raw.protected_reasons, `${fieldName}.protected_reasons`).map((reason, index) => assertEnum(reason, MACHINE_BOARD_PROTECTED_REASONS, `${fieldName}.protected_reasons[${index}]`)),
    objects: Array.isArray(raw.objects) ? raw.objects.map((object, index) => assertMachineBoardObject(object, `${fieldName}.objects[${index}]`)) : []
  };
}

export function createMachineBoardEffectId({ board_id, effect_kind, idempotency_key }) {
  const boardId = assertNonEmptyString(board_id, "board_id");
  const effectKind = assertEnum(effect_kind, MACHINE_BOARD_DOMAIN_EFFECT_KINDS, "effect_kind");
  const key = assertNonEmptyString(idempotency_key, "idempotency_key");
  const digest = createHash("sha256").update(`${boardId}\u0000${effectKind}\u0000${key}`).digest("hex").slice(0, 32);
  return `effect_machine_board_${digest}`;
}

export function assertMachineBoardEffectIntent(value, fieldName = "machine_board_effect") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, [
    "schema",
    "board_id",
    "effect_kind",
    "idempotency_key",
    "effect_id",
    "target_object_ref",
    "mutation_requested",
    "approval_ref",
    "evidence_ref",
    "payload"
  ]);
  const effect = {
    schema: assertEnum(raw.schema ?? PARLEY_MACHINE_BOARD_V0_SCHEMA_ID, [PARLEY_MACHINE_BOARD_V0_SCHEMA_ID], `${fieldName}.schema`),
    board_id: assertNonEmptyString(raw.board_id, `${fieldName}.board_id`),
    effect_kind: assertEnum(raw.effect_kind, MACHINE_BOARD_DOMAIN_EFFECT_KINDS, `${fieldName}.effect_kind`),
    idempotency_key: assertNonEmptyString(raw.idempotency_key, `${fieldName}.idempotency_key`),
    target_object_ref: assertOptionalString(raw.target_object_ref, `${fieldName}.target_object_ref`),
    mutation_requested: raw.mutation_requested == null ? false : assertBoolean(raw.mutation_requested, `${fieldName}.mutation_requested`),
    approval_ref: assertOptionalString(raw.approval_ref, `${fieldName}.approval_ref`),
    evidence_ref: assertOptionalString(raw.evidence_ref, `${fieldName}.evidence_ref`),
    payload: assertPlainObjectOrEmpty(raw.payload, `${fieldName}.payload`)
  };
  effect.effect_id = createMachineBoardEffectId(effect);
  if (raw.effect_id != null && raw.effect_id !== effect.effect_id) {
    throw new Error(`${fieldName}.effect_id must equal deterministic machine-board effect id ${effect.effect_id}`);
  }
  if (effect.mutation_requested && !effect.approval_ref) {
    throw new Error(`${fieldName}.approval_ref required when mutation_requested is true`);
  }
  return effect;
}

export function evaluateMachineBoardExecutionGate(value, fieldName = "execution_gate") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["mode", "protected", "approval_state", "approval_ref", "mutation_requested"]);
  const mode = assertEnum(raw.mode ?? "observe_only", MACHINE_BOARD_EXECUTION_MODES, `${fieldName}.mode`);
  const protectedChange = raw.protected == null ? false : assertBoolean(raw.protected, `${fieldName}.protected`);
  const mutationRequested = raw.mutation_requested == null ? mode === "mutating" : assertBoolean(raw.mutation_requested, `${fieldName}.mutation_requested`);
  const approvalState = assertEnum(
    raw.approval_state ?? (protectedChange || mutationRequested ? "required" : "not_required"),
    MACHINE_BOARD_APPROVAL_STATES,
    `${fieldName}.approval_state`
  );
  const approvalRef = assertOptionalString(raw.approval_ref, `${fieldName}.approval_ref`);

  if (mode === "observe_only") {
    return {
      mode,
      protected: protectedChange,
      mutation_requested: false,
      approval_state: approvalState,
      approval_ref: approvalRef,
      executable: true,
      reason: "observe_only operations do not mutate infrastructure"
    };
  }

  if (mode === "dry_run" && !mutationRequested) {
    return {
      mode,
      protected: protectedChange,
      mutation_requested: false,
      approval_state: approvalState,
      approval_ref: approvalRef,
      executable: true,
      reason: "dry_run without mutation is executable as analysis only"
    };
  }

  if (protectedChange || mutationRequested || mode === "mutating") {
    const approved = approvalState === "approved" && Boolean(approvalRef);
    return {
      mode,
      protected: protectedChange,
      mutation_requested: mutationRequested || mode === "mutating",
      approval_state: approvalState,
      approval_ref: approvalRef,
      executable: approved,
      reason: approved ? "explicit approval evidence is present" : "explicit approval evidence required before mutation or protected change"
    };
  }

  return {
    mode,
    protected: protectedChange,
    mutation_requested: mutationRequested,
    approval_state: approvalState,
    approval_ref: approvalRef,
    executable: approvalState !== "rejected",
    reason: approvalState === "rejected" ? "approval was rejected" : "no protected mutation gate applies"
  };
}

export function assertMachineBoardInventoryObservation(value, fieldName = "inventory_observation") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["schema", "board_id", "observed_at", "source", "observations", "export_ref"]);
  const observations = Array.isArray(raw.observations) ? raw.observations : null;
  if (!observations) throw new Error(`${fieldName}.observations must be an array`);
  return {
    schema: assertEnum(raw.schema ?? PARLEY_MACHINE_BOARD_V0_SCHEMA_ID, [PARLEY_MACHINE_BOARD_V0_SCHEMA_ID], `${fieldName}.schema`),
    board_id: assertNonEmptyString(raw.board_id, `${fieldName}.board_id`),
    observed_at: assertIsoTimestamp(raw.observed_at, `${fieldName}.observed_at`),
    source: assertEnum(raw.source ?? "proxmox_inventory", MACHINE_BOARD_OBSERVED_SOURCES, `${fieldName}.source`),
    observations: observations.map((observation, index) => {
      const item = assertObject(observation, `${fieldName}.observations[${index}]`);
      assertAllowedKeys(item, `${fieldName}.observations[${index}]`, ["object_ref", "kind", "exists", "power_state", "raw_ref"]);
      return {
        object_ref: assertNonEmptyString(item.object_ref, `${fieldName}.observations[${index}].object_ref`),
        kind: assertMachineBoardObjectKind(item.kind, `${fieldName}.observations[${index}].kind`),
        exists: item.exists == null ? null : assertBoolean(item.exists, `${fieldName}.observations[${index}].exists`),
        power_state: assertOptionalEnum(item.power_state, MACHINE_BOARD_POWER_STATES, `${fieldName}.observations[${index}].power_state`, null),
        raw_ref: assertOptionalString(item.raw_ref, `${fieldName}.observations[${index}].raw_ref`)
      };
    }),
    export_ref: assertOptionalString(raw.export_ref, `${fieldName}.export_ref`)
  };
}
