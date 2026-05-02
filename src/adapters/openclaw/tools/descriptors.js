export const QUERY_ACTIONS = Object.freeze(["where_am_i", "my_boards", "board", "validate_plan", "validate_state", "runtime_obligations", "board_obligations", "search"]);
export const MUTATE_ACTIONS = Object.freeze([
  "register_artifact",
  "create_object",
  "record_effect",
  "create_obligation",
  "record_relationship",
  "remove_relationship",
  "create_plan"
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
    purpose: "Discover Parley's agent-facing tool surface, target scopes, valid facade actions, board selection rules, and common examples.",
    tools: ["parley_describe", "parley_my_boards", "parley_where_am_i", "parley_query", "parley_mutate"],
    topics: [...DESCRIBE_TOPICS],
    query_actions: [...QUERY_ACTIONS],
    mutate_actions: [...MUTATE_ACTIONS],
    rules: [
      "Targetability is shared; resolution is scope-specific; actionability is derived.",
      "parley_where_am_i({}) returns runtime recovery plus board discovery hints.",
      "parley_where_am_i({ boardId }) returns separate runtime and board sections.",
      "parley_my_boards is the boardless board discovery call.",
      "Board-scoped reads and writes require explicit boardId; default_board is a selection hint, not implicit routing.",
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
      { step: 3, tool: "parley_where_am_i", call: { boardId: "<default_board>" }, purpose: "Recover board-local identity, board obligations, deferred work, approvals, and checkpoints while keeping runtime and board sections separate." },
      { step: 4, tool: "parley_query", call: { action: "runtime_obligations" }, purpose: "Query runtime protocol obligations directly when needed." },
      { step: 5, tool: "parley_query", call: { action: "board_obligations", boardId: "<boardId>", input: { filter: "needs_my_action" } }, purpose: "Query board-scoped obligations directly when needed." },
      { step: 6, tool: "parley_query", call: { action: "search", boardId: "<boardId>", input: { query: "<term>" } }, purpose: "Search board-registered reference namespaces when context or artifacts are needed." }
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
    tool: "parley_query",
    action: "runtime_obligations",
    required_fields: ["action"],
    rejected_fields: ["boardId"],
    input_schema: {
      filter: { type: "string", enum: [...OBLIGATION_FILTERS], default: "needs_my_action" },
      limit: { type: "integer", minimum: 0, maximum: 200, default: 50 }
    },
    target_scope: "runtime",
    target_kinds: [...RUNTIME_TARGET_KINDS],
    examples: [
      { description: "Find runtime obligations needing my action.", call: { action: "runtime_obligations", input: { filter: "needs_my_action" } } }
    ]
  };
}

export function boardObligationsDescriptor() {
  return {
    topic: "query.board_obligations",
    tool: "parley_query",
    action: "board_obligations",
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
    targetKinds: [...BOARD_OBLIGATION_TARGET_KINDS],
    examples: [
      { description: "Find plan obligations needing my action.", call: { action: "board_obligations", boardId: "project", input: { filter: "needs_my_action", targetKinds: ["plans"] } } },
      { description: "Find all board obligations assigned to me.", call: { action: "board_obligations", boardId: "project", input: { filter: "assigned_to_me" } } }
    ]
  };
}

export function searchDescriptor() {
  return {
    topic: "query.search",
    tool: "parley_query",
    action: "search",
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
      { description: "Search all allowed reference namespaces.", call: { action: "search", boardId: "project", input: { query: "checkpoint" } } },
      { description: "Search selected namespaces.", call: { action: "search", boardId: "project", input: { query: "recovery", namespaces: ["project_docs", "project_plans"], limit: 10 } } }
    ]
  };
}

export function mutateDescriptor() {
  return {
    topic: "mutate",
    tool: "parley_mutate",
    actions: [...MUTATE_ACTIONS],
    required_fields: ["action", "boardId"],
    board_rule: "All parley_mutate actions are board-scoped and require explicit boardId.",
    target_rule: "Mutations that reference targets accept board targets only unless explicitly documented otherwise.",
    examples: [
      { description: "Create a plan from a parley.plan.v1 package.", call: { action: "create_plan", boardId: "project", input: { planId: "plan_example", title: "Example Plan", shepherd: "parley-agent", namespaceId: "project_plans", subpath: "agent-comms", phases: [] } } }
    ]
  };
}

export function createPlanDescriptor() {
  return {
    topic: "mutate.create_plan",
    tool: "parley_mutate",
    action: "create_plan",
    required_fields: ["action", "boardId", "input.planId", "input.title", "input.shepherd", "input.phases"],
    input_schema: {
      planId: { type: "string", required: true, description: "Board-scoped plan id." },
      title: { type: "string", required: true },
      shepherd: { type: "string", required: true, description: "Board-local agent responsible for plan shepherding." },
      namespaceId: { type: "string", required: false, default: "board namespace default_for=plan_landing" },
      subpath: { type: "string", required: false, description: "Safe relative subpath inside the selected plan namespace." },
      filename: { type: "string", required: false, default: "derived from planId and board plan_extension" },
      phases: { type: "array", required: true },
      human_checkpoints: { type: "array", required: false },
      success_criteria: { type: "array", required: false },
      non_goals: { type: "array", required: false }
    },
    plan_namespace_behavior: [
      "create_plan lands plan bodies in an artifact namespace with role plan_landing.",
      "If namespaceId is omitted, Parley uses the board namespace whose default_for includes plan_landing.",
      "subpath and filename must remain safe relative paths under the selected namespace.",
      "The resulting artifact is registered as a plan artifact and linked to the coordination object."
    ],
    examples: [
      { description: "Create a plan in the default plan namespace.", call: { action: "create_plan", boardId: "project", input: { planId: "plan_alpha", title: "Alpha Plan", shepherd: "parley-agent", phases: [{ phase_id: "phase_1", title: "Implement", status: "active", owner: "parley-agent", objectives: ["Ship the minimal path"], tasks: [], acceptance: ["Tests pass"] }] } } }
    ]
  };
}

export function boardsIdentityDescriptor() {
  return {
    topic: "boards/identity",
    tools: ["parley_my_boards", "parley_where_am_i", "parley_query", "parley_mutate", "parley_describe"],
    rules: [
      "parley_my_boards is boardless and returns accessible boards plus default_board.",
      "parley_where_am_i({}) is boardless runtime recovery plus board discovery hints.",
      "default_board is a selection hint. It is not silently applied to board-scoped calls.",
      "Board-scoped parley_query actions and all parley_mutate actions require explicit boardId.",
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
    case "boards":
    case "identity":
    case "boards/identity": return boardsIdentityDescriptor();
    default: return null;
  }
}
