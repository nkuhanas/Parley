import { PLAN_PHASE_STATUSES, createParleyPlanV1Document } from "../schema/index.js";
import { assertBoardAgentId, assertBoardId, assertNonEmptyString, assertRecordId } from "../board/board_schema.js";

export const PLAN_SETUP_REQUIRED = Object.freeze(["overview", "phase"]);
export const PLAN_CHECKPOINT_KINDS = Object.freeze(["review", "approval", "decision"]);
export const PLAN_CHECKPOINT_STATUSES = Object.freeze(["pending", "active", "complete", "cancelled", "deferred"]);

function optionalString(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim();
}

function stringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((item) => optionalString(item)).filter(Boolean);
  const single = optionalString(value);
  return single == null ? [] : [single];
}

function statusValue(value, fallback = "draft") {
  const status = optionalString(value, fallback);
  return PLAN_PHASE_STATUSES.includes(status) ? status : fallback;
}

export function boardAgentIds(board) {
  return board.agent_registry.map((agent) => agent.board_agent_id);
}

export function normalizePlanOverview(input = {}) {
  return {
    purpose: optionalString(input.purpose),
    background: optionalString(input.background),
    scope_summary: optionalString(input.scopeSummary ?? input.scope_summary),
    in_scope: stringArray(input.inScope ?? input.in_scope),
    out_of_scope: stringArray(input.outOfScope ?? input.out_of_scope),
    current_state: optionalString(input.currentState ?? input.current_state),
    target_state: optionalString(input.targetState ?? input.target_state),
    approach: optionalString(input.approach),
    assumptions: stringArray(input.assumptions),
    non_goals: stringArray(input.nonGoals ?? input.non_goals),
    open_questions: stringArray(input.openQuestions ?? input.open_questions),
    acceptance_criteria: stringArray(input.acceptanceCriteria ?? input.acceptance_criteria),
    risks_and_constraints: stringArray(input.risksAndConstraints ?? input.risks_and_constraints)
  };
}

export function normalizePlanPhase(input = {}, board) {
  const owner = assertBoardAgentId(input.owner, "owner");
  if (!boardAgentIds(board).includes(owner)) throw new Error(`owner must be a board agent: ${owner}`);
  const status = statusValue(input.status, "draft");
  return {
    phase_id: input.phaseId ?? input.phase_id,
    title: assertNonEmptyString(input.title, "title"),
    owner,
    status,
    trigger: optionalString(input.trigger),
    entry_criteria: stringArray(input.entryCriteria ?? input.entry_criteria),
    work: stringArray(input.work),
    exit_criteria: stringArray(input.exitCriteria ?? input.exit_criteria),
    activation_conditions: stringArray(input.activationConditions ?? input.activation_conditions),
    review_trigger: stringArray(input.reviewTrigger ?? input.review_trigger),
    deferral_reason: stringArray(input.deferralReason ?? input.deferral_reason),
    non_goals_before_activation: stringArray(input.nonGoalsBeforeActivation ?? input.non_goals_before_activation),
    supporting_agents: stringArray(input.supportingAgents ?? input.supporting_agents)
  };
}

export function normalizePlanCheckpoint(input = {}, plan, board) {
  const requiredFrom = assertNonEmptyString(input.requiredFrom ?? input.required_from, "requiredFrom");
  const shepherd = assertBoardAgentId(input.shepherd ?? plan.owner, "shepherd");
  if (!boardAgentIds(board).includes(shepherd)) throw new Error(`shepherd must be a board agent: ${shepherd}`);
  return {
    checkpoint_id: input.checkpointId ?? input.checkpoint_id,
    title: assertNonEmptyString(input.title, "title"),
    kind: optionalString(input.kind, "review"),
    required_from: requiredFrom,
    shepherd,
    trigger: optionalString(input.trigger, "manual"),
    status: optionalString(input.status, "pending"),
    requested_decision: optionalString(input.requestedDecision ?? input.requested_decision, "review"),
    due_at: input.dueAt ?? input.due_at ?? null,
    related_phase_id: input.relatedPhaseId ?? input.related_phase_id ?? null
  };
}

