import test from "node:test";
import assert from "node:assert/strict";

import {
  NODE_MANIFEST_CREDENTIAL_DEFAULT_STATES,
  PARLEY_NODE_MANIFEST_V0_SCHEMA,
  PARLEY_NODE_MANIFEST_V0_SCHEMA_ID,
  assertNodeManifest,
  assertNodeManifestCredentialIdentity,
  assertNodeManifestPartition
} from "../src/schemas/node_manifest_v0.js";

function validManifest(overrides = {}) {
  return {
    schema: PARLEY_NODE_MANIFEST_V0_SCHEMA_ID,
    node: {
      name: "node-main",
      board_id: "node-main",
      phase: "pre_node_schema",
      updated_at: "2026-05-08T22:00:00.000Z"
    },
    hardware: {
      cpu: "inventory-pending"
    },
    storage: {
      zfs: "inventory-pending"
    },
    partitions: {
      control: {
        kind: "compute",
        role: "control-plane",
        protected: {
          enabled: true,
          reason: "control_plane"
        },
        address: "10.0.0.10",
        provider: {
          name: "proxmox",
          resource_type: "qemu",
          native_id: "100",
          raw_ref: "proxmox/qemu/100"
        },
        observed_state: "unknown"
      }
    },
    credentials: {
      proxmox_api_token: {
        identity_only: true,
        secret_stored: false,
        intended_holder: "OpenClaw node adapter",
        owner: "human:sensei",
        scope_description: "Proxmox API token identity; secret material stored outside Parley.",
        default_state: "absent_or_revoked"
      }
    },
    recovery: {
      break_glass_doc: "docs/recovery/break-glass.md",
      token_revocation_doc: "docs/recovery/revoke-proxmox-token.md",
      parley_restore_doc: "docs/recovery/restore-parley-board.md",
      backup_restore_doc: "docs/recovery/restore-backups.md",
      node_manifest_path: "node-manifest.yaml"
    },
    exports: {
      last_board_export: null,
      last_manifest_export: null,
      off_node_target: "off-node backup target pending"
    },
    ...overrides
  };
}

test("node-manifest v0 exposes stable canonical schema metadata", () => {
  assert.equal(PARLEY_NODE_MANIFEST_V0_SCHEMA.schema_id, PARLEY_NODE_MANIFEST_V0_SCHEMA_ID);
  assert.equal(PARLEY_NODE_MANIFEST_V0_SCHEMA.canonical_location, "src/schemas/node_manifest_v0.js");
  assert.ok(PARLEY_NODE_MANIFEST_V0_SCHEMA.required_top_level.includes("credentials"));
  assert.ok(NODE_MANIFEST_CREDENTIAL_DEFAULT_STATES.includes("absent_or_revoked"));
});

test("node-manifest validates a secret-free reconstructability manifest", () => {
  const manifest = assertNodeManifest(validManifest());

  assert.equal(manifest.schema, PARLEY_NODE_MANIFEST_V0_SCHEMA_ID);
  assert.equal(manifest.node.name, "node-main");
  assert.equal(manifest.partitions.control.object_kind, "compute.instance");
  assert.equal(manifest.partitions.control.provider.name, "proxmox");
  assert.equal(manifest.partitions.control.provider.native_id, "100");
  assert.equal(manifest.partitions.control.protected.required_approval, "explicit_human");
  assert.equal(manifest.credentials.proxmox_api_token.identity_only, true);
  assert.equal(manifest.credentials.proxmox_api_token.secret_stored, false);
});

test("node-manifest rejects credential secret material", () => {
  assert.throws(() => assertNodeManifestCredentialIdentity({
    identity_only: true,
    secret_stored: false,
    token: "do-not-store"
  }), /token is forbidden/);

  assert.throws(() => assertNodeManifest({
    ...validManifest(),
    credentials: {
      proxmox_api_token: {
        identity_only: true,
        secret_stored: false,
        nested: {
          password: "do-not-store"
        }
      }
    }
  }), /password is forbidden/);
});

test("node-manifest requires credential identities to remain identity-only", () => {
  assert.throws(() => assertNodeManifestCredentialIdentity({
    identity_only: false,
    secret_stored: false
  }), /identity_only must be true/);

  assert.throws(() => assertNodeManifestCredentialIdentity({
    identity_only: true,
    secret_stored: true
  }), /secret_stored must be false/);
});

test("node-manifest partition validation infers generic machine object kinds", () => {
  assert.equal(assertNodeManifestPartition({ kind: "host" }).object_kind, "machine.node");
  assert.equal(assertNodeManifestPartition({ kind: "compute" }).object_kind, "compute.instance");
  assert.equal(assertNodeManifestPartition({ kind: "container" }).object_kind, "container.instance");
  assert.throws(() => assertNodeManifestPartition({ kind: "virtual_machine" }), /kind must be one of/);
});
