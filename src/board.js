import path from "node:path";

import { resolveParleyBoardRegistry } from "./config.js";
import { assertBoardAgentRecord, assertBoardId, assertRuntimeRef } from "./board_schema.js";

export function runtimeRefKey(runtimeRef) {
  return `${runtimeRef.scheme}:${runtimeRef.type}:${runtimeRef.id}`;
}

function sameRuntimeRef(left, right) {
  return runtimeRefKey(left) === runtimeRefKey(right);
}

function runtimeRefForDiagnostics(runtimeRef) {
  return {
    scheme: runtimeRef.scheme,
    type: runtimeRef.type,
    id: runtimeRef.id,
    key: runtimeRefKey(runtimeRef)
  };
}

function normalizeCallerRuntimeRef(value, pluginConfig = {}) {
  if (value != null) return assertRuntimeRef(value, "callerRuntimeRef");
  if (pluginConfig.parleyCallerRuntimeRef != null) {
    return assertRuntimeRef(pluginConfig.parleyCallerRuntimeRef, "parleyCallerRuntimeRef");
  }
  if (typeof pluginConfig.agentId === "string" && pluginConfig.agentId.trim()) {
    return { scheme: "openclaw", type: "agent", id: pluginConfig.agentId.trim() };
  }
  return null;
}

function normalizeRuntimeAliasEntries(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((entry, index) => {
    const raw = entry?.runtime_ref ?? entry?.runtimeRef ?? entry;
    return {
      runtime_ref: assertRuntimeRef(raw, `${fieldName}[${index}]`),
      source: typeof entry?.source === "string" && entry.source.trim() ? entry.source.trim() : "adapter_discovered",
      derived_from: entry?.derived_from ?? entry?.derivedFrom ?? null
    };
  });
}

function addCandidate(candidateMap, runtimeRef, source, derivedFrom = null) {
  const key = runtimeRefKey(runtimeRef);
  if (!candidateMap.has(key)) {
    candidateMap.set(key, {
      runtime_ref: runtimeRef,
      source,
      derived_from: derivedFrom
    });
  }
}

function openClawAgentIds(registry) {
  const ids = new Set();
  for (const agent of Object.values(registry.agents ?? {})) {
    for (const runtimeBinding of agent.runtime_bindings ?? []) {
      if (runtimeBinding.scheme === "openclaw" && runtimeBinding.type === "agent") ids.add(runtimeBinding.id);
    }
  }
  for (const board of Object.values(registry.boards ?? {})) {
    for (const boardAgent of board.agent_registry ?? []) ids.add(boardAgent.board_agent_id);
  }
  return [...ids];
}

function deriveOpenClawRuntimeAliases(runtimeRef, registry) {
  if (runtimeRef.scheme !== "openclaw") return [];
  if (runtimeRef.type !== "session" && runtimeRef.type !== "subagent") return [];
  const aliases = [];
  const agentSessionMatch = runtimeRef.id.match(/^agent:([^:]+):/);
  if (agentSessionMatch) {
    aliases.push({ scheme: "openclaw", type: "agent", id: agentSessionMatch[1] });
  }
  for (const agentId of openClawAgentIds(registry)) {
    if (runtimeRef.id === agentId || runtimeRef.id.startsWith(`${agentId}:`)) {
      aliases.push({ scheme: "openclaw", type: "agent", id: agentId });
    }
  }
  return aliases;
}

function runtimeCandidates(registry, callerRuntimeRef, options = {}) {
  const candidateMap = new Map();
  addCandidate(candidateMap, callerRuntimeRef, "caller_runtime_ref");
  for (const alias of normalizeRuntimeAliasEntries(options.runtimeAliases ?? options.runtime_aliases, "runtimeAliases")) {
    addCandidate(candidateMap, alias.runtime_ref, alias.source, alias.derived_from);
  }
  for (const candidate of [...candidateMap.values()]) {
    for (const alias of deriveOpenClawRuntimeAliases(candidate.runtime_ref, registry)) {
      addCandidate(candidateMap, alias, "adapter_discovered", runtimeRefForDiagnostics(candidate.runtime_ref));
    }
  }
  return [...candidateMap.values()];
}

