export const QUERY_ACTIONS = Object.freeze(["where_am_i", "my_boards", "board", "validate_plan", "plan_setup_status", "validate_state", "runtime_obligations", "board_obligations", "search"]);
export const MUTATE_ACTIONS = Object.freeze([
  "register_artifact",
  "create_object",
  "record_effect",
  "create_obligation",
  "create_trigger",
  "resolve_obligation",
  "record_relationship",
  "remove_relationship",
  "create_plan",
  "write_plan_overview",
  "add_plan_phase",
  "add_plan_checkpoint",
  "request_plan_review",
  "mark_plan_ready",
  "record_review_decision",
  "activate_plan",
  "pause_plan",
  "resume_plan",
  "record_phase_outcome",
  "record_plan_disposition"
]);
export const OBLIGATION_FILTERS = Object.freeze(["needs_my_action", "assigned_to_me", "all"]);
export const RUNTIME_TARGET_KINDS = Object.freeze(["thread", "message", "turn"]);
export const BOARD_TARGET_KINDS = Object.freeze(["plan", "artifact", "object", "phase", "relationship", "checkpoint", "board_obligation"]);
export const BOARD_OBLIGATION_TARGET_KINDS = Object.freeze(["plans", "artifacts", "objects", "phases", "relationships", "checkpoints", "board_obligations"]);
export const BOARD_OBLIGATION_TARGET_KIND_ALIASES = Object.freeze({
  plan: "plans",
  plans: "plans",
  artifact: "artifacts",
  artifacts: "artifacts",
  object: "objects",
  objects: "objects",
  phase: "phases",
  phases: "phases",
  relationship: "relationships",
  relationships: "relationships",
  checkpoint: "checkpoints",
  checkpoints: "checkpoints",
  board_obligation: "board_obligations",
  board_obligations: "board_obligations",
  obligation: "board_obligations",
  obligations: "board_obligations"
});

export const DESCRIBE_TOPICS = Object.freeze([
  "overview",
  "recovery",
  "targets",
  "query",
  "query.runtime_obligations",
  "query.board_obligations",
  "query.search",
  "mutate",
  "mutate.create_plan",
  "mutate.plan_setup",
  "boards/identity"
]);

export function createValidationError(message, options = {}) {
  const validValues = Array.isArray(options.validValues) ? options.validValues : [];
  const describeTopic = options.describeTopic ?? "overview";
  const hint = `Call parley_describe({ topic: "${describeTopic}" }) for valid shapes and examples.`;
  const suffix = [
    validValues.length > 0 ? `Valid values: ${validValues.join(", ")}.` : null,
    `Hint: ${hint}`
  ].filter(Boolean).join(" ");
  const error = new Error(`${message}${suffix ? ` ${suffix}` : ""}`);
  error.code = options.code ?? "PARLEY_VALIDATION_ERROR";
  error.validValues = validValues;
  error.describeHint = hint;
  error.describeTopic = describeTopic;
  return error;
}

