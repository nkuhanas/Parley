import test from "node:test";
import assert from "node:assert/strict";

import {
  PARLEY_PLAN_V1_SCHEMA,
  PARLEY_PLAN_V1_SCHEMA_ID,
  createParleyPlanV1Document,
  parseParleyPlanV1Document,
  validateParleyPlanV1Document
} from "../src/parley/schemas/plan_v1.js";

function validPlanInput(overrides = {}) {
  return {
    authority: "implementation-plan",
    plan_id: "plan_parley_plan_schema_validation",
    board_id: "kairos",
    title: "Parley Plan Schema Validation",
    status: "draft",
    version: 1,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    owner: "kairos-operator",
    participants: ["kairos-operator", "human:sensei"],
    scope: {
      summary: "Create and validate the Parley plan document contract.",
      in: ["Define parley.plan.v1", "Validate required frontmatter and headings"],
      out: ["Execute deferred phases automatically"]
    },
    landing: {
      namespace: "project_plans",
      subpath: "agent-comms/parley",
      filename: "parley-plan-schema-validation.md"
    },
    sections: {
      purpose: "Prove Parley can create valid plan documents.",
      background: "Parley v2 needs standalone plan schema ownership.",
      current_state: "The schema exists as planning text only.",
      target_state: "The schema is represented as a Parley-owned contract and validator.",
      plan: "Add a schema module and focused validator coverage.",
      acceptance_criteria: "- Valid plans pass validation\n- Invalid plans fail closed",
      risks_and_constraints: "Keep this non-executing and project-agnostic."
    },
    ...overrides
  };
}

test("Parley plan v1 schema descriptor is Parley-owned and namespace-based", () => {
  assert.equal(PARLEY_PLAN_V1_SCHEMA.schema_id, PARLEY_PLAN_V1_SCHEMA_ID);
  assert.equal(PARLEY_PLAN_V1_SCHEMA.format, "markdown_with_yaml_frontmatter");
  assert.deepEqual(PARLEY_PLAN_V1_SCHEMA.landing_fields, ["namespace", "subpath", "filename"]);
  assert.ok(PARLEY_PLAN_V1_SCHEMA.required_body_headings.some((heading) => heading.text === "Phases"));
});

test("createParleyPlanV1Document emits a valid Markdown plan", () => {
  const markdown = createParleyPlanV1Document(validPlanInput());
  const result = validateParleyPlanV1Document(markdown);

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.frontmatter.schema, "parley.plan.v1");
  assert.equal(result.frontmatter.artifact_kind, "plan");
  assert.equal(result.frontmatter.landing.namespace, "project_plans");
  assert.match(markdown, /^---\n/);
  assert.match(markdown, /# Parley Plan Schema Validation/);
});

test("parseParleyPlanV1Document reads structured human checkpoint frontmatter", () => {
  const markdown = createParleyPlanV1Document(validPlanInput({
    coordination_mode: "single_agent_with_human_checkpoints",
    human_checkpoints: [
      {
        checkpoint_id: "checkpoint_initial_review",
        title: "Initial human review",
        kind: "review",
        required_from: "human:sensei",
        shepherd: "kairos-operator",
        trigger: "plan_created",
        status: "pending",
        requested_decision: "approve_or_request_changes"
      }
    ]
  }));
  const result = validateParleyPlanV1Document(markdown);
  const parsed = parseParleyPlanV1Document(markdown);

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(parsed.frontmatter.coordination_mode, "single_agent_with_human_checkpoints");
  assert.deepEqual(parsed.frontmatter.human_checkpoints, [
    {
      checkpoint_id: "checkpoint_initial_review",
      title: "Initial human review",
      kind: "review",
      required_from: "human:sensei",
      shepherd: "kairos-operator",
      trigger: "plan_created",
      status: "pending",
      requested_decision: "approve_or_request_changes"
    }
  ]);
});

test("parseParleyPlanV1Document reads generated YAML frontmatter", () => {
  const markdown = createParleyPlanV1Document(validPlanInput({ title: "Plan: Namespaced Landing" }));
  const parsed = parseParleyPlanV1Document(markdown);

  assert.equal(parsed.frontmatter.title, "Plan: Namespaced Landing");
  assert.deepEqual(parsed.frontmatter.scope.in, ["Define parley.plan.v1", "Validate required frontmatter and headings"]);
  assert.deepEqual(parsed.frontmatter.relationships.depends_on, []);
  assert.equal(parsed.frontmatter.parley.object_id, null);
});

test("validateParleyPlanV1Document rejects missing namespace landing", () => {
  const markdown = createParleyPlanV1Document(validPlanInput());
  const invalid = markdown.replace("  namespace: project_plans\n", "");
  const result = validateParleyPlanV1Document(invalid);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("landing.namespace")));
});

test("validateParleyPlanV1Document rejects missing required headings", () => {
  const markdown = createParleyPlanV1Document(validPlanInput());
  const invalid = markdown.replace("## Risks and Constraints\n", "## Constraints\n");
  const result = validateParleyPlanV1Document(invalid);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("## Risks and Constraints")));
});

test("validateParleyPlanV1Document rejects incomplete deferred phase metadata", () => {
  const base = createParleyPlanV1Document(validPlanInput());
  const markdown = base.replace(
    "No phases defined yet.",
    [
      "### Phase 1 — Later Work",
      "",
      "Status: deferred",
      "Owner: kairos-operator",
      "",
      "Work:",
      "- Keep this for later."
    ].join("\n")
  );

  const result = validateParleyPlanV1Document(markdown);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("Deferral reason")));
  assert.ok(result.errors.some((error) => error.includes("Activation conditions or Review trigger")));
});

test("validateParleyPlanV1Document accepts deferred phase with non-executing trigger metadata", () => {
  const markdown = createParleyPlanV1Document(validPlanInput({
    sections: {
      ...validPlanInput().sections,
      phases: [
        "### Phase 1 — Later Work",
        "",
        "Status: deferred",
        "Owner: kairos-operator",
        "",
        "Supporting agents:",
        "- kairos-operator",
        "",
        "Entry criteria:",
        "- Sensei authorizes the deferred track.",
        "",
        "Work:",
        "- Surface the activation candidate without executing it.",
        "",
        "Exit criteria:",
        "- Human decision is recorded.",
        "",
        "Review trigger:",
        "- Human asks to revisit the deferred work.",
        "",
        "Deferral reason:",
        "- Not part of the current implementation slice.",
        "",
        "Non-goals before activation:",
        "- Do not auto-execute the phase."
      ].join("\n")
    }
  }));

  const result = validateParleyPlanV1Document(markdown);
  assert.equal(result.ok, true, result.errors.join("\n"));
});
