import os from "node:os";
import path from "node:path";

const DEFAULT_PARLEY_ROOT = path.join(os.homedir(), ".local", "share", "parley");

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

function normalizePathArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => ensureAbsolutePath(item, `${fieldName}[${index}]`));
}

function normalizeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => {
    const normalized = nonEmptyString(item);
    if (!normalized) throw new Error(`${fieldName}[${index}] required`);
    if (path.isAbsolute(normalized) || normalized.includes("..")) {
      throw new Error(`${fieldName}[${index}] must be a safe relative path`);
    }
    return normalized;
  });
}

export function createKairosBoardConfig(pluginConfig = {}, options = {}) {
  const repoRoot = ensureAbsolutePath(nonEmptyString(options.repoRoot) ?? nonEmptyString(pluginConfig.repoRoot), "repoRoot");
  const parleyRoot = ensureAbsolutePath(nonEmptyString(pluginConfig.parleyRoot) ?? DEFAULT_PARLEY_ROOT, "parleyRoot");
  const boardRoot = ensureAbsolutePath(
    nonEmptyString(pluginConfig.parleyKairosBoardRoot) ?? path.join(parleyRoot, "boards", "kairos"),
    "parleyKairosBoardRoot"
  );
  const stateRoot = ensureAbsolutePath(
    nonEmptyString(pluginConfig.parleyKairosStateRoot) ?? path.join(boardRoot, "state"),
    "parleyKairosStateRoot"
  );
  const managedArtifactRoot = ensureAbsolutePath(
    nonEmptyString(pluginConfig.parleyKairosManagedArtifactRoot) ?? path.join(boardRoot, "artifacts"),
    "parleyKairosManagedArtifactRoot"
  );
  const defaultPlanLandingRoot = ensureAbsolutePath(
    nonEmptyString(pluginConfig.parleyKairosDefaultPlanLandingRoot) ?? path.join(repoRoot, "plans"),
    "parleyKairosDefaultPlanLandingRoot"
  );

  const allowedPlanSubdirs = normalizeStringArray(
    pluginConfig.parleyKairosAllowedPlanSubdirs ?? [
      "agent-comms/parley",
      "architecture/generation",
      "architecture/system",
      "architecture/tools",
      "architecture/ui",
      "architecture/workspaces"
    ],
    "parleyKairosAllowedPlanSubdirs"
  );
  const allowedReferenceRoots = normalizePathArray(
    pluginConfig.parleyKairosAllowedReferenceRoots ?? [
      path.join(repoRoot, "docs"),
      path.join(repoRoot, "plans"),
      path.join(repoRoot, "vault")
    ],
    "parleyKairosAllowedReferenceRoots"
  );
  const allowedLandingRoots = normalizePathArray(
    pluginConfig.parleyKairosAllowedLandingRoots ?? [path.join(repoRoot, "plans"), path.join(repoRoot, "docs")],
    "parleyKairosAllowedLandingRoots"
  );
  const docsRoot = path.join(repoRoot, "docs");
  const vaultRoot = path.join(repoRoot, "vault");

  return {
    board_id: "kairos",
    display_name: "Kairos",
    status: "active",
    board_root: boardRoot,
    state_root: stateRoot,
    managed_artifact_root: managedArtifactRoot,
    default_plan_landing_root: defaultPlanLandingRoot,
    plan_extension: nonEmptyString(pluginConfig.parleyKairosPlanExtension) ?? ".md",
    artifact_namespaces: [
      {
        id: "project_plans",
        roles: ["plan_landing", "explicit_landing", "reference"],
        default_for: ["plan_landing"],
        uri_prefix: "repo://plans/",
        resolved_root: defaultPlanLandingRoot,
        allowed_subpaths: allowedPlanSubdirs
      },
      {
        id: "project_docs",
        roles: ["explicit_landing", "reference"],
        default_for: [],
        uri_prefix: "repo://docs/",
        resolved_root: docsRoot,
        allowed_subpaths: []
      },
      {
        id: "project_vault",
        roles: ["reference"],
        default_for: [],
        uri_prefix: "vault://",
        resolved_root: vaultRoot,
        allowed_subpaths: []
      }
    ],
    allowed_reference_namespaces: ["project_plans", "project_docs", "project_vault"],
    allowed_plan_subdirs: allowedPlanSubdirs,
    allowed_reference_roots: allowedReferenceRoots,
    allowed_landing_roots: allowedLandingRoots,
    permission_model: {
      mode: "board_wide_all_tools",
      future_agent_scoping: true
    },
    agent_registry: [
      {
        board_agent_id: "kairos-operator",
        display_name: "Kairos Operator",
        kind: "agent",
        runtime_refs: [
          { scheme: "openclaw", type: "agent", id: "kairos-operator" },
          { scheme: "openclaw", type: "session", id: "kairos-operator:discord" },
          { scheme: "openclaw", type: "session", id: "kairos-operator:webchat" },
          { scheme: "openclaw", type: "session", id: "agent:kairos-operator:discord:channel:1494492383726010418" }
        ],
        roles: ["implementation", "runtime"],
        permissions: { preset: "board_admin" }
      },
      {
        board_agent_id: "kairos-orchestrator",
        display_name: "Kairos Orchestrator",
        kind: "agent",
        runtime_refs: [
          { scheme: "openclaw", type: "agent", id: "kairos-orchestrator" },
          { scheme: "openclaw", type: "session", id: "agent:kairos-orchestrator:discord:channel:1492408840862433480" }
        ],
        roles: ["orchestration", "planning"],
        permissions: { preset: "board_admin" }
      }
    ]
  };
}
