import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertBoardAgentRecord, assertBoardId } from "./board_schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../../../..");
const DEFAULT_RUNTIME_ROOT_BASENAME = path.join(".kairos-runtime", "parley");

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

function normalizeFreeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => {
    const normalized = nonEmptyString(item);
    if (!normalized) throw new Error(`${fieldName}[${index}] required`);
    return normalized;
  });
}

function snakeCaseNamespace(rawNamespace, fieldName) {
  if (!rawNamespace || typeof rawNamespace !== "object" || Array.isArray(rawNamespace)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const id = nonEmptyString(rawNamespace.id);
  if (!id) throw new Error(`${fieldName}.id required`);
  const resolvedRoot = ensureAbsolutePath(rawNamespace.resolved_root ?? rawNamespace.resolvedRoot, `${fieldName}.resolved_root`);
  return {
    id,
    roles: normalizeFreeStringArray(rawNamespace.roles, `${fieldName}.roles`),
    default_for: normalizeFreeStringArray(rawNamespace.default_for ?? rawNamespace.defaultFor, `${fieldName}.default_for`),
    uri_prefix: nonEmptyString(rawNamespace.uri_prefix ?? rawNamespace.uriPrefix) ?? "",
    resolved_root: resolvedRoot,
    allowed_subpaths: normalizeStringArray(rawNamespace.allowed_subpaths ?? rawNamespace.allowedSubpaths, `${fieldName}.allowed_subpaths`)
  };
}

function normalizeArtifactNamespaces(rawBoard, normalizedBoardId, legacy) {
  const rawNamespaces = rawBoard.artifact_namespaces ?? rawBoard.artifactNamespaces;
  if (rawNamespaces != null) {
    if (!Array.isArray(rawNamespaces)) throw new Error(`${normalizedBoardId}.artifact_namespaces must be an array`);
    return rawNamespaces.map((namespace, index) => snakeCaseNamespace(namespace, `${normalizedBoardId}.artifact_namespaces[${index}]`));
  }

  const namespaces = [];
  if (legacy.defaultPlanLandingRoot != null) {
    namespaces.push({
      id: "project_plans",
      roles: ["plan_landing", "explicit_landing", "reference"],
      default_for: ["plan_landing"],
      uri_prefix: "repo://plans/",
      resolved_root: legacy.defaultPlanLandingRoot,
      allowed_subpaths: legacy.allowedPlanSubdirs
    });
  }
  for (const [index, root] of legacy.allowedLandingRoots.entries()) {
    if (root === legacy.defaultPlanLandingRoot) continue;
    namespaces.push({
      id: `landing_${index + 1}`,
      roles: ["explicit_landing"],
      default_for: [],
      uri_prefix: "",
      resolved_root: root,
      allowed_subpaths: []
    });
  }
  for (const [index, root] of legacy.allowedReferenceRoots.entries()) {
    if (namespaces.some((namespace) => namespace.resolved_root === root && namespace.roles.includes("reference"))) continue;
    namespaces.push({
      id: root.endsWith(`${path.sep}docs`) ? "project_docs" : root.endsWith(`${path.sep}vault`) ? "project_vault" : `reference_${index + 1}`,
      roles: ["reference"],
      default_for: [],
      uri_prefix: root.endsWith(`${path.sep}docs`) ? "repo://docs/" : root.endsWith(`${path.sep}vault`) ? "vault://" : "",
      resolved_root: root,
      allowed_subpaths: []
    });
  }
  return namespaces;
}

export function resolveParleyConfig(pluginConfig = {}) {
  const repoRoot = ensureAbsolutePath(nonEmptyString(pluginConfig.repoRoot) ?? DEFAULT_REPO_ROOT, "repoRoot");
  const runtimeRoot = ensureAbsolutePath(
    nonEmptyString(pluginConfig.parleyRuntimeRoot) ?? path.join(repoRoot, DEFAULT_RUNTIME_ROOT_BASENAME),
    "parleyRuntimeRoot"
  );

  return {
    repoRoot,
    runtimeRoot
  };
}

export function resolveParleyPaths(pluginConfig = {}) {
  const config = resolveParleyConfig(pluginConfig);
  return {
    ...config,
    threadsDir: path.join(config.runtimeRoot, "threads"),
    messagesDir: path.join(config.runtimeRoot, "messages"),
    indexDir: path.join(config.runtimeRoot, "index")
  };
}

function normalizeBoard(rawBoard, boardId) {
  const normalizedBoardId = assertBoardId(rawBoard?.board_id ?? boardId, "board_id");
  const boardRoot = ensureAbsolutePath(rawBoard.board_root, `${normalizedBoardId}.board_root`);
  const stateRoot = ensureAbsolutePath(rawBoard.state_root ?? path.join(boardRoot, "state"), `${normalizedBoardId}.state_root`);
  const managedArtifactRoot = ensureAbsolutePath(
    rawBoard.managed_artifact_root ?? path.join(boardRoot, "artifacts"),
    `${normalizedBoardId}.managed_artifact_root`
  );
  const rawDefaultPlanLandingRoot = rawBoard.default_plan_landing_root ?? rawBoard.defaultPlanLandingRoot;
  const defaultPlanLandingRoot = rawDefaultPlanLandingRoot == null
    ? null
    : ensureAbsolutePath(rawDefaultPlanLandingRoot, `${normalizedBoardId}.default_plan_landing_root`);
  const legacyAllowedPlanSubdirs = normalizeStringArray(rawBoard.allowed_plan_subdirs ?? rawBoard.allowedPlanSubdirs, `${normalizedBoardId}.allowed_plan_subdirs`);
  const legacyAllowedReferenceRoots = normalizePathArray(rawBoard.allowed_reference_roots ?? rawBoard.allowedReferenceRoots, `${normalizedBoardId}.allowed_reference_roots`);
  const legacyAllowedLandingRoots = normalizePathArray(rawBoard.allowed_landing_roots ?? rawBoard.allowedLandingRoots, `${normalizedBoardId}.allowed_landing_roots`);
  const artifactNamespaces = normalizeArtifactNamespaces(rawBoard, normalizedBoardId, {
    defaultPlanLandingRoot,
    allowedPlanSubdirs: legacyAllowedPlanSubdirs,
    allowedReferenceRoots: legacyAllowedReferenceRoots,
    allowedLandingRoots: legacyAllowedLandingRoots
  });
  const defaultPlanNamespace = artifactNamespaces.find((namespace) => namespace.default_for.includes("plan_landing"))
    ?? artifactNamespaces.find((namespace) => namespace.roles.includes("plan_landing"));
  const resolvedDefaultPlanLandingRoot = defaultPlanLandingRoot ?? defaultPlanNamespace?.resolved_root;
  if (resolvedDefaultPlanLandingRoot == null) {
    throw new Error(`${normalizedBoardId} requires a plan_landing artifact namespace or default_plan_landing_root`);
  }
  const agentRegistry = Array.isArray(rawBoard.agent_registry)
    ? rawBoard.agent_registry
    : Array.isArray(rawBoard.agents)
      ? rawBoard.agents
      : [];

  if (agentRegistry.length === 0) {
    throw new Error(`board ${normalizedBoardId} requires at least one agent`);
  }

  return {
    board_id: normalizedBoardId,
    display_name: nonEmptyString(rawBoard.display_name ?? rawBoard.displayName) ?? normalizedBoardId,
    status: nonEmptyString(rawBoard.status) ?? "active",
    board_root: boardRoot,
    state_root: stateRoot,
    managed_artifact_root: managedArtifactRoot,
    default_plan_landing_root: resolvedDefaultPlanLandingRoot,
    plan_extension: nonEmptyString(rawBoard.plan_extension ?? rawBoard.planExtension) ?? ".md",
    artifact_namespaces: artifactNamespaces,
    allowed_reference_namespaces: normalizeFreeStringArray(
      rawBoard.allowed_reference_namespaces ?? rawBoard.allowedReferenceNamespaces,
      `${normalizedBoardId}.allowed_reference_namespaces`
    ),
    allowed_plan_subdirs: legacyAllowedPlanSubdirs.length > 0 ? legacyAllowedPlanSubdirs : (defaultPlanNamespace?.allowed_subpaths ?? []),
    allowed_reference_roots: legacyAllowedReferenceRoots.length > 0
      ? legacyAllowedReferenceRoots
      : artifactNamespaces.filter((namespace) => namespace.roles.includes("reference")).map((namespace) => namespace.resolved_root),
    allowed_landing_roots: legacyAllowedLandingRoots.length > 0
      ? legacyAllowedLandingRoots
      : artifactNamespaces.filter((namespace) => namespace.roles.includes("explicit_landing") || namespace.roles.includes("plan_landing")).map((namespace) => namespace.resolved_root),
    permission_model: rawBoard.permission_model ?? rawBoard.permissionModel ?? { mode: "board_wide_all_tools", future_agent_scoping: true },
    agent_registry: agentRegistry.map((agent, index) => assertBoardAgentRecord(agent, `agent_registry[${index}]`))
  };
}

function boardConfigObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function resolveParleyBoardRegistry(pluginConfig = {}) {
  const defaultBoards = boardConfigObject(pluginConfig.parleyDefaultBoards);
  const configuredBoards = boardConfigObject(pluginConfig.parleyBoards);
  const boardInputs = { ...defaultBoards, ...configuredBoards };
  const boards = {};
  for (const [boardId, board] of Object.entries(boardInputs)) {
    const normalized = normalizeBoard(board, boardId);
    boards[normalized.board_id] = normalized;
  }

  return { boards };
}

export const PARLEY_RUNTIME_DIRECTORIES = Object.freeze(["threads", "messages", "index"]);
