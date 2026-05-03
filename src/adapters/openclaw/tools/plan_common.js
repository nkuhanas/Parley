import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveArtifactNamespacePath } from "../../../core/board/board.js";
import { createArtifactRecord, createCoordinationObjectRecord, createEffectRecord, createObligationRecord, loadPlanSetupRecord, saveArtifactRecord, saveCoordinationObjectRecord, saveEffectRecord, saveObligationRecord, savePlanSetupRecord } from "../../../core/storage/board_store.js";
import { createPlanCheckpointId, createPlanId, createPlanPhaseId } from "../../../core/ids.js";
import { nowIso } from "../../../core/time.js";
import { assertBoardAgentForTool } from "./v2_common.js";
import { derivePlanSetupState, normalizePlanCheckpoint, normalizePlanOverview, normalizePlanPhase, renderPlanSetupMarkdown } from "../../../core/plan/plan_state.js";
import { validateParleyPlanV1Document } from "../../../core/schema/index.js";

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

export function contentHash(markdown) {
  return `sha256:${crypto.createHash("sha256").update(markdown, "utf8").digest("hex")}`;
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

function checkpointForObligation(raw, plan, artifact) {
  return {
    checkpoint_id: raw.checkpoint_id,
    title: raw.title,
    kind: raw.kind ?? "review",
    required_from: raw.required_from ?? "human",
    shepherd: raw.shepherd ?? plan.owner,
    trigger: raw.trigger ?? "manual",
    status: raw.status ?? "pending",
    requested_decision: raw.requested_decision ?? "review",
    due_at: raw.due_at ?? null,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    plan_id: plan.plan_id
  };
}

async function createCheckpointObligation(api, identity, plan, artifact, rawCheckpoint) {
  const checkpoint = checkpointForObligation(rawCheckpoint, plan, artifact);
  if (checkpoint.status !== "pending") return null;
  const shepherd = assertBoardAgentForTool(identity.board, checkpoint.shepherd);
  const effect = createEffectRecord({
    board_id: identity.board_id,
    type: "review_requested",
    actor: identity.actor,
    target: {
      checkpoint_id: checkpoint.checkpoint_id,
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
    obligation_id: `obligation_${checkpoint.plan_id}_${checkpoint.checkpoint_id}_human_checkpoint`,
    agent: shepherd,
    type: "notify_human",
    status: "active",
    target: {
      checkpoint_id: checkpoint.checkpoint_id,
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
  const createdCheckpointObligation = checkpoint == null ? null : await createCheckpointObligation(api, identity, plan, savedArtifact, checkpoint);
  return { markdown, validation, artifact: savedArtifact, createdCheckpointObligation };
}

export async function saveAndExportPlan(api, identity, plan, options = {}) {
  const timestamp = nowIso();
  const nextPlan = { ...plan, updated_at: timestamp };
  const savedPlan = await savePlanSetupRecord(api.pluginConfig, identity.board, nextPlan);
  const exported = await exportPlanProjection(api, identity, savedPlan, options);
  const setupState = derivePlanSetupState(savedPlan, identity.board);
  return { plan: savedPlan, setupState, ...exported };
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
    authority: params?.authority ?? "implementation-plan",
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
    human_checkpoints: [],
    review: params?.review ?? { required_reviewers: [], approvals: [], objections: [] },
    relationships: params?.relationships,
    parley: params?.parley,
    priority: params?.priority ?? null,
    coordination_mode: params?.coordinationMode ?? params?.coordination_mode ?? "single_agent_with_human_checkpoints",
    created_at: timestamp,
    updated_at: timestamp
  };
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
  return { plan: saved, object: savedObject, setupState: derivePlanSetupState(saved, identity.board), ...exported };
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
  const checkpoint = { ...normalized, checkpoint_id: normalized.checkpoint_id ?? createPlanCheckpointId() };
  return { plan: { ...plan, human_checkpoints: [...(plan.human_checkpoints ?? []), checkpoint] }, checkpoint };
}
