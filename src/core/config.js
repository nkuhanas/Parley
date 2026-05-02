import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertBoardAgentRecord, assertBoardId, assertRuntimeRef } from "./board/board_schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_RUNTIME_ROOT = path.join(os.homedir(), ".local", "share", "parley", "runtime");

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
    nonEmptyString(pluginConfig.parleyRuntimeRoot) ?? DEFAULT_RUNTIME_ROOT,
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

function normalizeBoardMember(rawMember, fieldName) {
  if (!rawMember || typeof rawMember !== "object" || Array.isArray(rawMember)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const globalAgentId = nonEmptyString(rawMember.global_agent_id ?? rawMember.globalAgentId ?? rawMember.agent_id ?? rawMember.agentId);
  const boardAgentId = nonEmptyString(rawMember.board_agent_id ?? rawMember.boardAgentId ?? globalAgentId);
  if (!boardAgentId) throw new Error(`${fieldName}.board_agent_id required`);
  return assertBoardAgentRecord({
    ...rawMember,
    global_agent_id: globalAgentId,
    board_agent_id: boardAgentId,
    display_name: rawMember.display_name ?? rawMember.displayName,
    runtime_refs: rawMember.runtime_refs ?? rawMember.runtimeRefs ?? rawMember.runtime_bindings ?? rawMember.runtimeBindings ?? []
  }, fieldName);
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
  const rawAgentRegistry = Array.isArray(rawBoard.agent_registry)
    ? rawBoard.agent_registry
    : Array.isArray(rawBoard.agents)
      ? rawBoard.agents
      : Array.isArray(rawBoard.members)
        ? rawBoard.members
        : [];

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
    agent_registry: rawAgentRegistry.map((agent, index) => normalizeBoardMember(agent, `agent_registry[${index}]`))
  };
}

function boardConfigObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayOrObjectEntries(value, fieldName) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => [null, item, `${fieldName}[${index}]`]);
  }
  if (typeof value === "object") {
    return Object.entries(value).map(([key, item]) => [key, item, `${fieldName}.${key}`]);
  }
  throw new Error(`${fieldName} must be an object or array`);
}

function normalizeRuntimeBindings(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((runtimeRef, index) => assertRuntimeRef(runtimeRef, `${fieldName}[${index}]`));
}

