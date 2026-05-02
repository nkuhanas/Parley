import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveArtifactNamespacePath } from "../../../core/board/board.js";
import { createArtifactRecord, createEffectRecord, createObligationRecord, saveArtifactRecord, saveEffectRecord, saveObligationRecord } from "../../../core/storage/board_store.js";
import { createParleyPlanV1Document, validateParleyPlanV1Document } from "../../../core/schema/index.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller, assertBoardAgentForTool } from "./v2_common.js";

function camelOrSnake(value, camelKey, snakeKey) {
  return value?.[camelKey] ?? value?.[snakeKey];
}

function landingInput(params) {
  const landing = params?.landing && typeof params.landing === "object" && !Array.isArray(params.landing)
    ? params.landing
    : {};
  return {
    namespace: camelOrSnake(landing, "namespace", "namespace") ?? params?.artifactNamespace ?? params?.artifact_namespace,
    subpath: camelOrSnake(landing, "subpath", "subpath") ?? params?.landingSubpath ?? params?.landing_subpath ?? "",
    filename: camelOrSnake(landing, "filename", "filename") ?? params?.filename
  };
}

function normalizePlanInput(params, identity, landing) {
  return {
    authority: params?.authority ?? "implementation-plan",
    plan_id: params?.planId ?? params?.plan_id,
    board_id: identity.board_id,
    title: params?.title,
    status: params?.status ?? "draft",
    version: params?.version ?? 1,
    created_at: params?.createdAt ?? params?.created_at,
    updated_at: params?.updatedAt ?? params?.updated_at,
    owner: params?.owner ?? identity.board_agent_id,
    participants: params?.participants ?? [identity.board_agent_id],
    scope: params?.scope,
    landing,
    review: params?.review,
    relationships: params?.relationships,
    parley: params?.parley,
    priority: params?.priority,
    coordination_mode: params?.coordinationMode ?? params?.coordination_mode,
    human_checkpoints: params?.humanCheckpoints ?? params?.human_checkpoints,
    sections: params?.sections
  };
}

function contentHash(markdown) {
  return `sha256:${crypto.createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

function normalizeHumanCheckpoint(raw, planInput, artifact) {
  const checkpoint = typeof raw === "string" ? { checkpoint_id: raw, title: raw } : raw;
  return {
    checkpoint_id: checkpoint.checkpoint_id,
    title: checkpoint.title,
    kind: checkpoint.kind ?? "review",
    required_from: checkpoint.required_from ?? "human",
    shepherd: checkpoint.shepherd ?? planInput.owner,
    trigger: checkpoint.trigger ?? "plan_created",
    status: checkpoint.status ?? "pending",
    requested_decision: checkpoint.requested_decision ?? "review",
    due_at: checkpoint.due_at ?? null,
    artifact_id: artifact.artifact_id,
    artifact_version: artifact.version,
    plan_id: planInput.plan_id
  };
}

function shouldCreateCheckpointObligation(checkpoint) {
  return checkpoint.status === "pending" && checkpoint.trigger === "plan_created";
}

async function createCheckpointObligations(api, identity, planInput, artifact) {
  const created = [];
  const checkpoints = Array.isArray(planInput.human_checkpoints) ? planInput.human_checkpoints : [];
  for (const rawCheckpoint of checkpoints) {
    const checkpoint = normalizeHumanCheckpoint(rawCheckpoint, planInput, artifact);
    if (!shouldCreateCheckpointObligation(checkpoint)) continue;
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
        source: "human_checkpoints_frontmatter"
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
    created.push({ checkpoint, effect: savedEffect, obligation: savedObligation });
  }
  return created;
}

export function createCreatePlanAction(api) {
  return {
    name: "parley_create_plan",
    label: "Parley Create Plan",
    description: "Create and register a Parley plan document using the Parley-owned parley.plan.v1 schema.",
    parameters: {
      type: "object",
      additionalProperties: true,
      required: ["planId", "title", "scope", "filename"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string" },
        planId: { type: "string", description: "Stable plan id, e.g. plan_parley_v2_next_step." },
        title: { type: "string" },
        authority: { type: "string" },
        status: { type: "string" },
        version: { type: "number" },
        owner: { type: "string" },
        participants: { type: "array", items: { type: "string" } },
        scope: { type: "object", additionalProperties: true },
        artifactNamespace: { type: "string", description: "Artifact namespace for plan landing. Defaults to the board's default plan_landing namespace." },
        landingSubpath: { type: "string", description: "Safe relative subpath under artifactNamespace." },
        filename: { type: "string", description: "Markdown filename for the plan." },
        sections: { type: "object", additionalProperties: true },
        coordinationMode: { type: "string" },
        humanCheckpoints: { type: "array", items: { type: "object", additionalProperties: true } },
        artifactId: { type: "string", description: "Optional artifact id. Defaults to artifact_<planId without plan_>." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const landing = landingInput(params);
      const resolvedLanding = resolveArtifactNamespacePath(identity.board, {
        role: "plan_landing",
        namespace: landing.namespace,
        subpath: landing.subpath,
        filename: landing.filename
      });
      const planInput = normalizePlanInput(params, identity, {
        namespace: resolvedLanding.namespace_id,
        subpath: resolvedLanding.subpath,
        filename: resolvedLanding.filename
      });
      const markdown = createParleyPlanV1Document(planInput);
      const validation = validateParleyPlanV1Document(markdown);
      if (!validation.ok) throw new Error(`generated plan failed validation: ${validation.errors.join("; ")}`);

      await fs.mkdir(path.dirname(resolvedLanding.resolved_path), { recursive: true });
      await fs.writeFile(resolvedLanding.resolved_path, markdown, "utf8");

      const artifactId = params?.artifactId ?? params?.artifact_id ?? `artifact_${String(planInput.plan_id).replace(/^plan_/, "")}`;
      const artifact = createArtifactRecord({
        board_id: identity.board_id,
        artifact_id: artifactId,
        kind: "plan",
        storage_mode: "explicit_landing",
        uri: resolvedLanding.uri,
        version: planInput.version,
        status: planInput.status,
        title: planInput.title,
        content_hash: contentHash(markdown),
        landing_root: resolvedLanding.landing_root,
        resolved_path: resolvedLanding.resolved_path
      });
      const savedArtifact = await saveArtifactRecord(api.pluginConfig, identity.board, artifact);
      const checkpointObligations = await createCheckpointObligations(api, identity, planInput, savedArtifact);

      return boardResult({
        tool: "parley_create_plan",
        identity,
        plan: {
          schema: "parley.plan.v1",
          plan_id: planInput.plan_id,
          path: resolvedLanding.resolved_path,
          uri: resolvedLanding.uri,
          validation
        },
        artifact: savedArtifact,
        human_checkpoints: {
          created_obligations: checkpointObligations.map((item) => ({
            checkpoint: item.checkpoint,
            effect: item.effect,
            obligation: item.obligation
          }))
        }
      });
    }
  };
}