export function overviewDescriptor() {
  return {
    topic: "overview",
    purpose: "Discover Parley's agent-facing tool surface, target scopes, first-class operational tools, advanced facade actions, board selection rules, and common examples.",
    tools: ["parley_describe", "parley_my_boards", "parley_where_am_i", "parley_query_runtime_obligations", "parley_query_board_obligations", "parley_query_search", "parley_board_projection", "parley_validate_plan", "parley_validate_state", "parley_register_artifact", "parley_create_object", "parley_record_effect", "parley_create_obligation", "parley_create_trigger", "parley_resolve_obligation", "parley_record_relationship", "parley_remove_relationship", "parley_create_plan", "parley_write_plan_overview", "parley_add_plan_phase", "parley_add_plan_checkpoint", "parley_request_plan_review", "parley_mark_plan_ready", "parley_record_review_decision", "parley_activate_plan", "parley_pause_plan", "parley_resume_plan", "parley_record_phase_outcome", "parley_record_plan_disposition", "parley_get_plan_setup_status", "parley_query", "parley_mutate"],
    topics: [...DESCRIBE_TOPICS],
    query_actions: [...QUERY_ACTIONS],
    mutate_actions: [...MUTATE_ACTIONS],
    rules: [
      "Targetability is shared; resolution is scope-specific; actionability is derived.",
      "parley_where_am_i({}) returns runtime recovery plus board discovery hints.",
      "parley_where_am_i({ boardId }) returns compact runtime and board sections by default; pass verbosity: \"full\" for diagnostic detail.",
      "parley_my_boards is the boardless board discovery call.",
      "Board-scoped reads and writes require explicit boardId; default_board is a selection hint, not implicit routing.",
      "Prefer first-class operational tools during agent work; parley_query and parley_mutate remain stable advanced facades for callers that need one action-dispatch surface.",
      "Use topic=targets to understand runtime targets versus board targets."
    ],
    examples: [
      { description: "Learn the boot sequence.", call: { topic: "recovery" } },
      { description: "Inspect target ontology.", call: { topic: "targets" } },
      { description: "Inspect board obligation query shape.", call: { topic: "query.board_obligations" } },
      { description: "Show board metadata only.", call: { boardId: "project" } }
    ]
  };
}

export function recoveryDescriptor() {
  return {
    topic: "recovery",
    boot_sequence: [
      { step: 1, tool: "parley_describe", call: { topic: "recovery" }, purpose: "Learn the safe recovery sequence and required boardId behavior." },
      { step: 2, tool: "parley_where_am_i", call: {}, purpose: "Recover runtime identity, runtime protocol obligations, and available boards/default_board hints." },
      { step: 3, tool: "parley_where_am_i", call: { boardId: "<default_board>" }, purpose: "Recover compact board-local identity, obligations, deferred work, approvals, and checkpoints while keeping runtime and board sections separate. Add verbosity: \"full\" for diagnostic detail." },
      { step: 4, tool: "parley_query_runtime_obligations", call: { filter: "needs_my_action" }, purpose: "Query runtime protocol obligations directly when needed." },
      { step: 5, tool: "parley_query_board_obligations", call: { boardId: "<boardId>", filter: "needs_my_action" }, purpose: "Query board-scoped obligations directly when needed." },
      { step: 6, tool: "parley_query_search", call: { boardId: "<boardId>", query: "<term>" }, purpose: "Search board-registered reference namespaces when context or artifacts are needed." }
    ],
    quiet_rule: "If recovery finds no active runtime obligations, board obligations, blockers, stale approvals, pending turns, or validation risks, stay quiet.",
    explicit_board_rule: "Use parley_my_boards.default_board or where_am_i boards.default_board as a caller selection hint; still pass boardId on board-scoped calls."
  };
}

export function targetsDescriptor() {
  return {
    topic: "targets",
    core_rule: "Targetability is shared. Resolution is scope-specific. Actionability is derived.",
    definitions: {
      targetable_entity: "Anything Parley can reference from obligations, effects, relationships, checkpoints, approvals, projections, or query results.",
      actionable: "A derived state caused by an active obligation or projection that requires attention.",
      scope_is_not_durability: "Runtime targets may be persisted, and board targets may reference external documents. Scope is about ownership and resolution, not whether a record is saved."
    },
    runtime_targets: {
      boardId_required: false,
      owned_by: "runtime protocol layer",
      kinds: [...RUNTIME_TARGET_KINDS],
      examples: [
        { kind: "thread", thread_id: "thread_abc" },
        { kind: "message", thread_id: "thread_abc", message_id: "message_def" },
        { kind: "turn", thread_id: "thread_abc" }
      ]
    },
    board_targets: {
      boardId_required: true,
      owned_by: "board state layer",
      kinds: [...BOARD_TARGET_KINDS],
      storage_note: "The board storage record class remains obligation; board_obligation is the external target/query kind that distinguishes it from runtime obligations.",
      examples: [
        { kind: "plan", plan_id: "plan_alpha", artifact_id: "artifact_alpha", object_id: "object_alpha" },
        { kind: "phase", plan_id: "plan_alpha", phase_id: "phase_1" },
        { kind: "board_obligation", obligation_id: "obligation_review" }
      ]
    },
    resolver_rules: [
      "runtime target + no boardId is valid.",
      "runtime target + boardId is rejected unless an action explicitly documents boardId as a filter, not a resolver.",
      "board target + no boardId is rejected.",
      "board target + boardId resolves through board state."
    ]
  };
}

