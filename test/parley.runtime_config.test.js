import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { registerParleyTools } from "../src/adapters/openclaw/index.js";
import { createParleyBoardConfig } from "../src/adapters/openclaw/config.js";
import { doctorParleyBoardConfig } from "../src/core/config_doctor.js";
import {
  resolveParleyRuntimeConfig,
  resolveParleyPaths,
  resolveParleyBoardRegistry,
  PARLEY_RUNTIME_MODES
} from "../src/core/config.js";
import { ensureParleyRuntimeLayout } from "../src/core/storage/store.js";
import { ensureParleyBoardLayout } from "../src/core/storage/board_store.js";

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function withTempRoot(callback) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-runtime-config-test-"));
  try {
    await callback(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test("runtime mode enum includes standalone/service/client/test", () => {
  assert.deepEqual(PARLEY_RUNTIME_MODES, ["standalone", "service", "client", "test"]);
});

test("new Parley board config includes protected plain human member", async () => {
  await withTempRoot(async (tempRoot) => {
    const board = createParleyBoardConfig({ parleyRoot: path.join(tempRoot, "parley") }, { repoRoot: path.join(tempRoot, "repo") });
    const human = board.members.find((member) => member.board_agent_id === "human");

    assert.ok(human);
    assert.equal(human.agent_id, "human");
    assert.equal(human.kind, "human");
    assert.deepEqual(human.roles, ["human"]);
    assert.deepEqual(human.runtime_refs, []);
    assert.equal(human.permissions.protected, true);
  });
});

test("board registry normalization appends protected human member to configured boards", async () => {
  await withTempRoot(async (tempRoot) => {
    const registry = resolveParleyBoardRegistry({
      parleyDefaultBoards: {
        project: {
          board_id: "project",
          display_name: "Project",
          status: "active",
          board_root: path.join(tempRoot, "boards", "project"),
          managed_artifact_root: path.join(tempRoot, "boards", "project", "artifacts"),
          artifact_namespaces: [{
            id: "project_plans",
            roles: ["plan_landing", "reference"],
            default_for: ["plan_landing"],
            uri_prefix: "repo://plans/",
            resolved_root: path.join(tempRoot, "repo", "plans"),
            allowed_subpaths: []
          }],
          members: [{
            agent_id: "project-agent",
            board_agent_id: "project-agent",
            display_name: "Project Agent",
            kind: "agent",
            runtime_refs: [{ scheme: "openclaw", type: "agent", id: "project-agent" }],
            roles: ["implementation"],
            permissions: { preset: "board_admin" }
          }]
        }
      }
    });

    const board = registry.boards.project;
    const human = board.agent_registry.find((member) => member.board_agent_id === "human");
    assert.ok(human);
    assert.equal(human.global_agent_id, "human");
    assert.equal(human.kind, "human");
    assert.equal(human.permissions.protected, true);
    assert.equal(registry.agents.human.memberships.project.board_agent_id, "human");
  });
});

test("config doctor inspection does not mutate missing member arrays", async () => {
  const config = {
    parleyDefaultBoards: {
      project: {
        board_id: "project",
        board_root: "/tmp/project"
      }
    }
  };

  const inspect = doctorParleyBoardConfig(config, { boardId: "project" });
  assert.equal(inspect.ok, false);
  assert.equal(inspect.summary.missing, 1);
  assert.equal(Object.hasOwn(config.parleyDefaultBoards.project, "members"), false);

  const repair = doctorParleyBoardConfig(config, { boardId: "project", repair: true });
  assert.equal(repair.ok, true);
  assert.equal(config.parleyDefaultBoards.project.members[0].board_agent_id, "human");
});

test("explicit standalone mode resolves intentional local state", async () => {
  await withTempRoot(async (tempRoot) => {
    const stateRoot = path.join(tempRoot, "state-root");
    const config = resolveParleyRuntimeConfig({
      surface: "cli",
      env: {},
      pluginConfig: {
        parleyMode: "standalone",
        parleyStateRoot: stateRoot
      }
    });

    assert.equal(config.mode, "standalone");
    assert.equal(config.localStateAllowed, true);
    assert.equal(config.stateRoot, stateRoot);
    assert.equal(config.runtimeRoot, path.join(stateRoot, "runtime"));
    assert.deepEqual(config.warnings, []);
  });
});

test("direct CLI may default to standalone and reports implicit state root", () => {
  const config = resolveParleyRuntimeConfig({ surface: "cli", env: {}, pluginConfig: {} });

  assert.equal(config.mode, "standalone");
  assert.equal(config.modeSource, "cli_default_standalone");
  assert.equal(config.implicitStateRoot, true);
  assert.match(config.warnings.join("\n"), /implicit PARLEY_STATE_ROOT/);
});

test("OpenClaw adapter mode must be explicit", () => {
  assert.throws(
    () => resolveParleyRuntimeConfig({ surface: "openclaw-adapter", env: {}, pluginConfig: {} }),
    (error) => error?.code === "PARLEY_MODE_REQUIRED"
  );
});

test("unset OpenClaw adapter registration fails before creating local runtime state", async () => {
  await withTempRoot(async (tempRoot) => {
    const runtimeRoot = path.join(tempRoot, "runtime-should-not-exist");
    const api = {
      env: {},
      pluginConfig: { parleyRuntimeRoot: runtimeRoot },
      registerTool() {
        throw new Error("registerTool should not be called when mode is unset");
      }
    };

    assert.throws(() => registerParleyTools(api), (error) => error?.code === "PARLEY_MODE_REQUIRED");
    assert.equal(await exists(runtimeRoot), false);
  });
});

test("client mode rejects configured local state paths before layout creation", async () => {
  await withTempRoot(async (tempRoot) => {
    const runtimeRoot = path.join(tempRoot, "client-runtime-should-not-exist");
    const pluginConfig = {
      parleyMode: "client",
      parleyApiUrl: "http://127.0.0.1:7331",
      parleyRuntimeRoot: runtimeRoot
    };

    assert.throws(
      () => resolveParleyPaths(pluginConfig),
      (error) => error?.code === "PARLEY_CLIENT_LOCAL_STATE_FORBIDDEN"
    );
    await assert.rejects(
      () => ensureParleyRuntimeLayout(pluginConfig),
      (error) => error?.code === "PARLEY_CLIENT_LOCAL_STATE_FORBIDDEN"
    );
    assert.equal(await exists(runtimeRoot), false);
  });
});


test("client mode accepts projection mirror root without enabling local state", async () => {
  await withTempRoot(async (tempRoot) => {
    const mirrorRoot = path.join(tempRoot, "projection-mirror");
    const config = resolveParleyRuntimeConfig({
      surface: "openclaw-adapter",
      env: {},
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://127.0.0.1:7331",
        parleyProjectionMirrorRoot: mirrorRoot
      }
    });

    assert.equal(config.mode, "client");
    assert.equal(config.localStateAllowed, false);
    assert.equal(config.projectionMirrorRoot, mirrorRoot);
    assert.equal(await exists(mirrorRoot), false);
  });
});

test("projection mirror root must be absolute", () => {
  assert.throws(
    () => resolveParleyRuntimeConfig({
      surface: "openclaw-adapter",
      env: {},
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://127.0.0.1:7331",
        parleyProjectionMirrorRoot: "relative/mirror"
      }
    }),
    (error) => error?.code === "PARLEY_CONFIG_INVALID_PATH"
  );
});

