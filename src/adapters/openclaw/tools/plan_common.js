import fs from "node:fs/promises";
import path from "node:path";

import { resolveArtifactNamespacePath } from "../../../core/board/board.js";
import { createArtifactRecord, createCoordinationObjectRecord, createEffectRecord, createObligationRecord, listObligationRecords, loadPlanSetupRecord, saveArtifactRecord, saveCoordinationObjectRecord, saveEffectRecord, saveObligationRecord, savePlanSetupRecord, withPlanSetupRecordLock } from "../../../core/storage/board_store.js";
import { createPlanCheckpointId, createPlanId, createPlanPhaseId } from "../../../core/ids.js";
import { nowIso } from "../../../core/time.js";
import { assertBoardAgentForTool } from "./v2_common.js";
import { boardAgentIds, derivePlanSetupState, isHumanGatePhase, normalizePlanCheckpoint, normalizePlanOverview, normalizePlanPhase, renderPlanSetupMarkdown } from "../../../core/plan/plan_state.js";
import { activePhase, managedBinding, normalizeActivationPolicy, normalizePlanAuthority, normalizePlanManaged, terminalStatus, withLifecycleIndexes } from "../../../core/plan/lifecycle.js";
import { contentHash, planProjectionPayload } from "../../../core/plan/projection.js";
import { parseParleyPlanV1Document, validateParleyPlanV1Document } from "../../../core/schema/index.js";

function camelOrSnake(value, camelKey, snakeKey) {
  return value?.[camelKey] ?? value?.[snakeKey];
}

export function landingInput(params) {
  const landing = params?.landing && typeof params.landing === "object" && !Array.isArray(params.landing) ? params.landing : {};
  return {
    namespace: camelOrSnake(landing, "namespace", "namespace") ?? params?.artifactNamespace ?? params?.artifact_namespace,
    subpath: camelOrSnake(landing, "subpath", "subpath") ?? params?.landingSubpath ?? params?.landing_subpath ?? "",
    filename: camelOrSnake(landing, "filename", "filename") ?? params?.filename
  };
}


function defaultFilename(planId, title) {
  const slug = String(title ?? planId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || planId;
  return `${slug}.md`;
}

export function resolvePlanLanding(identity, params, planId) {
  const landing = landingInput(params);
  return resolveArtifactNamespacePath(identity.board, {
    role: "plan_landing",
    namespace: landing.namespace,
    subpath: landing.subpath,
    filename: landing.filename ?? defaultFilename(planId, params?.title)
  });
}

export async function loadPlanOrThrow(api, identity, planId) {
  const plan = await loadPlanSetupRecord(api.pluginConfig, identity.board, planId);
  if (plan == null) throw new Error(`plan not found: ${planId}`);
  return plan;
}

export async function withPlanMutationLock(api, identity, planId, operation) {
  return withPlanSetupRecordLock(identity.board, planId, operation);
}


function safeIdPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "reviewer";
}

function planLifecycleObligationPrefix(plan) {
  return `obligation_${plan.plan_id}_lifecycle`;
}

function terminalPlanStatus(status) {
  return terminalStatus(status) || status === "completed";
}

function boardReviewers(plan, board) {
  const valid = new Set(boardAgentIds(board));
  const approved = new Set(plan.review?.approvals ?? []);
  return (plan.review?.required_reviewers ?? []).filter((reviewer) => valid.has(reviewer) && !approved.has(reviewer));
}

function activationDecisionExecutionPolicy(plan) {
  const activationPolicyMode = plan.activation_policy?.mode ?? "owner_decision";
  const autonomyByMode = {
    manual: "requires_human",
    owner_decision: "recommend",
    human_gate: "requires_human",
    auto: "act_if_low_risk"
  };
  const autonomy = autonomyByMode[activationPolicyMode] ?? "recommend";
  return {
    autonomy,
    allowedActions: ["activate", "defer", "terminal_disposition"],
    allowedLifecycleCommands: ["parley_activate_plan", "parley_record_plan_disposition"],
    defaultAction: activationPolicyMode === "auto" ? "activate" : null,
    requiresReason: true,
    activationPolicyMode,
    guidance: autonomy === "act_if_low_risk"
      ? "Plan is ready. Autonomous activation is allowed only when preconditions are clean and the action is low risk; otherwise recommend or wait."
      : "Plan is ready. Choose or recommend the next lifecycle disposition. Do not activate unless activation policy permits autonomous execution."
  };
}

