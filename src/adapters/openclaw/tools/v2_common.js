import { resolveCallerIdentity } from "../../../core/board/board.js";
import { requireBoardAgent } from "../../../core/board/board.js";
import { enrichToolDetails } from "../guidance/envelope.js";

function summarizeIdentity(identity) {
  if (identity == null || typeof identity !== "object" || Array.isArray(identity)) return identity;
  return Object.fromEntries(Object.entries({
    board_id: identity.board_id,
    global_agent_id: identity.global_agent_id,
    board_agent_id: identity.board_agent_id,
    display_name: identity.display_name,
    kind: identity.kind,
    default_board: identity.default_board,
    boards: identity.boards
  }).filter(([, value]) => value !== undefined));
}

function summarizeIdentityResolution(resolution) {
  if (resolution == null || typeof resolution !== "object" || Array.isArray(resolution)) return resolution;
  return Object.fromEntries(Object.entries({
    source: resolution.source,
    caller_runtime_ref_persisted: resolution.caller_runtime_ref_persisted,
    persisted_binding: resolution.persisted_binding,
    global_agent_id: resolution.global_agent_id,
    requested_board_id: resolution.requested_board_id,
    resolved_board_id: resolution.resolved_board_id,
    used_default_board: resolution.used_default_board,
    accessible_board_count: resolution.accessible_board_count,
    matched_global_agent_count: resolution.matched_global_agent_count,
    matched_identity_count: resolution.matched_identity_count
  }).filter(([, value]) => value !== undefined));
}

function summarizeArtifact(artifact) {
  if (artifact == null || typeof artifact !== "object" || Array.isArray(artifact)) return artifact;
  return Object.fromEntries(Object.entries({
    artifact_id: artifact.artifact_id,
    kind: artifact.kind,
    storage_mode: artifact.storage_mode,
    uri: artifact.uri,
    version: artifact.version,
    status: artifact.status,
    title: artifact.title,
    content_hash: artifact.content_hash,
    resolved_path: artifact.resolved_path,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at
  }).filter(([, value]) => value !== undefined));
}

function summarizeObject(record) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) return record;
  return Object.fromEntries(Object.entries({
    object_id: record.object_id,
    kind: record.kind,
    title: record.title,
    status: record.status,
    artifact_ref: record.artifact_ref,
    participants: record.participants,
    created_at: record.created_at,
    updated_at: record.updated_at
  }).filter(([, value]) => value !== undefined));
}

function summarizeEffect(effect) {
  if (effect == null || typeof effect !== "object" || Array.isArray(effect)) return effect;
  return Object.fromEntries(Object.entries({
    effect_id: effect.effect_id,
    type: effect.type,
    actor: summarizeIdentity(effect.actor),
    target: summarizeValue(effect.target),
    payload: summarizeValue(effect.payload),
    source_thread_id: effect.source_thread_id,
    source_message_id: effect.source_message_id,
    created_at: effect.created_at
  }).filter(([, value]) => value !== undefined));
}

function summarizeObligation(obligation) {
  if (obligation == null || typeof obligation !== "object" || Array.isArray(obligation)) return obligation;
  return Object.fromEntries(Object.entries({
    obligation_id: obligation.obligation_id,
    agent: obligation.agent,
    type: obligation.type,
    template_id: obligation.template_id,
    status: obligation.status,
    resolution: obligation.resolution,
    resolution_note: obligation.resolution_note,
    resolved_at: obligation.resolved_at,
    priority: obligation.priority,
    target: summarizeValue(obligation.target),
    scope: obligation.scope,
    reason: obligation.reason,
    source_effect_id: obligation.source_effect_id,
    on_resolve_trigger_ids: obligation.on_resolve_trigger_ids,
    created_at: obligation.created_at,
    updated_at: obligation.updated_at
  }).filter(([, value]) => value !== undefined));
}

function summarizePlanValidation(validation) {
  if (validation == null || typeof validation !== "object" || Array.isArray(validation)) return validation;
  if (validation.frontmatter == null && validation.headings == null) return summarizeValue(validation);
  const frontmatter = validation.frontmatter ?? null;
  return Object.fromEntries(Object.entries({
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    shell_valid: validation.shell_valid,
    setup_complete: validation.setup_complete,
    missingRequired: validation.missingRequired,
    frontmatter: frontmatter == null ? null : {
      schema: frontmatter.schema,
      plan_id: frontmatter.plan_id,
      board_id: frontmatter.board_id,
      title: frontmatter.title,
      status: frontmatter.status,
      version: frontmatter.version,
      owner: frontmatter.owner,
      participants: frontmatter.participants,
      landing: frontmatter.landing,
      coordination_mode: frontmatter.coordination_mode
    },
    heading_count: Array.isArray(validation.headings) ? validation.headings.length : undefined
  }).filter(([, value]) => value !== undefined));
}

function summarizeValue(value, key = null) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => summarizeValue(item));

  if (key === "identity") return summarizeIdentity(value);
  if (key === "artifact") return summarizeArtifact(value);
  if (key === "object") return summarizeObject(value);
  if (key === "effect") return summarizeEffect(value);
  if (key === "obligation") return summarizeObligation(value);
  if (key === "validation") return summarizePlanValidation(value);

  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, summarizeValue(childValue, childKey)]));
}

export function boardResult(details, options = {}) {
  const summarizedDetails = options?.summarize === false ? details : summarizeValue(details);
  const enrichedDetails = enrichToolDetails(summarizedDetails);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(enrichedDetails, null, 2)
      }
    ],
    details: enrichedDetails
  };
}

export function callerRuntimeRefParameter(description = "Optional caller runtime identity override used to resolve board-local Parley identity. Normal tool execution derives this from trusted OpenClaw runtime metadata.") {
  return {
    type: "object",
    description,
    additionalProperties: false,
    required: ["scheme", "type", "id"],
    properties: {
      scheme: { type: "string", description: "Runtime scheme, e.g. openclaw." },
      type: { type: "string", description: "Runtime ref type, e.g. agent, session, or subagent." },
      id: { type: "string", description: "Runtime identity id." }
    }
  };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function callerRuntimeRefFromToolContext(toolContext) {
  const agentId = nonEmptyString(toolContext?.agentId);
  if (agentId != null) return { scheme: "openclaw", type: "agent", id: agentId };

  const sessionKey = nonEmptyString(toolContext?.sessionKey);
  if (sessionKey != null) return { scheme: "openclaw", type: "session", id: sessionKey };

  return null;
}

export function callerRuntimeAliasesFromToolContext(toolContext) {
  const aliases = [];
  const sessionKey = nonEmptyString(toolContext?.sessionKey);
  if (sessionKey != null) {
    aliases.push({
      runtime_ref: { scheme: "openclaw", type: "session", id: sessionKey },
      source: "adapter_discovered"
    });
  }
  const parentAgentId = nonEmptyString(toolContext?.parentAgentId);
  if (parentAgentId != null) {
    aliases.push({
      runtime_ref: { scheme: "openclaw", type: "agent", id: parentAgentId },
      source: "adapter_discovered"
    });
  }
  return aliases;
}

export function resolveToolCaller(api, params) {
  return resolveCallerIdentity(api.pluginConfig, {
    callerRuntimeRef: params?.callerRuntimeRef ?? callerRuntimeRefFromToolContext(api.toolContext),
    runtimeAliases: callerRuntimeAliasesFromToolContext(api.toolContext),
    boardId: params?.boardId
  });
}

export function assertBoardAgentForTool(board, boardAgentId) {
  return requireBoardAgent(board, boardAgentId).board_agent_id;
}
