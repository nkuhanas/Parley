export const QUERY_ACTIONS = Object.freeze(["where_am_i", "my_boards", "board", "validate_plan", "validate_state", "obligations", "search"]);
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
export const TARGET_KINDS = Object.freeze(["threads", "plans", "artifacts", "objects", "phases", "relationships", "obligations"]);
export const TARGET_KIND_ALIASES = Object.freeze({
  thread: "threads",
  threads: "threads",
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
  obligation: "obligations",
  obligations: "obligations"
});

export const DESCRIBE_TOPICS = Object.freeze([
  "overview",
  "recovery",
  "query",
  "query.obligations",
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
    purpose: "Discover Parley's agent-facing tool surface, valid facade actions, board selection rules, and common examples.",
    tools: ["parley_describe", "parley_my_boards", "parley_where_am_i", "parley_query", "parley_mutate"],
    topics: [...DESCRIBE_TOPICS],
    query_actions: [...QUERY_ACTIONS],
    mutate_actions: [...MUTATE_ACTIONS],
    rules: [
      "parley_describe is metadata/introspection and does not mutate board state.",
      "parley_my_boards is the boardless discovery call.",
      "Board-scoped reads and writes require explicit boardId; default_board is a selection hint, not implicit routing.",
      "Use topic=recovery when an agent has Parley tools but no active context."
    ],
    examples: [
      { description: "Learn the boot sequence.", call: { topic: "recovery" } },
      { description: "Inspect obligations query shape.", call: { topic: "query.obligations" } },
      { description: "Show board metadata only.", call: { boardId: "project" } }
    ]
  };
}

export function recoveryDescriptor() {
  return {
    topic: "recovery",
    boot_sequence: [
      { step: 1, tool: "parley_describe", call: { topic: "recovery" }, purpose: "Learn the safe recovery sequence and required boardId behavior." },
      { step: 2, tool: "parley_my_boards", call: {}, purpose: "Discover accessible boards and default_board." },
      { step: 3, tool: "parley_where_am_i", call: { boardId: "<default_board>" }, purpose: "Recover board-local identity, obligations, deferred work, approvals, and checkpoints." },
      { step: 4, tool: "parley_query", call: { action: "obligations", boardId: "<boardId>", input: { filter: "needs_my_action" } }, purpose: "Recover actionable obligations across target kinds." },
      { step: 5, tool: "parley_query", call: { action: "search", boardId: "<boardId>", input: { query: "<term>" } }, purpose: "Search board-registered reference namespaces when context or artifacts are needed." }
    ],
    quiet_rule: "If recovery finds no active obligations, blockers, stale approvals, pending turns, or validation risks, stay quiet.",
    explicit_board_rule: "Use parley_my_boards.default_board as a caller selection hint; still pass boardId on board-scoped calls."
  };
}

export function queryDescriptor() {
  return {
    topic: "query",
    tool: "parley_query",
    actions: [...QUERY_ACTIONS],
    required_fields: ["action"],
    board_scoped_actions: QUERY_ACTIONS.filter((action) => action !== "my_boards"),
    boardless_actions: ["my_boards"],
    input_actions: ["validate_plan", "obligations", "search"],
    examples: [
      { description: "List accessible boards.", call: { action: "my_boards" } },
      { description: "Get board projection metadata.", call: { action: "board", boardId: "project" } },
      { description: "Find obligations needing action.", call: { action: "obligations", boardId: "project", input: { filter: "needs_my_action" } } }
    ]
  };
}

export function obligationsDescriptor() {
  return {
    topic: "query.obligations",
    tool: "parley_query",
    action: "obligations",
    required_fields: ["action", "boardId"],
    input_schema: {
      filter: { type: "string", enum: [...OBLIGATION_FILTERS], default: "needs_my_action" },
      targetKinds: { type: "array", items: { enum: [...TARGET_KINDS] }, default: [] },
      scope: { alias_for: "targetKinds" },
      limit: { type: "integer", minimum: 0, maximum: 200, default: 50 }
    },
    filters: {
      needs_my_action: "Assigned to the current board agent, non-terminal, and currently actionable/waiting/deferred/stale.",
      assigned_to_me: "All obligations assigned to the current board agent, including terminal obligations.",
      all: "All matching obligations on the board, regardless of assignee."
    },
    targetKinds: [...TARGET_KINDS],
    aliases: { scope: "targetKinds" },
    examples: [
      { description: "Find threads and plans needing my action.", call: { action: "obligations", boardId: "project", input: { filter: "needs_my_action", targetKinds: ["threads", "plans"] } } },
      { description: "Same query using the scope alias.", call: { action: "obligations", boardId: "project", input: { filter: "needs_my_action", scope: ["threads", "plans"] } } }
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
      "default_board is a selection hint. It is not silently applied to board-scoped calls.",
      "parley_where_am_i, board-scoped parley_query actions, and all parley_mutate actions require explicit boardId.",
      "parley_describe({ boardId }) returns board metadata only: namespace/capability/identity metadata, not board state records."
    ],
    examples: [
      { description: "Discover default board.", call: {} },
      { description: "Use default_board explicitly.", call: { boardId: "<default_board>" } }
    ]
  };
}

export function topicDescriptor(topic) {
  switch (topic) {
    case "overview": return overviewDescriptor();
    case "recovery": return recoveryDescriptor();
    case "query": return queryDescriptor();
    case "query.obligations": return obligationsDescriptor();
    case "query.search": return searchDescriptor();
    case "mutate": return mutateDescriptor();
    case "mutate.create_plan": return createPlanDescriptor();
    case "boards":
    case "identity":
    case "boards/identity": return boardsIdentityDescriptor();
    default: return null;
  }
}
