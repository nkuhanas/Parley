import { isIsoTimestamp } from "../core/time.js";
import {
  MACHINE_BOARD_DESIRED_PHASES,
  MACHINE_BOARD_OBJECT_KINDS,
  MACHINE_BOARD_POWER_STATES,
  assertMachineBoardProtectedMetadata,
  assertMachineBoardProviderMetadata
} from "./machine_board_v0.js";

export const PARLEY_NODE_MANIFEST_V0_SCHEMA_ID = "parley.node-manifest.v0";

export const NODE_MANIFEST_PHASES = Object.freeze(["pre_node_schema", "installed", "bootstrapped", "managed", "stable", "retired"]);
export const NODE_MANIFEST_PARTITION_KINDS = Object.freeze(["host", "compute", "container", "service", "storage", "other"]);
export const NODE_MANIFEST_OBSERVED_STATES = Object.freeze(["unknown", "missing", "present", "running", "stopped", "degraded"]);
export const NODE_MANIFEST_CREDENTIAL_DEFAULT_STATES = Object.freeze(["present", "absent", "absent_or_revoked", "revoked", "expired", "manual_only", "unknown"]);

export const PARLEY_NODE_MANIFEST_V0_SCHEMA = Object.freeze({
  schema_id: PARLEY_NODE_MANIFEST_V0_SCHEMA_ID,
  canonical_location: "src/schemas/node_manifest_v0.js",
  purpose: "Exportable, secret-free manifest for reconstructing and auditing a machine-scoped Parley node board.",
  required_top_level: Object.freeze(["schema", "node", "partitions", "credentials", "recovery", "exports"]),
  secret_policy: "Credential entries are identity-only. Secret values, token material, passwords, private keys, and credential values are invalid."
});

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "secret",
  "secret_value",
  "token",
  "token_value",
  "password",
  "private_key",
  "key_material",
  "value"
]);

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

function assertStringMap(value, fieldName, mapper) {
  const raw = assertPlainObjectOrEmpty(value, fieldName);
  return Object.fromEntries(Object.entries(raw).map(([key, item]) => [assertNonEmptyString(key, `${fieldName} key`), mapper(item, `${fieldName}.${key}`)]));
}

