import { randomUUID } from "node:crypto";

function compactUuid() {
  return randomUUID().replace(/-/g, "");
}

export function createThreadId() {
  return `thread_${compactUuid()}`;
}

export function createMessageId() {
  return `message_${compactUuid()}`;
}

export function createArtifactId() {
  return `artifact_${compactUuid()}`;
}

export function createObjectId() {
  return `object_${compactUuid()}`;
}

export function createEffectId() {
  return `effect_${compactUuid()}`;
}

export function createObligationId() {
  return `obligation_${compactUuid()}`;
}

export function createRelationshipId() {
  return `relationship_${compactUuid()}`;
}

export function createPlanId() {
  return `plan_${compactUuid()}`;
}

export function createPlanPhaseId() {
  return `phase_${compactUuid()}`;
}

export function createPlanCheckpointId() {
  return `checkpoint_${compactUuid()}`;
}