export function assertPlanSetupRecord(record) {
  const raw = record && typeof record === "object" && !Array.isArray(record) ? record : null;
  if (raw == null) throw new Error("plan setup record must be an object");
  const plan = {
    board_id: assertBoardId(raw.board_id),
    plan_id: assertRecordId(raw.plan_id, "plan_id"),
    artifact_id: raw.artifact_id == null ? null : assertRecordId(raw.artifact_id, "artifact_id"),
    title: assertNonEmptyString(raw.title, "title"),
    authority: optionalString(raw.authority, "implementation-plan"),
    status: optionalString(raw.status, "draft"),
    version: Number.isInteger(raw.version) && raw.version > 0 ? raw.version : 1,
    owner: assertBoardAgentId(raw.owner, "owner"),
    participants: stringArray(raw.participants),
    landing: raw.landing && typeof raw.landing === "object" ? raw.landing : {},
    overview: raw.overview == null ? null : normalizePlanOverview(raw.overview),
    phases: Array.isArray(raw.phases) ? raw.phases.map((phase, index) => ({ ...phase, phase_id: assertRecordId(phase.phase_id ?? `phase_${index + 1}`, `phases[${index}].phase_id`) })) : [],
    human_checkpoints: Array.isArray(raw.human_checkpoints) ? raw.human_checkpoints.map((checkpoint, index) => ({ ...checkpoint, checkpoint_id: assertRecordId(checkpoint.checkpoint_id ?? `checkpoint_${index + 1}`, `human_checkpoints[${index}].checkpoint_id`) })) : [],
    review: raw.review ?? { required_reviewers: [], approvals: [], objections: [] },
    relationships: raw.relationships,
    parley: raw.parley,
    priority: raw.priority ?? null,
    coordination_mode: raw.coordination_mode ?? raw.coordinationMode ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at
  };
  return plan;
}

export function derivePlanSetupState(plan, board) {
  const missingRequired = [];
  if (plan.overview == null) missingRequired.push("overview");
  if (!Array.isArray(plan.phases) || plan.phases.length === 0) missingRequired.push("phase");
  const validOwners = boardAgentIds(board);
  const nextRequiredAction = missingRequired[0] === "overview"
    ? { tool: "parley_write_plan_overview", reason: "A plan needs an overview before review." }
    : missingRequired[0] === "phase"
      ? { tool: "parley_add_plan_phase", reason: "A plan needs at least one phase before review." }
      : null;
  return {
    planId: plan.plan_id,
    setupComplete: missingRequired.length === 0,
    missingRequired,
    nextRequiredAction,
    nextRecommendedActions: nextRequiredAction == null
      ? [{ tool: "parley_add_plan_checkpoint", reason: "Add human checkpoints when review or approval requires a human gate." }]
      : [nextRequiredAction],
    validOwners,
    allowedPhaseStatuses: [...PLAN_PHASE_STATUSES],
    reminder: `Use planId ${plan.plan_id} in subsequent plan setup calls.`
  };
}

function listMarkdown(items, fallback = "TBD") {
  const values = stringArray(items);
  return values.length === 0 ? fallback : values.map((item) => `- ${item}`).join("\n");
}

function phaseMarkdown(phase, index) {
  const label = index + 1;
  return [
    `### Phase ${label} — ${phase.title}`,
    "",
    `Status: ${phase.status ?? "draft"}`,
    `Owner: ${phase.owner}`,
    "",
    "Entry criteria:",
    listMarkdown(phase.entry_criteria),
    "",
    "Work:",
    listMarkdown(phase.work),
    "",
    "Exit criteria:",
    listMarkdown(phase.exit_criteria),
    "",
    "Supporting agents:",
    listMarkdown(phase.supporting_agents, "None."),
    "",
    "Activation conditions:",
    listMarkdown(phase.activation_conditions),
    "",
    "Review trigger:",
    listMarkdown(phase.review_trigger),
    "",
    "Deferral reason:",
    listMarkdown(phase.deferral_reason),
    "",
    "Non-goals before activation:",
    listMarkdown(phase.non_goals_before_activation),
    ""
  ].join("\n");
}

export function renderPlanSetupMarkdown(plan) {
  const overview = plan.overview ?? {};
  const scope = {
    summary: overview.scope_summary ?? "TBD",
    in: overview.in_scope?.length ? overview.in_scope : ["TBD"],
    out: overview.out_of_scope?.length ? overview.out_of_scope : ["TBD"]
  };
  return createParleyPlanV1Document({
    authority: plan.authority,
    plan_id: plan.plan_id,
    board_id: plan.board_id,
    title: plan.title,
    status: plan.status,
    version: plan.version,
    created_at: plan.created_at,
    updated_at: plan.updated_at,
    owner: plan.owner,
    participants: plan.participants,
    scope,
    landing: plan.landing,
    review: plan.review,
    relationships: plan.relationships,
    parley: plan.parley,
    priority: plan.priority,
    coordination_mode: plan.coordination_mode,
    human_checkpoints: plan.human_checkpoints,
    sections: {
      purpose: overview.purpose,
      background: overview.background,
      scope: overview.scope_summary,
      current_state: overview.current_state,
      target_state: overview.target_state,
      plan: overview.approach,
      phases: plan.phases.length === 0 ? "No phases defined yet." : plan.phases.map(phaseMarkdown).join("\n"),
      acceptance_criteria: listMarkdown(overview.acceptance_criteria),
      risks_and_constraints: listMarkdown(overview.risks_and_constraints),
      open_questions: listMarkdown(overview.open_questions, "None recorded."),
      review_and_approval: plan.human_checkpoints.length === 0 ? "No review recorded yet." : listMarkdown(plan.human_checkpoints.map((checkpoint) => `${checkpoint.title} (${checkpoint.required_from})`)),
      change_log: `- v${plan.version}: Generated from Parley plan setup state.`
    }
  });
}