export function queryDescriptor() {
  return {
    topic: "query",
    tool: "parley_query",
    role: "advanced facade over first-class read tools",
    first_class_equivalents: ["parley_where_am_i", "parley_my_boards", "parley_board_projection", "parley_validate_plan", "parley_validate_state", "parley_query_runtime_obligations", "parley_query_board_obligations", "parley_query_search"],
    actions: [...QUERY_ACTIONS],
    required_fields: ["action"],
    board_scoped_actions: ["board", "validate_plan", "validate_state", "board_obligations", "search"],
    boardless_actions: ["my_boards", "runtime_obligations"],
    optional_board_actions: ["where_am_i"],
    input_actions: ["validate_plan", "runtime_obligations", "board_obligations", "search"],
    removed_actions: [{ action: "obligations", replacement: "runtime_obligations or board_obligations" }],
    examples: [
      { description: "Runtime recovery.", call: { action: "where_am_i" } },
      { description: "List accessible boards.", call: { action: "my_boards" } },
      { description: "Get board projection metadata.", call: { action: "board", boardId: "project" } },
      { description: "Find board obligations needing action.", call: { action: "board_obligations", boardId: "project", input: { filter: "needs_my_action" } } }
    ]
  };
}

export function runtimeObligationsDescriptor() {
  return {
    topic: "query.runtime_obligations",
    tool: "parley_query_runtime_obligations",
    facade: { tool: "parley_query", action: "runtime_obligations" },
    required_fields: ["action"],
    rejected_fields: ["boardId"],
    input_schema: {
      filter: { type: "string", enum: [...OBLIGATION_FILTERS], default: "needs_my_action" },
      limit: { type: "integer", minimum: 0, maximum: 200, default: 50 }
    },
    output_priority: "Returned obligations include derived priority labels; needs_my_action results are sorted by priority, then age. Runtime turn/reply obligations default to high or critical priority because they can block coordination.",
    target_scope: "runtime",
    target_kinds: [...RUNTIME_TARGET_KINDS],
    examples: [
      { description: "Find runtime obligations needing my action.", call: { filter: "needs_my_action" } }
    ]
  };
}

export function boardObligationsDescriptor() {
  return {
    topic: "query.board_obligations",
    tool: "parley_query_board_obligations",
    facade: { tool: "parley_query", action: "board_obligations" },
    required_fields: ["action", "boardId"],
    input_schema: {
      filter: { type: "string", enum: [...OBLIGATION_FILTERS], default: "needs_my_action" },
      targetKinds: { type: "array", items: { enum: [...BOARD_OBLIGATION_TARGET_KINDS] }, default: [] },
      limit: { type: "integer", minimum: 0, maximum: 200, default: 50 }
    },
    removed_aliases: { scope: "Removed to avoid confusing target scope with runtime-vs-board obligation scope; use targetKinds." },
    filters: {
      needs_my_action: "Assigned to the current board agent, non-terminal, and currently actionable/waiting/deferred/stale.",
      assigned_to_me: "All board obligations assigned to the current board agent, including terminal obligations.",
      all: "All matching board obligations on the board, regardless of assignee."
    },
    target_scope: "board",
    output_priority: "Returned obligations include derived priority labels; needs_my_action results are sorted by priority, then age. Blocking obligations and review/human-gate obligations rank above normal implementation or awareness work.",
    targetKinds: [...BOARD_OBLIGATION_TARGET_KINDS],
    examples: [
      { description: "Find plan obligations needing my action.", call: { boardId: "project", filter: "needs_my_action", targetKinds: ["plans"] } },
      { description: "Find all board obligations assigned to me.", call: { boardId: "project", filter: "assigned_to_me" } }
    ]
  };
}