function uniqueRuntimeBindings(runtimeBindings) {
  const seen = new Set();
  const unique = [];
  for (const runtimeRef of runtimeBindings) {
    const key = `${runtimeRef.scheme}:${runtimeRef.type}:${runtimeRef.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(runtimeRef);
  }
  return unique;
}

function normalizeMembership(rawMembership, boardId, fieldName, fallbackBoardAgentId = null) {
  const raw = rawMembership && typeof rawMembership === "object" && !Array.isArray(rawMembership) ? rawMembership : {};
  const normalizedBoardId = assertBoardId(raw.board_id ?? raw.boardId ?? boardId, `${fieldName}.board_id`);
  const boardAgentId = nonEmptyString(raw.board_agent_id ?? raw.boardAgentId ?? raw.agent_id ?? raw.agentId ?? fallbackBoardAgentId);
  if (!boardAgentId) throw new Error(`${fieldName}.board_agent_id required`);
  return {
    board_id: normalizedBoardId,
    board_agent_id: boardAgentId,
    roles: normalizeFreeStringArray(raw.roles, `${fieldName}.roles`),
    permissions: raw.permissions && typeof raw.permissions === "object" && !Array.isArray(raw.permissions)
      ? raw.permissions
      : { preset: "board_admin" }
  };
}

function normalizeGlobalAgent(rawAgent, key, fieldName) {
  if (!rawAgent || typeof rawAgent !== "object" || Array.isArray(rawAgent)) {
    throw new Error(`${fieldName} must be an object`);
  }
  const globalAgentId = nonEmptyString(rawAgent.global_agent_id ?? rawAgent.globalAgentId ?? rawAgent.agent_id ?? rawAgent.agentId ?? rawAgent.id ?? key);
  if (!globalAgentId) throw new Error(`${fieldName}.global_agent_id required`);
  const rawMemberships = rawAgent.memberships ?? {};
  const memberships = {};
  for (const [membershipKey, membership, membershipField] of arrayOrObjectEntries(rawMemberships, `${fieldName}.memberships`)) {
    const boardId = membershipKey ?? membership?.board_id ?? membership?.boardId;
    if (!boardId) throw new Error(`${membershipField}.board_id required`);
    const normalized = normalizeMembership(membership, boardId, membershipField, globalAgentId);
    memberships[normalized.board_id] = normalized;
  }
  const defaultBoard = rawAgent.default_board ?? rawAgent.defaultBoard;
  return {
    global_agent_id: globalAgentId,
    display_name: nonEmptyString(rawAgent.display_name ?? rawAgent.displayName) ?? globalAgentId,
    kind: nonEmptyString(rawAgent.kind) ?? "agent",
    runtime_bindings: normalizeRuntimeBindings(
      rawAgent.runtime_bindings ?? rawAgent.runtimeBindings ?? rawAgent.runtime_refs ?? rawAgent.runtimeRefs,
      `${fieldName}.runtime_bindings`
    ),
    default_board: defaultBoard == null ? null : assertBoardId(defaultBoard, `${fieldName}.default_board`),
    memberships
  };
}

function addSynthesizedMembership(agents, board, boardAgent) {
  const globalAgentId = nonEmptyString(boardAgent.global_agent_id) ?? boardAgent.board_agent_id;
  const existing = agents[globalAgentId];
  const agent = existing ?? {
    global_agent_id: globalAgentId,
    display_name: boardAgent.display_name ?? globalAgentId,
    kind: boardAgent.kind ?? "agent",
    runtime_bindings: [],
    default_board: null,
    memberships: {}
  };
  agent.runtime_bindings = uniqueRuntimeBindings([...(agent.runtime_bindings ?? []), ...(boardAgent.runtime_refs ?? [])]);
  if (agent.memberships[board.board_id] == null) {
    agent.memberships[board.board_id] = {
      board_id: board.board_id,
      board_agent_id: boardAgent.board_agent_id,
      roles: boardAgent.roles ?? [],
      permissions: boardAgent.permissions ?? { preset: "board_admin" }
    };
  }
  agents[globalAgentId] = agent;
}

function normalizeGlobalAgentRegistry(pluginConfig, boards) {
  const rawRegistry = pluginConfig.parley_registry ?? pluginConfig.parleyRegistry ?? {};
  const rawAgents = rawRegistry.agents ?? pluginConfig.parleyAgents ?? {};
  const agents = {};

  for (const [key, rawAgent, fieldName] of arrayOrObjectEntries(rawAgents, "parleyRegistry.agents")) {
    const normalized = normalizeGlobalAgent(rawAgent, key, fieldName);
    agents[normalized.global_agent_id] = normalized;
  }

  for (const board of Object.values(boards)) {
    for (const boardAgent of board.agent_registry) {
      addSynthesizedMembership(agents, board, boardAgent);
    }
  }

  for (const agent of Object.values(agents)) {
    agent.runtime_bindings = uniqueRuntimeBindings(agent.runtime_bindings ?? []);
    const membershipIds = Object.keys(agent.memberships ?? {});
    if (agent.default_board == null && membershipIds.length === 1) {
      agent.default_board = membershipIds[0];
    }
    if (agent.default_board != null && agent.memberships[agent.default_board] == null) {
      throw new Error(`global agent ${agent.global_agent_id} default_board has no membership: ${agent.default_board}`);
    }
  }

  for (const agent of Object.values(agents)) {
    for (const membership of Object.values(agent.memberships)) {
      const board = boards[membership.board_id];
      if (board == null) throw new Error(`global agent ${agent.global_agent_id} membership references unknown board: ${membership.board_id}`);
      if (!board.agent_registry.some((boardAgent) => boardAgent.board_agent_id === membership.board_agent_id)) {
        board.agent_registry.push(assertBoardAgentRecord({
          board_agent_id: membership.board_agent_id,
          global_agent_id: agent.global_agent_id,
          display_name: agent.display_name,
          kind: agent.kind,
          runtime_refs: [],
          roles: membership.roles,
          permissions: membership.permissions
        }, `${board.board_id}.members[${membership.board_agent_id}]`));
      }
    }
  }

  for (const board of Object.values(boards)) {
    if (board.agent_registry.length === 0) {
      throw new Error(`board ${board.board_id} requires at least one agent or global registry membership`);
    }
  }

  return agents;
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
  const agents = normalizeGlobalAgentRegistry(pluginConfig, boards);

  return { boards, agents };
}

export const PARLEY_RUNTIME_DIRECTORIES = Object.freeze(["threads", "messages", "index"]);
