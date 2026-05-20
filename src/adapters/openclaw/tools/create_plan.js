import { createPlanShell } from "./plan_common.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createCreatePlanAction(api) {
  return {
    name: "parley_create_plan",
    label: "Parley Create Plan",
    description: "Create a tracked Parley plan setup shell and return state-derived guidance for completing it through narrow plan tools.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "title"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        title: { type: "string", description: "Plan title." },
        planId: { type: "string", description: "Optional explicit plan id for tests or migrations. Omit for normal use." },
        authority: { type: "string" },
        status: { type: "string" },
        version: { type: "number" },
        owner: { type: "string" },
        participants: { type: "array", items: { type: "string" } },
        landing: { type: "object", additionalProperties: true },
        artifactNamespace: { type: "string", description: "Artifact namespace for generated Markdown projection. Defaults to the board's default plan_landing namespace." },
        landingSubpath: { type: "string", description: "Safe relative subpath under artifactNamespace." },
        filename: { type: "string", description: "Optional Markdown projection filename. Defaults from title." },
        coordinationMode: { type: "string" },
        activationPolicy: { type: "object", additionalProperties: true, description: "Optional plan activation policy. Supported mode values include manual, owner_decision, human_gate, and auto." },
        artifactId: { type: "string", description: "Optional artifact id. Defaults to artifact_<planId without plan_>." },
        objectId: { type: "string", description: "Optional coordination object id. Defaults to object_<planId without plan_>." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const created = await createPlanShell(api, identity, params);
      return boardResult({
        tool: "parley_create_plan",
        identity,
        plan: {
          schema: "parley.plan_setup.v1",
          plan_id: created.plan.plan_id,
          title: created.plan.title,
          status: created.plan.status,
          version: created.plan.version,
          owner: created.plan.owner,
          path: created.plan.landing.resolved_path,
          uri: created.plan.landing.uri,
          projection_validation: created.validation
        },
        projection: created.projection,
        object: created.object,
        artifact: created.artifact,
        setupState: created.setupState,
        plan_lifecycle: { obligations: created.lifecycleObligations ?? [] }
      });
    }
  };
}