export function searchDescriptor() {
  return {
    topic: "query.search",
    tool: "parley_query_search",
    facade: { tool: "parley_query", action: "search" },
    required_fields: ["action", "boardId", "input.query"],
    input_schema: {
      query: { type: "string", required: true },
      namespaces: { type: "array", items: { type: "string", description: "Board artifact namespace id with reference role." }, default: "board.allowed_reference_namespaces" },
      limit: { type: "integer", minimum: 0, maximum: 100, default: 20 }
    },
    searchable_nouns: ["registered reference namespace files", "docs", "plans", "artifacts whose bodies land under reference namespaces"],
    excludes: ["runtime threads", "runtime messages", "turns"],
    filters: {
      namespaces: "Restrict search to specific board artifact namespace ids. Omit to use allowed_reference_namespaces."
    },
    examples: [
      { description: "Search all allowed reference namespaces.", call: { boardId: "project", query: "checkpoint" } },
      { description: "Search selected namespaces.", call: { boardId: "project", query: "recovery", namespaces: ["project_docs", "project_plans"], limit: 10 } }
    ]
  };
}

export function mutateDescriptor() {
  return {
    topic: "mutate",
    tool: "parley_mutate",
    role: "advanced facade over first-class write tools",
    first_class_equivalents: ["parley_register_artifact", "parley_create_object", "parley_record_effect", "parley_create_obligation", "parley_create_trigger", "parley_resolve_obligation", "parley_record_relationship", "parley_remove_relationship", "parley_create_plan", "parley_write_plan_overview", "parley_add_plan_phase", "parley_add_plan_checkpoint", "parley_request_plan_review", "parley_mark_plan_ready", "parley_record_review_decision", "parley_activate_plan", "parley_pause_plan", "parley_resume_plan", "parley_record_phase_outcome", "parley_record_plan_disposition"],
    actions: [...MUTATE_ACTIONS],
    required_fields: ["action", "boardId"],
    board_rule: "All parley_mutate actions are board-scoped and require explicit boardId.",
    target_rule: "Mutations that reference targets accept board targets only unless explicitly documented otherwise.",
    usage_guidance: "Prefer the equivalent first-class write tools during normal agent work; use parley_mutate when a caller specifically needs a single facade action surface or compatibility path.",
    examples: [
      { description: "Create a guided plan shell through the facade.", call: { action: "create_plan", boardId: "project", input: { title: "Example Plan" } } },
      { description: "Write plan overview through the facade.", call: { action: "write_plan_overview", boardId: "project", input: { planId: "plan_example", purpose: "Coordinate the work." } } }
    ]
  };
}

export function createPlanDescriptor() {
  return {
    topic: "mutate.create_plan",
    tool: "parley_create_plan",
    facade: { tool: "parley_mutate", action: "create_plan" },
    required_fields: ["boardId", "title"],
    design_rule: "Plans are assembled through guided, narrow, schema-backed mutations. create_plan creates a tracked shell; it does not accept a complete plan object.",
    input_schema: {
      boardId: { type: "string", required: true, description: "Explicit board id." },
      title: { type: "string", required: true },
      planId: { type: "string", required: false, description: "Optional explicit id for tests/migrations; omit in normal use." },
      artifactNamespace: { type: "string", required: false, default: "board namespace default_for=plan_landing" },
      landingSubpath: { type: "string", required: false, description: "Safe relative subpath inside the selected namespace." },
      filename: { type: "string", required: false, description: "Optional generated Markdown projection filename." },
      owner: { type: "string", required: false, default: "resolved board agent" },
      participants: { type: "array", required: false }
    },
    state_guided_tool_responses: [
      "Parley tools are not passive CRUD endpoints. Tool outputs are part of the coordination protocol.",
      "Guidance is derived from canonical state, schema, and board identity constraints.",
      "Every plan setup mutation returns setup completeness, missing required bands, valid owners, valid phase statuses, and the next required/recommended action."
    ],
    setup_tools: [
      "parley_write_plan_overview",
      "parley_add_plan_phase",
      "parley_add_plan_checkpoint",
      "parley_get_plan_setup_status",
      "parley_request_plan_review",
      "parley_record_review_decision",
      "parley_activate_plan",
      "parley_record_phase_outcome"
    ],
    examples: [
      { description: "Create a tracked shell in the default plan namespace.", call: { boardId: "project", title: "Alpha Plan" } },
      { description: "Recover setup status after losing context.", call: { boardId: "project", planId: "plan_alpha" } }
    ]
  };
}

