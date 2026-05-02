import fs from "node:fs/promises";

import { assertPathUnderArtifactNamespaces } from "../board.js";
import { validateParleyPlanV1Document } from "../schemas/index.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

export function createValidatePlanAction(api) {
  return {
    name: "parley_validate_plan",
    label: "Parley Validate Plan",
    description: "Validate a Markdown plan document against the Parley-owned parley.plan.v1 schema without executing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string" },
        markdown: { type: "string", description: "Plan Markdown content to validate." },
        resolvedPath: { type: "string", description: "Optional path to a plan document under an allowed reference namespace." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      let markdown = typeof params?.markdown === "string" ? params.markdown : null;
      let resolvedPath = null;
      if (markdown == null) {
        if (typeof params?.resolvedPath !== "string" || !params.resolvedPath.trim()) {
          throw new Error("markdown or resolvedPath required");
        }
        resolvedPath = assertPathUnderArtifactNamespaces(identity.board, params.resolvedPath, "reference", "resolvedPath");
        markdown = await fs.readFile(resolvedPath, "utf8");
      }

      const validation = validateParleyPlanV1Document(markdown);
      return boardResult({
        tool: "parley_validate_plan",
        identity,
        validation,
        resolved_path: resolvedPath
      });
    }
  };
}
