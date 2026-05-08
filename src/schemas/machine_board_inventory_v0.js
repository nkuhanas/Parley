import {
  assertMachineBoardEffectIntent,
  assertMachineBoardInventoryObservation,
  evaluateMachineBoardExecutionGate
} from "./machine_board_v0.js";
import { assertNodeManifest } from "./node_manifest_v0.js";

const PROXMOX_RESOURCE_TYPES = Object.freeze(["node", "qemu", "lxc"]);
const PROXMOX_STATUS_TO_POWER_STATE = Object.freeze({
  running: "running",
  stopped: "stopped",
  paused: "paused"
});

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} required`);
  return value.trim();
}

function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value;
}

function assertOptionalString(value, fieldName) {
  if (value == null) return null;
  return assertNonEmptyString(value, fieldName);
}

function assertAllowedKeys(raw, fieldName, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${fieldName}.${key} is not allowed`);
  }
}

function assertEnum(value, allowedValues, fieldName) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function normalizePowerState(status) {
  if (status == null) return "unknown";
  return PROXMOX_STATUS_TO_POWER_STATE[String(status).toLowerCase()] ?? "unknown";
}

function machineKindForProxmoxType(type) {
  if (type === "node") return "machine.node";
  if (type === "qemu") return "compute.instance";
  if (type === "lxc") return "container.instance";
  throw new Error(`unsupported Proxmox resource type ${type}`);
}

function objectRefForResource(boardId, resource, fieldName) {
  if (resource.type === "node") return `${boardId}/node/${assertNonEmptyString(resource.node, `${fieldName}.node`)}`;
  if (resource.type === "qemu") return `${boardId}/compute/${assertNonEmptyString(String(resource.vmid ?? ""), `${fieldName}.vmid`)}`;
  if (resource.type === "lxc") return `${boardId}/container/${assertNonEmptyString(String(resource.vmid ?? resource.ctid ?? ""), `${fieldName}.vmid`)}`;
  throw new Error(`unsupported Proxmox resource type ${resource.type}`);
}

function providerForResource(resource) {
  if (resource.type === "node") {
    return {
      name: "proxmox",
      resource_type: "node",
      native_id: resource.node,
      raw_ref: `proxmox/node/${resource.node}`
    };
  }
  if (resource.type === "qemu") {
    return {
      name: "proxmox",
      resource_type: "qemu",
      native_id: String(resource.vmid),
      raw_ref: `proxmox/qemu/${resource.vmid}`
    };
  }
  if (resource.type === "lxc") {
    const nativeId = String(resource.vmid ?? resource.ctid);
    return {
      name: "proxmox",
      resource_type: "lxc",
      native_id: nativeId,
      raw_ref: `proxmox/lxc/${nativeId}`
    };
  }
  return null;
}

export function assertProxmoxInventorySnapshot(value, fieldName = "inventory") {
  const raw = assertObject(value, fieldName);
  assertAllowedKeys(raw, fieldName, ["source", "observed_at", "resources", "export_ref"]);
  const resources = Array.isArray(raw.resources) ? raw.resources : null;
  if (!resources) throw new Error(`${fieldName}.resources must be an array`);
  return {
    source: assertEnum(raw.source ?? "proxmox_inventory", ["proxmox_inventory"], `${fieldName}.source`),
    observed_at: assertNonEmptyString(raw.observed_at, `${fieldName}.observed_at`),
    export_ref: assertOptionalString(raw.export_ref, `${fieldName}.export_ref`),
    resources: resources.map((resource, index) => {
      const item = assertObject(resource, `${fieldName}.resources[${index}]`);
      assertAllowedKeys(item, `${fieldName}.resources[${index}]`, ["type", "node", "vmid", "ctid", "name", "status", "ip"]);
      const type = assertEnum(item.type, PROXMOX_RESOURCE_TYPES, `${fieldName}.resources[${index}].type`);
      return {
        type,
        node: assertOptionalString(item.node, `${fieldName}.resources[${index}].node`),
        vmid: item.vmid ?? null,
        ctid: item.ctid ?? null,
        name: assertOptionalString(item.name, `${fieldName}.resources[${index}].name`),
        status: assertOptionalString(item.status, `${fieldName}.resources[${index}].status`),
        ip: assertOptionalString(item.ip, `${fieldName}.resources[${index}].ip`)
      };
    })
  };
}

export function createMachineBoardInventoryObservationFromProxmox({ manifest, inventory }) {
  const nodeManifest = assertNodeManifest(manifest, "manifest");
  const snapshot = assertProxmoxInventorySnapshot(inventory, "inventory");
  const boardId = nodeManifest.node.board_id;

  const observation = assertMachineBoardInventoryObservation({
    board_id: boardId,
    observed_at: snapshot.observed_at,
    source: snapshot.source,
    export_ref: snapshot.export_ref,
    observations: snapshot.resources.map((resource, index) => ({
      object_ref: objectRefForResource(boardId, resource, `inventory.resources[${index}]`),
      kind: machineKindForProxmoxType(resource.type),
      exists: true,
      power_state: normalizePowerState(resource.status),
      provider: providerForResource(resource)
    }))
  });

  const effect_intents = observation.observations.map((item) => assertMachineBoardEffectIntent({
    board_id: boardId,
    effect_kind: "inventory_observed",
    idempotency_key: `${observation.source}:${observation.observed_at}:${item.object_ref}`,
    target_object_ref: item.object_ref,
    mutation_requested: false,
    evidence_ref: observation.export_ref,
    payload: {
      observation: item,
      observed_at: observation.observed_at,
      source: observation.source
    }
  }));

  return {
    manifest: nodeManifest,
    inventory: snapshot,
    execution_gate: evaluateMachineBoardExecutionGate({ mode: "observe_only" }),
    observation,
    effect_intents
  };
}
