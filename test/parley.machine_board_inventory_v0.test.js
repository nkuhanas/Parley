import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertNodeManifest,
  assertProxmoxInventorySnapshot,
  createMachineBoardEffectId,
  createMachineBoardInventoryObservationFromProxmox
} from "../src/schemas/index.js";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

test("node-main example manifest validates against parley.node-manifest.v0", async () => {
  const manifest = assertNodeManifest(await readJson("../examples/machine-board/node-main/node-manifest.example.json"));

  assert.equal(manifest.node.name, "node-main");
  assert.equal(manifest.node.board_id, "node-main");
  assert.equal(manifest.credentials.proxmox_api_token_identity.identity_only, true);
  assert.equal(manifest.credentials.proxmox_api_token_identity.secret_stored, false);
  assert.equal(manifest.partitions.admin_vm.object_kind, "proxmox.vm");
  assert.equal(manifest.partitions.parley_runtime.object_kind, "proxmox.lxc");
});

test("node-main inventory fixture validates as a Proxmox inventory snapshot", async () => {
  const inventory = assertProxmoxInventorySnapshot(await readJson("../examples/machine-board/node-main/proxmox-inventory.example.json"));

  assert.equal(inventory.source, "proxmox_inventory");
  assert.equal(inventory.resources.length, 3);
  assert.equal(inventory.resources[1].type, "qemu");
});

test("inventory importer produces observe-only inventory_observed effect intents", async () => {
  const manifest = await readJson("../examples/machine-board/node-main/node-manifest.example.json");
  const inventory = await readJson("../examples/machine-board/node-main/proxmox-inventory.example.json");

  const result = createMachineBoardInventoryObservationFromProxmox({ manifest, inventory });

  assert.equal(result.execution_gate.executable, true);
  assert.equal(result.execution_gate.mutation_requested, false);
  assert.equal(result.observation.board_id, "node-main");
  assert.deepEqual(result.observation.observations.map((item) => item.object_ref), [
    "node-main/node/node-main",
    "node-main/vm/100",
    "node-main/lxc/200"
  ]);
  assert.deepEqual(result.observation.observations.map((item) => item.kind), [
    "proxmox.node",
    "proxmox.vm",
    "proxmox.lxc"
  ]);
  assert.deepEqual(result.observation.observations.map((item) => item.power_state), [
    "running",
    "running",
    "stopped"
  ]);

  assert.equal(result.effect_intents.length, 3);
  assert.ok(result.effect_intents.every((intent) => intent.effect_kind === "inventory_observed"));
  assert.ok(result.effect_intents.every((intent) => intent.mutation_requested === false));
  assert.equal(result.effect_intents[1].effect_id, createMachineBoardEffectId({
    board_id: "node-main",
    effect_kind: "inventory_observed",
    idempotency_key: "proxmox_inventory:2026-05-08T22:30:00.000Z:node-main/vm/100"
  }));
});

test("inventory importer rejects unsupported resource shape instead of guessing", async () => {
  const manifest = await readJson("../examples/machine-board/node-main/node-manifest.example.json");
  const inventory = await readJson("../examples/machine-board/node-main/proxmox-inventory.example.json");

  assert.throws(() => createMachineBoardInventoryObservationFromProxmox({
    manifest,
    inventory: {
      ...inventory,
      resources: [
        ...inventory.resources,
        { type: "zfs", name: "rpool" }
      ]
    }
  }), /type must be one of/);
});
