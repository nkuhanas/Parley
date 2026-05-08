import {
  assertProxmoxInventorySnapshot,
  createMachineBoardInventoryObservationFromProxmox
} from "../../schemas/machine_board_inventory_v0.js";

export const PROXMOX_READ_ONLY_INVENTORY_ADAPTER_ID = "proxmox.read-only-inventory.v0";
export const PROXMOX_CLUSTER_RESOURCES_PATH = "/cluster/resources";
export const PROXMOX_CLUSTER_RESOURCE_TYPES = Object.freeze(["node", "qemu", "lxc"]);

const SECRET_KEY_PATTERN = /(token|secret|password|passphrase|private[_-]?key|authorization|cookie)/i;

function assertObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  return value;
}

function assertAllowedKeys(raw, fieldName, allowedKeys) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw new Error(`${fieldName}.${key} is not allowed`);
  }
}

function assertNoSecretBearingKeys(value, fieldName) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childField = `${fieldName}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) throw new Error(`${childField} is forbidden; the read-only Proxmox adapter boundary does not accept or store secrets`);
    if (child && typeof child === "object") assertNoSecretBearingKeys(child, childField);
  }
}

function assertOptionalString(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} must be a non-empty string`);
  return value.trim();
}

function isoNow() {
  return new Date().toISOString();
}

function responseDataFromProxmoxEnvelope(value, fieldName) {
  if (Array.isArray(value)) return value;
  const raw = assertObject(value, fieldName);
  if (!Array.isArray(raw.data)) throw new Error(`${fieldName}.data must be an array`);
  return raw.data;
}

function normalizeClusterResource(resource, index) {
  const raw = assertObject(resource, `response.data[${index}]`);
  const type = typeof raw.type === "string" ? raw.type.trim() : "";
  if (!PROXMOX_CLUSTER_RESOURCE_TYPES.includes(type)) return null;

  const node = assertOptionalString(raw.node, `response.data[${index}].node`);
  const name = assertOptionalString(raw.name, `response.data[${index}].name`);
  const status = assertOptionalString(raw.status, `response.data[${index}].status`);
  const ip = assertOptionalString(raw.ip, `response.data[${index}].ip`);

  if (type === "node") {
    return {
      type,
      node: node ?? name,
      name: name ?? node,
      status,
      ip
    };
  }

  const id = typeof raw.id === "string" ? raw.id : null;
  return {
    type,
    node,
    vmid: raw.vmid ?? id?.split("/").at(-1) ?? null,
    name,
    status,
    ip
  };
}

export function createProxmoxReadOnlyInventoryRequest() {
  return Object.freeze({
    method: "GET",
    path: PROXMOX_CLUSTER_RESOURCES_PATH,
    query: Object.freeze({}),
    read_only: true
  });
}

export function createProxmoxInventorySnapshotFromClusterResources({ response, observed_at, export_ref } = {}) {
  const resources = responseDataFromProxmoxEnvelope(response, "response")
    .map((resource, index) => normalizeClusterResource(resource, index))
    .filter(Boolean);

  return assertProxmoxInventorySnapshot({
    source: "proxmox_inventory",
    observed_at: assertOptionalString(observed_at, "observed_at") ?? isoNow(),
    export_ref: assertOptionalString(export_ref, "export_ref"),
    resources
  });
}

export function createProxmoxReadOnlyInventoryAdapter(options = {}) {
  const raw = assertObject(options, "options");
  assertNoSecretBearingKeys(raw, "options");
  assertAllowedKeys(raw, "options", ["requestJson"]);
  if (typeof raw.requestJson !== "function") throw new Error("options.requestJson must be a function");

  async function collectInventorySnapshot({ observed_at, export_ref } = {}) {
    const response = await raw.requestJson(createProxmoxReadOnlyInventoryRequest());
    return createProxmoxInventorySnapshotFromClusterResources({ response, observed_at, export_ref });
  }

  async function createInventoryObservation({ manifest, observed_at, export_ref } = {}) {
    const inventory = await collectInventorySnapshot({ observed_at, export_ref });
    return createMachineBoardInventoryObservationFromProxmox({ manifest, inventory });
  }

  return Object.freeze({
    adapter_id: PROXMOX_READ_ONLY_INVENTORY_ADAPTER_ID,
    provider: "proxmox",
    mode: "read_only_inventory",
    mutation_supported: false,
    collectInventorySnapshot,
    createInventoryObservation
  });
}