function desiredPlanLifecycleObligations(identity, plan, artifact, setupState) {
  if (terminalPlanStatus(plan.status)) return [];
  const prefix = planLifecycleObligationPrefix(plan);
  const target = {
    plan_id: plan.plan_id,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    status: plan.status
  };

  if (plan.status === "review") {
    const reviewers = boardReviewers(plan, identity.board);
    if (reviewers.length > 0) {
      return reviewers.map((reviewer) => ({
        obligation_id: `${prefix}_review_${safeIdPart(reviewer)}`,
        agent: reviewer,
        type: "review",
        target: {
          plan_id: plan.plan_id,
          artifact_id: artifact.artifact_id,
          artifact_version: artifact.version,
          scope: "plan_review"
        },
        reason: `Review decision requested for plan ${plan.plan_id}: ${plan.title}`,
        scope: "plan_lifecycle:review_decision",
        managedBinding: managedBinding(plan, "review_decision", { revision: plan.managed?.lifecycle_revision ?? 0 })
      }));
    }
    return [{
      obligation_id: `${prefix}_owner`,
      agent: plan.owner,
      type: "report_status",
      target,
      reason: `Plan ${plan.plan_id} is in review status but has no board-local required reviewers; add reviewers or change status.`,
      scope: "plan_lifecycle:review_unassigned",
      managedBinding: managedBinding(plan, "setup_decision")
    }];
  }

  if (plan.status === "ready") {
    return [{
      obligation_id: `${prefix}_owner`,
      agent: plan.owner,
      type: "report_status",
      target,
      reason: `Plan ${plan.plan_id} is ready; choose or recommend the next lifecycle disposition. Do not activate unless activation policy permits autonomous execution.`,
      scope: "plan_lifecycle:activation_decision",
      managedBinding: managedBinding(plan, "activation_decision"),
      executionPolicy: activationDecisionExecutionPolicy(plan)
    }];
  }

  if (plan.status === "active") {
    const phase = activePhase(plan);
    if (phase == null) {
      return [{
        obligation_id: `${prefix}_owner`,
        agent: plan.owner,
        type: "report_status",
        target,
        reason: `Plan ${plan.plan_id} is active but has no current phase; owner must record a phase outcome or terminal disposition.`,
        scope: "plan_lifecycle:phase_outcome_decision",
        managedBinding: managedBinding(plan, "phase_outcome_decision")
      }];
    }
    return [{
      obligation_id: `${prefix}_phase_work_${safeIdPart(phase.phase_id)}_${safeIdPart(phase.owner)}`,
      agent: phase.owner,
      type: "implement_phase",
      target: { plan_id: plan.plan_id, phase_id: phase.phase_id, artifact_id: artifact.artifact_id, artifact_version: artifact.version },
      reason: `Work requested for active plan phase ${phase.phase_id}: ${phase.title}`,
      scope: "plan_lifecycle:phase_work",
      managedBinding: managedBinding(plan, "phase_work", { phaseId: phase.phase_id })
    }, {
      obligation_id: `${prefix}_owner`,
      agent: plan.owner,
      type: "report_status",
      target: { ...target, phase_id: phase.phase_id },
      reason: `Plan ${plan.plan_id} phase ${phase.phase_id} needs owner outcome judgment when evidence is ready.`,
      scope: "plan_lifecycle:phase_outcome_decision",
      managedBinding: managedBinding(plan, "phase_outcome_decision", { phaseId: phase.phase_id })
    }];
  }

  if (plan.status === "paused" || plan.status === "blocked") {
    return [{
      obligation_id: `${prefix}_owner`,
      agent: plan.owner,
      type: "report_status",
      target,
      reason: `Plan ${plan.plan_id} is ${plan.status}; owner must resolve or terminally disposition it.`,
      scope: "plan_lifecycle:blocker_resolution",
      managedBinding: managedBinding(plan, "blocker_resolution")
    }];
  }

  if (plan.status === "draft" || plan.status === "needs_changes") {
    const role = plan.status === "needs_changes" ? "change_response" : "setup_decision";
    const reason = setupState.setupComplete
      ? `${plan.status === "needs_changes" ? "Needs-changes" : "Draft"} plan ${plan.plan_id} is setup-complete but not routed; owner must request review, mark ready, activate, archive, or record why it remains ${plan.status}.`
      : `${plan.status === "needs_changes" ? "Needs-changes" : "Draft"} plan ${plan.plan_id} needs setup: ${setupState.nextRequiredAction?.reason ?? "complete required plan fields."}`;
    return [{
      obligation_id: `${prefix}_owner`,
      agent: plan.owner,
      type: "report_status",
      target,
      reason,
      scope: `plan_lifecycle:${role}`,
      managedBinding: managedBinding(plan, role)
    }];
  }

  return [];
}