function assertNoCredentialSecrets(value, fieldName) {
  if (value == null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialSecrets(item, `${fieldName}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key)) throw new Error(`${fieldName}.${key} is forbidden; credentials must be identity-only`);
    assertNoCredentialSecrets(child, `${fieldName}.${key}`);
  }
}

function assertNode(value, fieldName = "node") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["name", "board_id", "phase", "updated_at"]);
  return {
    name: assertNonEmptyString(raw.name, `${fieldName}.name`),
    board_id: assertNonEmptyString(raw.board_id, `${fieldName}.board_id`),
    phase: assertEnum(raw.phase ?? "pre_node_schema", NODE_MANIFEST_PHASES, `${fieldName}.phase`),
    updated_at: raw.updated_at == null ? null : assertIsoTimestamp(raw.updated_at, `${fieldName}.updated_at`)
  };
}

function assertHardware(value, fieldName = "hardware") {
  return assertPlainObjectOrEmpty(value, fieldName);
}

function assertStorage(value, fieldName = "storage") {
  return assertPlainObjectOrEmpty(value, fieldName);
}

function defaultMachineObjectKindForPartition(kind) {
  if (kind === "host") return "machine.node";
  if (kind === "compute") return "compute.instance";
  if (kind === "container") return "container.instance";
  if (kind === "service") return "service.endpoint";
  if (kind === "storage") return "storage.pool";
  return null;
}

export function assertNodeManifestPartition(value, fieldName = "partition") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, [
    "kind",
    "role",
    "protected",
    "phase",
    "address",
    "provider",
    "object_kind",
    "desired_state",
    "observed_state",
    "power_state",
    "notes"
  ]);
  const kind = assertEnum(raw.kind, NODE_MANIFEST_PARTITION_KINDS, `${fieldName}.kind`);
  const objectKind = raw.object_kind == null
    ? defaultMachineObjectKindForPartition(kind)
    : assertEnum(raw.object_kind, MACHINE_BOARD_OBJECT_KINDS, `${fieldName}.object_kind`);
  return {
    kind,
    role: assertOptionalString(raw.role, `${fieldName}.role`),
    protected: raw.protected == null
      ? null
      : typeof raw.protected === "boolean"
        ? raw.protected
        : assertMachineBoardProtectedMetadata(raw.protected, `${fieldName}.protected`),
    phase: assertOptionalEnum(raw.phase, MACHINE_BOARD_DESIRED_PHASES, `${fieldName}.phase`, null),
    address: assertOptionalString(raw.address, `${fieldName}.address`),
    provider: assertMachineBoardProviderMetadata(raw.provider, `${fieldName}.provider`),
    object_kind: objectKind,
    desired_state: assertOptionalEnum(raw.desired_state, MACHINE_BOARD_DESIRED_PHASES, `${fieldName}.desired_state`, null),
    observed_state: assertOptionalEnum(raw.observed_state, NODE_MANIFEST_OBSERVED_STATES, `${fieldName}.observed_state`, "unknown"),
    power_state: assertOptionalEnum(raw.power_state, MACHINE_BOARD_POWER_STATES, `${fieldName}.power_state`, null),
    notes: assertOptionalString(raw.notes, `${fieldName}.notes`)
  };
}

export function assertNodeManifestCredentialIdentity(value, fieldName = "credential") {
  assertNoCredentialSecrets(value, fieldName);
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["identity_only", "secret_stored", "intended_holder", "owner", "scope_description", "default_state", "notes"]);
  const identityOnly = assertBoolean(raw.identity_only ?? true, `${fieldName}.identity_only`);
  const secretStored = assertBoolean(raw.secret_stored ?? false, `${fieldName}.secret_stored`);
  if (identityOnly !== true) throw new Error(`${fieldName}.identity_only must be true`);
  if (secretStored !== false) throw new Error(`${fieldName}.secret_stored must be false`);
  return {
    identity_only: true,
    secret_stored: false,
    intended_holder: assertOptionalString(raw.intended_holder, `${fieldName}.intended_holder`),
    owner: assertOptionalString(raw.owner, `${fieldName}.owner`),
    scope_description: assertOptionalString(raw.scope_description, `${fieldName}.scope_description`),
    default_state: assertOptionalEnum(raw.default_state, NODE_MANIFEST_CREDENTIAL_DEFAULT_STATES, `${fieldName}.default_state`, "unknown"),
    notes: assertOptionalString(raw.notes, `${fieldName}.notes`)
  };
}

function assertRecovery(value, fieldName = "recovery") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["break_glass_doc", "token_revocation_doc", "parley_restore_doc", "backup_restore_doc", "node_manifest_path"]);
  return {
    break_glass_doc: assertOptionalString(raw.break_glass_doc, `${fieldName}.break_glass_doc`),
    token_revocation_doc: assertOptionalString(raw.token_revocation_doc, `${fieldName}.token_revocation_doc`),
    parley_restore_doc: assertOptionalString(raw.parley_restore_doc, `${fieldName}.parley_restore_doc`),
    backup_restore_doc: assertOptionalString(raw.backup_restore_doc, `${fieldName}.backup_restore_doc`),
    node_manifest_path: assertOptionalString(raw.node_manifest_path, `${fieldName}.node_manifest_path`)
  };
}

function assertExports(value, fieldName = "exports") {
  const raw = assertPlainObjectOrEmpty(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["last_board_export", "last_manifest_export", "off_node_target"]);
  return {
    last_board_export: assertOptionalString(raw.last_board_export, `${fieldName}.last_board_export`),
    last_manifest_export: assertOptionalString(raw.last_manifest_export, `${fieldName}.last_manifest_export`),
    off_node_target: assertOptionalString(raw.off_node_target, `${fieldName}.off_node_target`)
  };
}

export function assertNodeManifest(value, fieldName = "node_manifest") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["schema", "node", "hardware", "storage", "partitions", "credentials", "recovery", "exports"]);
  return {
    schema: assertEnum(raw.schema ?? PARLEY_NODE_MANIFEST_V0_SCHEMA_ID, [PARLEY_NODE_MANIFEST_V0_SCHEMA_ID], `${fieldName}.schema`),
    node: assertNode(raw.node, `${fieldName}.node`),
    hardware: assertHardware(raw.hardware, `${fieldName}.hardware`),
    storage: assertStorage(raw.storage, `${fieldName}.storage`),
    partitions: assertStringMap(raw.partitions, `${fieldName}.partitions`, assertNodeManifestPartition),
    credentials: assertStringMap(raw.credentials, `${fieldName}.credentials`, assertNodeManifestCredentialIdentity),
    recovery: assertRecovery(raw.recovery, `${fieldName}.recovery`),
    exports: assertExports(raw.exports, `${fieldName}.exports`)
  };
}