test("client mode cannot use file runtime storage even without explicit local paths", async () => {
  const pluginConfig = {
    parleyMode: "client",
    parleyApiUrl: "http://127.0.0.1:7331"
  };

  await assert.rejects(
    () => ensureParleyRuntimeLayout(pluginConfig),
    (error) => error?.code === "PARLEY_LOCAL_STATE_FORBIDDEN"
  );
});

test("client mode blocks board layout creation before local board paths are created", async () => {
  await withTempRoot(async (tempRoot) => {
    const boardRoot = path.join(tempRoot, "board-should-not-exist");
    const board = {
      board_id: "project",
      display_name: "Project",
      status: "active",
      board_root: boardRoot,
      state_root: path.join(boardRoot, "state"),
      managed_artifact_root: path.join(boardRoot, "artifacts"),
      default_plan_landing_root: path.join(tempRoot, "plans"),
      plan_extension: ".md",
      artifact_namespaces: [],
      allowed_reference_namespaces: [],
      allowed_plan_subdirs: [],
      allowed_reference_roots: [],
      allowed_landing_roots: [],
      permission_model: { mode: "board_wide_all_tools", future_agent_scoping: true },
      agent_registry: []
    };

    await assert.rejects(
      () => ensureParleyBoardLayout({ parleyMode: "client", parleyApiUrl: "http://127.0.0.1:7331" }, board),
      (error) => error?.code === "PARLEY_LOCAL_STATE_FORBIDDEN"
    );
    assert.equal(await exists(boardRoot), false);
  });
});

test("OpenClaw adapter client registration rejects accidental local state config", async () => {
  await withTempRoot(async (tempRoot) => {
    const runtimeRoot = path.join(tempRoot, "runtime-should-not-exist");
    const api = {
      env: {},
      pluginConfig: {
        parleyMode: "client",
        parleyApiUrl: "http://127.0.0.1:7331",
        parleyRuntimeRoot: runtimeRoot
      },
      registerTool() {
        throw new Error("registerTool should not be called when client mode has local state config");
      }
    };

    assert.throws(() => registerParleyTools(api), (error) => error?.code === "PARLEY_CLIENT_LOCAL_STATE_FORBIDDEN");
    assert.equal(await exists(runtimeRoot), false);
  });
});

test("service mode requires explicit DB path outside the repo", () => {
  assert.throws(
    () => resolveParleyRuntimeConfig({ surface: "service", env: {}, pluginConfig: { parleyMode: "service" } }),
    (error) => error?.code === "PARLEY_DB_PATH_REQUIRED"
  );

  assert.throws(
    () => resolveParleyRuntimeConfig({
      surface: "service",
      env: {},
      pluginConfig: {
        parleyMode: "service",
        repoRoot: "/srv/workspaces/Parley",
        parleyDbPath: "/srv/workspaces/Parley/parley.db"
      }
    }),
    (error) => error?.code === "PARLEY_SERVICE_DB_PATH_FORBIDDEN"
  );
});

test("test mode requires explicit temp/test storage root", () => {
  assert.throws(
    () => resolveParleyRuntimeConfig({ surface: "test", env: {}, pluginConfig: { parleyMode: "test" } }),
    (error) => error?.code === "PARLEY_TEST_ROOT_REQUIRED"
  );

  const config = resolveParleyRuntimeConfig({
    surface: "test",
    env: {},
    pluginConfig: { parleyMode: "test", parleyTestRoot: "/tmp/parley-test-root" }
  });
  assert.equal(config.mode, "test");
  assert.equal(config.runtimeRoot, "/tmp/parley-test-root/runtime");
});