async function reconcilePlanLifecycleObligations(api, identity, plan, artifact, setupState) {
  const desired = desiredPlanLifecycleObligations(identity, plan, artifact, setupState);
  const desiredIds = new Set(desired.map((item) => item.obligation_id));
  const generatedIds = new Set(plan.managed?.generatedObligationIds ?? []);
  const existing = (await listObligationRecords(api.pluginConfig, identity.board))
    .filter((obligation) => obligation.obligation_id.startsWith(`${planLifecycleObligationPrefix(plan)}_`) || generatedIds.has(obligation.obligation_id));
  const now = nowIso();
  const active = [];
  const touched = [];

  for (const spec of desired) {
    const previous = existing.find((obligation) => obligation.obligation_id === spec.obligation_id);
    const obligation = createObligationRecord({
      board_id: identity.board_id,
      obligation_id: spec.obligation_id,
      agent: spec.agent,
      type: spec.type,
      status: "active",
      target: spec.target,
      scope: spec.scope,
      reason: spec.reason,
      source_effect_id: previous?.source_effect_id ?? null,
      managedBinding: spec.managedBinding ?? null,
      executionPolicy: spec.executionPolicy ?? null,
      created_at: previous?.created_at ?? now,
      updated_at: now
    });
    const saved = await saveObligationRecord(api.pluginConfig, identity.board, obligation);
    active.push(saved);
    touched.push(saved);
  }

  for (const previous of existing) {
    if (desiredIds.has(previous.obligation_id) || previous.status === "resolved" || previous.status === "cancelled" || previous.status === "superseded") continue;
    touched.push(await saveObligationRecord(api.pluginConfig, identity.board, {
      ...previous,
      status: terminalPlanStatus(plan.status) ? "cancelled" : "superseded",
      resolution: terminalPlanStatus(plan.status) ? "cancelled" : "superseded",
      resolution_note: `Plan lifecycle obligation superseded by plan status ${plan.status}.`,
      resolved_at: now,
      updated_at: now
    }));
  }

  const indexedPlan = withLifecycleIndexes(plan, active, now);
  const savedPlan = await savePlanSetupRecord(api.pluginConfig, identity.board, indexedPlan);
  return { plan: savedPlan, obligations: touched };
}

function checkpointForObligation(raw, plan, artifact) {
  return {
    checkpoint_id: raw.phase_id ?? raw.checkpoint_id,
    phase_id: raw.phase_id ?? raw.checkpoint_id,
    title: raw.title,
    kind: raw.kind ?? "human_checkpoint",
    required_from: raw.required_from ?? "human",
    shepherd: raw.owner ?? raw.shepherd ?? plan.owner,
    trigger: raw.trigger ?? "manual",
    status: raw.status ?? "active",
    requested_decision: raw.requested_decision ?? (raw.kind === "human_approval_gate" ? "approve_or_request_changes" : "review"),
    due_at: raw.due_at ?? null,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    plan_id: plan.plan_id
  };
}

