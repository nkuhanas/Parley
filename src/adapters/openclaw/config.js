import os from "node:os";
import path from "node:path";

const DEFAULT_PARLEY_ROOT = path.join(os.homedir(), ".local", "share", "parley");
const DEFAULT_PARLEY_REPO_ROOT = path.join(os.homedir(), "workspace", "Parley");

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function ensureAbsolutePath(value, fieldName) {
  const expanded = expandHome(value);
  if (!path.isAbsolute(expanded)) {
    throw new Error(`${fieldName} must be an absolute path`);
  }
  return path.normalize(expanded);
}

export function createParleyBoardConfig(pluginConfig = {}, options = {}) {
  const repoRoot = ensureAbsolutePath(
    nonEmptyString(options.repoRoot) ?? nonEmptyString(pluginConfig.parleyRepoRoot) ?? DEFAULT_PARLEY_REPO_ROOT,
    "parleyRepoRoot"
  );
  const parleyRoot = ensureAbsolutePath(nonEmptyString(pluginConfig.parleyRoot) ?? DEFAULT_PARLEY_ROOT, "parleyRoot");
  const boardRoot = ensureAbsolutePath(
    nonEmptyString(pluginConfig.parleyParleyBoardRoot) ?? path.join(parleyRoot, "boards", "parley"),
    "parleyParleyBoardRoot"
  );
  const agentId = nonEmptyString(options.agentId) ?? nonEmptyString(pluginConfig.parleyDefaultAgentId) ?? "parley-agent";
  const agentDisplayName = nonEmptyString(options.agentDisplayName) ?? nonEmptyString(pluginConfig.parleyDefaultAgentDisplayName) ?? "Parley Agent";

  return {
    board_id: "parley",
    display_name: "Parley",
    status: "active",
    board_root: boardRoot,
    state_root: ensureAbsolutePath(
      nonEmptyString(pluginConfig.parleyParleyStateRoot) ?? path.join(boardRoot, "state"),
      "parleyParleyStateRoot"
    ),
    managed_artifact_root: ensureAbsolutePath(
      nonEmptyString(pluginConfig.parleyParleyManagedArtifactRoot) ?? path.join(boardRoot, "artifacts"),
      "parleyParleyManagedArtifactRoot"
    ),
    plan_extension: nonEmptyString(pluginConfig.parleyParleyPlanExtension) ?? ".md",
    artifact_namespaces: [
      {
        id: "parley_plans",
        roles: ["plan_landing", "explicit_landing", "reference"],
        default_for: ["plan_landing"],
        uri_prefix: "repo://plans/",
        resolved_root: path.join(repoRoot, "plans"),
        allowed_subpaths: []
      },
      {
        id: "parley_docs",
        roles: ["explicit_landing", "reference"],
        default_for: [],
        uri_prefix: "repo://docs/",
        resolved_root: path.join(repoRoot, "docs"),
        allowed_subpaths: []
      },
      {
        id: "parley_src",
        roles: ["reference"],
        default_for: [],
        uri_prefix: "repo://src/",
        resolved_root: path.join(repoRoot, "src"),
        allowed_subpaths: []
      }
    ],
    allowed_reference_namespaces: ["parley_plans", "parley_docs", "parley_src"],
    permission_model: {
      mode: "board_wide_all_tools",
      future_agent_scoping: true
    },
    members: [
      {
        agent_id: agentId,
        board_agent_id: agentId,
        display_name: agentDisplayName,
        kind: "agent",
        roles: ["maintainer", "implementation"],
        permissions: { preset: "board_admin" }
      }
    ]
  };
}
