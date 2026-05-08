import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PROXMOX_CLUSTER_RESOURCES_PATH,
  PROXMOX_READ_ONLY_INVENTORY_ADAPTER_ID,
  createProxmoxInventorySnapshotFromClusterResources,
  createProxmoxReadOnlyInventoryAdapter,
  createProxmoxReadOnlyInventoryRequest
} from "../src/adapters/proxmox/index.js";
import { assertNodeManifest } from "../src/schemas/index.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("Proxmox read-only adapter exposes a GET-only inventory request boundary", () => {
  assert.deepEqual(createProxmoxReadOnlyInventoryRequest(), {
    method: "GET",
    path: PROXMOX_CLUSTER_RESOURCES_PATH,
    query: {},
    read_only: true
  });
});

test("Proxmox cluster resources response normalizes into a secret-free inventory snapshot", async () => {
  const response = await readJson("../examples/machine-board/node-main/proxmox-cluster-resources.example.json");
  const snapshot = createProxmoxInventorySnapshotFromClusterResources({
    response,
    observed_at: "2026-05-08T23:15:00.000Z",
    export_ref: "examples/machine-board/node-main/proxmox-cluster-resources.example.json"
  });

  assert.equal(snapshot.source, "proxmox_inventory");
  assert.equal(snapshot.resources.length, 3);
  assert.deepEqual(snapshot.resources.map((item) => item.type), ["node", "qemu", "lxc"]);
  assert.deepEqual(snapshot.resources.map((item) => item.status), ["online", "running", "stopped"]);
});

test("Proxmox read-only adapter creates generic machine-board observations without mutation", async () => {
  const manifest = assertNodeManifest(await readJson("../examples/machine-board/node-main/node-manifest.example.json"));
  const response = await readJson("../examples/machine-board/node-main/proxmox-cluster-resources.example.json");
  const requests = [];
  const adapter = createProxmoxReadOnlyInventoryAdapter({
    requestJson: async (request) => {
      requests.push(request);
      return response;
    }
  });

  const result = await adapter.createInventoryObservation({
    manifest,
    observed_at: "2026-05-08T23:15:00.000Z",
    export_ref: "proxmox://node-main/api2/json/cluster/resources"
  });

  assert.equal(adapter.adapter_id, PROXMOX_READ_ONLY_INVENTORY_ADAPTER_ID);
  assert.equal(adapter.mutation_supported, false);
  assert.deepEqual(requests, [createProxmoxReadOnlyInventoryRequest()]);
  assert.equal(result.execution_gate.executable, true);
  assert.equal(result.execution_gate.mutation_requested, false);
  assert.deepEqual(result.observation.observations.map((item) => item.kind), [
    "machine.node",
    "compute.instance",
    "container.instance"
  ]);
  assert.deepEqual(result.observation.observations.map((item) => item.provider.resource_type), ["node", "qemu", "lxc"]);
  assert.deepEqual(result.observation.observations.map((item) => item.power_state), ["running", "running", "stopped"]);
  assert.ok(result.effect_intents.every((intent) => intent.mutation_requested === false));
});

test("Proxmox read-only adapter rejects secret-bearing configuration", () => {
  assert.throws(() => createProxmoxReadOnlyInventoryAdapter({
    requestJson: async () => ({ data: [] }),
    token: "do-not-store"
  }), /token is forbidden/);

  assert.throws(() => createProxmoxReadOnlyInventoryAdapter({
    requestJson: async () => ({ data: [] }),
    auth: { password: "do-not-store" }
  }), /password is forbidden/);
});