function gateShouldCreateObligation(gate) {
  return isHumanGatePhase(gate) && !["draft", "deferred", "blocked", "failed", "cancelled", "complete", "superseded"].includes(gate.status);
}

async function createCheckpointObligation(api, identity, plan, artifact, rawCheckpoint) {
  const checkpoint = checkpointForObligation(rawCheckpoint, plan, artifact);
  if (!gateShouldCreateObligation(checkpoint)) return null;
  const shepherd = assertBoardAgentForTool(identity.board, checkpoint.shepherd);
  const effect = createEffectRecord({
    board_id: identity.board_id,
    type: "review_requested",
    actor: identity.actor,
    target: {
      checkpoint_id: checkpoint.checkpoint_id,
      phase_id: checkpoint.phase_id,
      plan_id: checkpoint.plan_id,
      artifact_id: checkpoint.artifact_id,
      artifact_version: checkpoint.artifact_version,
      review_required_from: checkpoint.required_from
    },
    payload: {
      title: checkpoint.title,
      kind: checkpoint.kind,
      requested_decision: checkpoint.requested_decision,
      due_at: checkpoint.due_at,
      shepherd,
      trigger: checkpoint.trigger,
      source: "plan_setup_state"
    }
  });
  const savedEffect = await saveEffectRecord(api.pluginConfig, identity.board, effect);
  const obligation = createObligationRecord({
    board_id: identity.board_id,
    obligation_id: `obligation_${checkpoint.plan_id}_${checkpoint.phase_id}_human_gate`,
    agent: shepherd,
    type: "notify_human",
    status: "active",
    target: {
      checkpoint_id: checkpoint.checkpoint_id,
      phase_id: checkpoint.phase_id,
      plan_id: checkpoint.plan_id,
      artifact_id: checkpoint.artifact_id,
      artifact_version: checkpoint.artifact_version,
      review_required_from: checkpoint.required_from,
      requested_decision: checkpoint.requested_decision,
      due_at: checkpoint.due_at
    },
    scope: checkpoint.kind,
    reason: `Human checkpoint requires ${checkpoint.required_from} review: ${checkpoint.title}`,
    source_effect_id: savedEffect.effect_id
  });
  const savedObligation = await saveObligationRecord(api.pluginConfig, identity.board, obligation);
  return { checkpoint, effect: savedEffect, obligation: savedObligation };
}

function normalizeBodyText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function bodyLines(value) {
  return normalizeBodyText(value).split("\n");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionContent(body, heading) {
  const lines = bodyLines(body);
  const startPattern = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "i");
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start === -1) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^##\s+/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n").trim();
}