function matchGlobalAgents(registry, candidates, candidateDiagnostics) {
  const matchesByGlobalAgent = new Map();
  for (const globalAgent of Object.values(registry.agents ?? {})) {
    for (const [candidateIndex, candidate] of candidates.entries()) {
      if (!(globalAgent.runtime_bindings ?? []).some((runtimeRef) => sameRuntimeRef(runtimeRef, candidate.runtime_ref))) continue;
      const existing = matchesByGlobalAgent.get(globalAgent.global_agent_id);
      const match = {
        global_agent: globalAgent,
        candidate,
        candidate_index: candidateIndex
      };
      if (existing == null || candidateIndex < existing.candidate_index) matchesByGlobalAgent.set(globalAgent.global_agent_id, match);
      candidateDiagnostics[candidateIndex].persisted_binding_match = true;
      candidateDiagnostics[candidateIndex].matched_global_agent_id = globalAgent.global_agent_id;
    }
  }
  return [...matchesByGlobalAgent.values()];
}

export function resolveCallerIdentity(pluginConfig = {}, options = {}) {
  const registry = resolveParleyBoardRegistry(pluginConfig);
  const callerRuntimeRef = normalizeCallerRuntimeRef(options.callerRuntimeRef, pluginConfig);
  if (callerRuntimeRef == null) {
    throw new Error("callerRuntimeRef required for Parley board identity resolution");
  }

  const requestedBoardId = options.boardId == null ? null : assertBoardId(options.boardId, "boardId");
  const candidates = runtimeCandidates(registry, callerRuntimeRef, options);
  const candidateDiagnostics = candidates.map((candidate) => ({
    runtime_ref: runtimeRefForDiagnostics(candidate.runtime_ref),
    source: candidate.source,
    derived_from: candidate.derived_from,
    persisted_binding_match: false,
    matched_global_agent_id: null
  }));

  const globalMatches = matchGlobalAgents(registry, candidates, candidateDiagnostics);
  if (globalMatches.length === 0) {
    const considered = candidateDiagnostics.map((candidate) => candidate.runtime_ref.key).join(", ");
    throw new Error(`callerRuntimeRef did not resolve to a Parley global agent: ${runtimeRefKey(callerRuntimeRef)}; considered aliases: ${considered}`);
  }
  if (globalMatches.length > 1) {
    const matched = globalMatches.map((match) => match.global_agent.global_agent_id).join(", ");
    throw new Error(`callerRuntimeRef resolved ambiguously to multiple Parley global agents: ${runtimeRefKey(callerRuntimeRef)}; matched global agents: ${matched}`);
  }

  const [{ global_agent: globalAgent, candidate: resolvedCandidate }] = globalMatches;
  const resolvedBoardId = requestedBoardId ?? globalAgent.default_board;
  if (resolvedBoardId == null) {
    throw new Error(`Parley global agent has no default board; pass boardId explicitly: ${globalAgent.global_agent_id}`);
  }

  const board = registry.boards[resolvedBoardId];
  if (board == null) throw new Error(`Parley board not found: ${resolvedBoardId}`);
  const membership = globalAgent.memberships?.[resolvedBoardId];
  if (membership == null) {
    throw new Error(`Parley global agent ${globalAgent.global_agent_id} is not a member of board: ${resolvedBoardId}`);
  }
  const board_agent = requireBoardAgent(board, membership.board_agent_id);
  const callerRuntimeRefPersisted = sameRuntimeRef(resolvedCandidate.runtime_ref, callerRuntimeRef);
  const identity_resolution = {
    source: callerRuntimeRefPersisted ? "persisted_binding" : resolvedCandidate.source,
    caller_runtime_ref_persisted: callerRuntimeRefPersisted,
    persisted_binding: callerRuntimeRefPersisted,
    global_agent_id: globalAgent.global_agent_id,
    resolved_by_runtime_ref: runtimeRefForDiagnostics(resolvedCandidate.runtime_ref),
    candidates: candidateDiagnostics,
    matched_global_agent_count: globalMatches.length,
    matched_identity_count: 1,
    requested_board_id: requestedBoardId,
    resolved_board_id: resolvedBoardId,
    used_default_board: requestedBoardId == null
  };
  return {
    board,
    board_id: board.board_id,
    global_agent_id: globalAgent.global_agent_id,
    board_agent_id: board_agent.board_agent_id,
    board_agent,
    membership,
    runtime_ref: callerRuntimeRef,
    runtime_aliases: candidates.map((candidate) => candidate.runtime_ref),
    identity_resolution,
    actor: {
      board_agent_id: board_agent.board_agent_id,
      runtime_ref: callerRuntimeRef,
      runtime_aliases: candidates.map((candidate) => candidate.runtime_ref),
      identity_resolution: {
        source: identity_resolution.source,
        caller_runtime_ref_persisted: identity_resolution.caller_runtime_ref_persisted,
        global_agent_id: identity_resolution.global_agent_id,
        resolved_by_runtime_ref: identity_resolution.resolved_by_runtime_ref
      }
    }
  };
}