export function planSetupDescriptor() {
  return {
    topic: "mutate.plan_setup",
    tools: ["parley_create_plan", "parley_write_plan_overview", "parley_add_plan_phase", "parley_add_plan_checkpoint", "parley_get_plan_setup_status", "parley_request_plan_review", "parley_mark_plan_ready", "parley_record_review_decision", "parley_activate_plan", "parley_pause_plan", "parley_resume_plan", "parley_record_phase_outcome", "parley_record_plan_disposition"],
    required_sequence: [
      { tool: "parley_create_plan", purpose: "Create the tracked shell and store returned planId." },
      { tool: "parley_write_plan_overview", purpose: "Define purpose, scope, current/target state, approach, risks, and open questions." },
      { tool: "parley_add_plan_phase", purpose: "Add at least one phase through shallow validated fields. Use kind human_checkpoint or human_approval_gate for human gates; owner is the shepherd." },
      { tool: "parley_add_plan_checkpoint", purpose: "Compatibility helper for adding a human gate phase; prefer parley_add_plan_phase for new plan setup." },
      { tool: "parley_get_plan_setup_status", purpose: "Recover current completion state and valid next actions." },
      { tool: "parley_request_plan_review", purpose: "Owner-only lifecycle command to route a setup-complete plan to reviewers." },
      { tool: "parley_record_review_decision", purpose: "Reviewer command for assigned active review_decision obligations; resolves them internally." },
      { tool: "parley_activate_plan", purpose: "Owner-only lifecycle command to activate a ready plan." },
      { tool: "parley_record_phase_outcome", purpose: "Owner-only lifecycle command to move the phase cursor after judging evidence." }
    ],
    rule: "Do not author plans as objects. Assemble plans through these narrow tools and follow each latest setupState response."
  };
}

export function boardsIdentityDescriptor() {
  return {
    topic: "boards/identity",
    tools: ["parley_my_boards", "parley_where_am_i", "first-class read tools", "first-class board write tools", "parley_query", "parley_mutate", "parley_describe"],
    rules: [
      "parley_my_boards is boardless and returns accessible boards plus default_board.",
      "parley_where_am_i({}) is boardless runtime recovery plus board discovery hints.",
      "default_board is a selection hint. It is not silently applied to board-scoped calls.",
      "Board-scoped first-class read tools, board write tools, parley_query actions, and all parley_mutate actions require explicit boardId.",
      "parley_describe({ boardId }) returns board metadata only: namespace/capability/identity metadata, not board state records."
    ],
    examples: [
      { description: "Discover default board through runtime recovery.", call: {} },
      { description: "Use default_board explicitly for board recovery.", call: { boardId: "<default_board>" } }
    ]
  };
}

export function topicDescriptor(topic) {
  switch (topic) {
    case "overview": return overviewDescriptor();
    case "recovery": return recoveryDescriptor();
    case "target":
    case "targets": return targetsDescriptor();
    case "query": return queryDescriptor();
    case "query.runtime_obligations": return runtimeObligationsDescriptor();
    case "query.board_obligations": return boardObligationsDescriptor();
    case "query.search": return searchDescriptor();
    case "mutate": return mutateDescriptor();
    case "mutate.create_plan": return createPlanDescriptor();
    case "mutate.plan_setup": return planSetupDescriptor();
    case "boards":
    case "identity":
    case "boards/identity": return boardsIdentityDescriptor();
    default: return null;
  }
}