function subsectionContent(section, heading) {
  const lines = bodyLines(section);
  const startPattern = new RegExp(`^###\\s+${escapeRegex(heading)}\\s*$`, "i");
  const start = lines.findIndex((line) => startPattern.test(line));
  if (start === -1) return "";
  const endOffset = lines.slice(start + 1).findIndex((line) => /^###\s+/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n").trim();
}

function sectionBeforeSubheading(section) {
  const lines = bodyLines(section);
  const end = lines.findIndex((line) => /^###\s+/.test(line));
  return lines.slice(0, end === -1 ? lines.length : end).join("\n").trim();
}

function markdownListItems(markdown) {
  return bodyLines(markdown)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function nullIfNA(value) {
  const normalized = normalizeBodyText(value);
  if (!normalized || normalized === "N/A" || normalized === "None." || normalized === "None") return null;
  return normalized;
}

function valueAfterInlineLabel(block, label) {
  const pattern = new RegExp(`^${escapeRegex(label)}:\\s*(.*?)\\s*$`, "im");
  const match = block.match(pattern);
  return match ? nullIfNA(match[1]) : null;
}

function blockAfterLabel(block, label, stopLabels) {
  const lines = bodyLines(block);
  const labelPattern = new RegExp(`^${escapeRegex(label)}:\\s*$`, "i");
  const start = lines.findIndex((line) => labelPattern.test(line));
  if (start === -1) return "";
  const stopPattern = new RegExp(`^(${stopLabels.map(escapeRegex).join("|")}):`);
  const endOffset = lines.slice(start + 1).findIndex((line) => stopPattern.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start + 1, end).join("\n").trim();
}

function parseImportedPhases(body, board) {
  const section = sectionContent(body, "Phases");
  if (!section) return [];
  const lines = bodyLines(section);
  const headingIndexes = lines
    .map((line, index) => ({ line, index, match: line.match(/^###\s+Phase\s+\d+\s+[—-]\s+(.+?)\s*$/) }))
    .filter((entry) => entry.match);
  const labels = [
    "Required from", "Requested decision", "Due at", "Entry criteria", "Work", "Exit criteria", "Supporting agents",
    "Activation conditions", "Review trigger", "Deferral reason", "Non-goals before activation"
  ];
  return headingIndexes.map((entry, index) => {
    const next = headingIndexes[index + 1]?.index ?? lines.length;
    const block = lines.slice(entry.index + 1, next).join("\n");
    return normalizePlanPhase({
      phase_id: createPlanPhaseId(entry.match[1]),
      title: entry.match[1],
      kind: valueAfterInlineLabel(block, "Kind") ?? "implementation",
      status: valueAfterInlineLabel(block, "Status") ?? "draft",
      owner: valueAfterInlineLabel(block, "Owner"),
      required_from: nullIfNA(blockAfterLabel(block, "Required from", labels)),
      requested_decision: nullIfNA(blockAfterLabel(block, "Requested decision", labels)),
      due_at: nullIfNA(blockAfterLabel(block, "Due at", labels)),
      entry_criteria: markdownListItems(blockAfterLabel(block, "Entry criteria", labels)),
      work: markdownListItems(blockAfterLabel(block, "Work", labels)),
      exit_criteria: markdownListItems(blockAfterLabel(block, "Exit criteria", labels)),
      supporting_agents: markdownListItems(blockAfterLabel(block, "Supporting agents", labels)),
      activation_conditions: markdownListItems(blockAfterLabel(block, "Activation conditions", labels)),
      review_trigger: markdownListItems(blockAfterLabel(block, "Review trigger", labels)),
      deferral_reason: markdownListItems(blockAfterLabel(block, "Deferral reason", labels)),
      non_goals_before_activation: markdownListItems(blockAfterLabel(block, "Non-goals before activation", labels))
    }, board);
  });
}

function importedOverview(frontmatter, body) {
  const scopeSection = sectionContent(body, "Scope");
  const inScope = markdownListItems(subsectionContent(scopeSection, "In Scope"));
  const outOfScope = markdownListItems(subsectionContent(scopeSection, "Out of Scope"));
  return normalizePlanOverview({
    purpose: sectionContent(body, "Purpose"),
    background: sectionContent(body, "Background"),
    scopeSummary: sectionBeforeSubheading(scopeSection) || frontmatter.scope?.summary,
    inScope: inScope.length ? inScope : frontmatter.scope?.in,
    outOfScope: outOfScope.length ? outOfScope : frontmatter.scope?.out,
    currentState: sectionContent(body, "Current State"),
    targetState: sectionContent(body, "Target State"),
    approach: sectionContent(body, "Plan"),
    acceptanceCriteria: markdownListItems(sectionContent(body, "Acceptance Criteria")),
    risksAndConstraints: markdownListItems(sectionContent(body, "Risks and Constraints")),
    openQuestions: markdownListItems(sectionContent(body, "Open Questions")),
    reviewAndApproval: sectionContent(body, "Review and Approval"),
    changeLog: sectionContent(body, "Change Log")
  });
}

function importedPlanRecordFromDocument(markdown, validation, artifact, board) {
  const parsed = parseParleyPlanV1Document(markdown);
  const frontmatter = validation.frontmatter ?? parsed.frontmatter;
  if (frontmatter.board_id !== board.board_id) throw new Error(`plan board_id ${frontmatter.board_id} does not match board ${board.board_id}`);
  return {
    board_id: frontmatter.board_id,
    plan_id: frontmatter.plan_id,
    artifact_id: artifact.artifact_id,
    title: frontmatter.title,
    authority: frontmatter.authority,
    status: frontmatter.status,
    version: frontmatter.version,
    owner: frontmatter.owner,
    participants: frontmatter.participants,
    landing: {
      ...(frontmatter.landing ?? {}),
      landing_root: artifact.landing_root,
      resolved_path: artifact.resolved_path,
      uri: artifact.uri
    },
    overview: importedOverview(frontmatter, parsed.body),
    phases: parseImportedPhases(parsed.body, board),
    review: frontmatter.review,
    relationships: frontmatter.relationships,
    parley: frontmatter.parley,
    priority: frontmatter.priority ?? null,
    coordination_mode: frontmatter.coordination_mode ?? null,
    created_at: frontmatter.created_at,
    updated_at: frontmatter.updated_at
  };
}

export async function importPlanArtifactSetup(api, identity, artifact, markdown) {
  const validation = validateParleyPlanV1Document(markdown);
  if (!validation.ok) return { validation, plan: null, setupState: null, lifecycleObligations: [] };
  const importedPlan = importedPlanRecordFromDocument(markdown, validation, artifact, identity.board);
  return await withPlanSetupRecordLock(identity.board, importedPlan.plan_id, async () => {
    const plan = await savePlanSetupRecord(api.pluginConfig, identity.board, importedPlan);
    const setupState = derivePlanSetupState(plan, identity.board);
    const lifecycle = await reconcilePlanLifecycleObligations(api, identity, plan, artifact, setupState);
    return { validation, plan: lifecycle.plan, setupState, lifecycleObligations: lifecycle.obligations };
  });
}

export async function exportPlanProjection(api, identity, plan, { checkpointForObligation: checkpoint = null } = {}) {
  const markdown = renderPlanSetupMarkdown(plan);
  const validation = validateParleyPlanV1Document(markdown);
  if (!validation.ok) throw new Error(`generated plan projection failed validation: ${validation.errors.join("; ")}`);
  const resolvedPath = plan.landing?.resolved_path;
  if (resolvedPath == null) throw new Error(`plan landing resolved_path missing: ${plan.plan_id}`);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, markdown, "utf8");
  const artifact = createArtifactRecord({
    board_id: identity.board_id,
    artifact_id: plan.artifact_id,
    kind: "plan",
    storage_mode: "explicit_landing",
    uri: plan.landing.uri,
    version: plan.version,
    status: plan.status,
    title: plan.title,
    content_hash: contentHash(markdown),
    landing_root: plan.landing.landing_root,
    resolved_path: resolvedPath,
    created_at: plan.created_at,
    updated_at: plan.updated_at
  });
  const savedArtifact = await saveArtifactRecord(api.pluginConfig, identity.board, artifact);
  const setupState = derivePlanSetupState(plan, identity.board);
  const lifecycle = await reconcilePlanLifecycleObligations(api, identity, plan, savedArtifact, setupState);
  const createdCheckpointObligation = checkpoint == null ? null : await createCheckpointObligation(api, identity, lifecycle.plan, savedArtifact, checkpoint);
  const projection = planProjectionPayload({ plan: lifecycle.plan, artifact: savedArtifact, markdown });
  return { markdown, validation, projection, plan: lifecycle.plan, artifact: savedArtifact, lifecycleObligations: lifecycle.obligations, createdCheckpointObligation };
}

export async function saveAndExportPlan(api, identity, plan, options = {}) {
  const timestamp = nowIso();
  const nextPlan = { ...plan, updated_at: timestamp };
  const savedPlan = await savePlanSetupRecord(api.pluginConfig, identity.board, nextPlan);
  const exported = await exportPlanProjection(api, identity, savedPlan, options);
  const setupState = derivePlanSetupState(exported.plan ?? savedPlan, identity.board);
  return { plan: exported.plan ?? savedPlan, setupState, ...exported };
}

export async function createPlanShell(api, identity, params) {
  const planId = params?.planId ?? params?.plan_id ?? createPlanId();
  const resolvedLanding = resolvePlanLanding(identity, params, planId);
  const timestamp = nowIso();
  const artifactId = params?.artifactId ?? params?.artifact_id ?? `artifact_${String(planId).replace(/^plan_/, "")}`;
  const owner = params?.owner ?? identity.board_agent_id;
  assertBoardAgentForTool(identity.board, owner);
  const plan = {
    board_id: identity.board_id,
    plan_id: planId,
    artifact_id: artifactId,
    title: params?.title,
    authority: normalizePlanAuthority(params?.authority, owner, identity.board_agent_id),
    status: params?.status ?? "draft",
    version: params?.version ?? 1,
    owner,
    participants: params?.participants ?? [owner],
    landing: {
      namespace: resolvedLanding.namespace_id,
      subpath: resolvedLanding.subpath,
      filename: resolvedLanding.filename,
      uri: resolvedLanding.uri,
      landing_root: resolvedLanding.landing_root,
      resolved_path: resolvedLanding.resolved_path
    },
    overview: null,
    phases: [],
    review: params?.review ?? { required_reviewers: [], approvals: [], objections: [] },
    relationships: params?.relationships,
    parley: params?.parley,
    priority: params?.priority ?? null,
    coordination_mode: params?.coordinationMode ?? params?.coordination_mode ?? "single_agent_with_human_gates",
    activation_policy: normalizeActivationPolicy(params?.activationPolicy ?? params?.activation_policy),
    managed: normalizePlanManaged({ lifecycle_updated_at: timestamp }),
    created_at: timestamp,
    updated_at: timestamp
  };
  return await withPlanSetupRecordLock(identity.board, planId, async () => {
    const saved = await savePlanSetupRecord(api.pluginConfig, identity.board, plan);
    const object = createCoordinationObjectRecord({
      board_id: identity.board_id,
      object_id: params?.objectId ?? params?.object_id ?? `object_${String(planId).replace(/^plan_/, "")}`,
      kind: "plan",
      title: saved.title,
      status: saved.status,
      artifact_ref: { artifact_id: artifactId, version: saved.version },
      participants: saved.participants,
      created_at: timestamp,
      updated_at: timestamp
    });
    const savedObject = await saveCoordinationObjectRecord(api.pluginConfig, identity.board, object);
    const exported = await exportPlanProjection(api, identity, saved);
    const exportedPlan = exported.plan ?? saved;
    return { plan: exportedPlan, object: savedObject, setupState: derivePlanSetupState(exportedPlan, identity.board), ...exported };
  });
}

export function withOverview(plan, input) {
  return { ...plan, overview: normalizePlanOverview(input) };
}

export function withAddedPhase(plan, input, board) {
  const normalized = normalizePlanPhase(input, board);
  const phase = { ...normalized, phase_id: normalized.phase_id ?? createPlanPhaseId() };
  return { ...plan, phases: [...(plan.phases ?? []), phase] };
}

export function withAddedCheckpoint(plan, input, board) {
  const normalized = normalizePlanCheckpoint(input, plan, board);
  const phase = { ...normalized, phase_id: normalized.phase_id ?? createPlanCheckpointId() };
  return { plan: { ...plan, phases: [...(plan.phases ?? []), phase] }, checkpoint: phase };
}

export function maybeGateForObligation(phase) {
  return isHumanGatePhase(phase) ? phase : null;
}