export function requireBoardAgent(board, boardAgentId) {
  const normalizedId = typeof boardAgentId === "string" ? boardAgentId.trim() : "";
  const agent = board.agent_registry.find((candidate) => candidate.board_agent_id === normalizedId);
  if (!agent) throw new Error(`board agent not found on ${board.board_id}: ${boardAgentId}`);
  return assertBoardAgentRecord(agent);
}

function nonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${fieldName} required`);
  return value.trim();
}

function safeRelativePath(value, fieldName, { allowEmpty = false } = {}) {
  if ((value == null || value === "") && allowEmpty) return "";
  const normalized = nonEmptyString(value, fieldName).replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`${fieldName} must be a safe relative path`);
  }
  return normalized.replace(/^\.\//, "");
}

function isUnderRoot(candidatePath, rootPath) {
  const resolved = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function roleList(namespace) {
  return Array.isArray(namespace?.roles) ? namespace.roles : [];
}

export function resolveManagedArtifactPath(board, filename) {
  const normalizedFilename = safeRelativePath(filename, "filename");
  return path.join(board.managed_artifact_root, normalizedFilename);
}

export function findArtifactNamespace(board, namespaceId, role = null) {
  const namespaces = Array.isArray(board.artifact_namespaces) ? board.artifact_namespaces : [];
  const requestedId = namespaceId == null || namespaceId === ""
    ? namespaces.find((namespace) => Array.isArray(namespace.default_for) && namespace.default_for.includes(role))?.id
    : namespaceId;
  const normalizedId = nonEmptyString(requestedId, "artifact namespace");
  const namespace = namespaces.find((candidate) => candidate.id === normalizedId);
  if (!namespace) throw new Error(`artifact namespace not found on ${board.board_id}: ${normalizedId}`);
  if (role != null && !roleList(namespace).includes(role)) {
    throw new Error(`artifact namespace ${normalizedId} does not allow role: ${role}`);
  }
  return namespace;
}

export function assertPathUnderArtifactNamespaces(board, candidatePath, role, fieldName = "path") {
  const resolved = path.resolve(nonEmptyString(candidatePath, fieldName));
  const namespaces = (Array.isArray(board.artifact_namespaces) ? board.artifact_namespaces : [])
    .filter((namespace) => role == null || roleList(namespace).includes(role));
  if (!namespaces.some((namespace) => namespace.resolved_root != null && isUnderRoot(resolved, namespace.resolved_root))) {
    throw new Error(`${fieldName} must be under an allowed ${role ?? "artifact"} namespace`);
  }
  return resolved;
}

export function buildArtifactNamespaceUri(namespace, subpath, filename) {
  const prefix = typeof namespace.uri_prefix === "string" ? namespace.uri_prefix : "";
  const parts = [subpath, filename].filter((part) => typeof part === "string" && part.trim());
  const suffix = parts.join("/").replace(/\/+/g, "/");
  return `${prefix}${suffix}`;
}

export function resolveArtifactNamespacePath(board, options = {}) {
  const role = options.role ?? "explicit_landing";
  const namespace = findArtifactNamespace(board, options.namespaceId ?? options.namespace, role);
  const subpath = safeRelativePath(options.subpath ?? "", "landing subpath", { allowEmpty: true });
  const filename = safeRelativePath(options.filename, "filename");

  if (Array.isArray(namespace.allowed_subpaths) && namespace.allowed_subpaths.length > 0) {
    const allowed = namespace.allowed_subpaths.some((allowedSubpath) => {
      const normalizedAllowed = safeRelativePath(allowedSubpath, "allowed_subpath", { allowEmpty: false });
      return subpath === normalizedAllowed || subpath.startsWith(`${normalizedAllowed}/`);
    });
    if (!allowed) throw new Error(`landing subpath must be under an allowed namespace subpath for ${namespace.id}`);
  }

  const resolvedRoot = nonEmptyString(namespace.resolved_root, `${namespace.id}.resolved_root`);
  const resolvedPath = path.resolve(resolvedRoot, subpath, filename);
  if (!isUnderRoot(resolvedPath, resolvedRoot)) throw new Error("resolved artifact path escaped namespace root");

  return {
    namespace,
    namespace_id: namespace.id,
    subpath,
    filename,
    landing_root: path.resolve(resolvedRoot),
    resolved_path: resolvedPath,
    uri: buildArtifactNamespaceUri(namespace, subpath, filename)
  };
}
