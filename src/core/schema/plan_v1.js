import {
  COORDINATION_STATUSES,
  assertBoardId,
  assertNonEmptyString,
  assertObject,
  assertRecordId,
  assertIsoTimestamp
} from "../board/board_schema.js";

export const PARLEY_PLAN_V1_SCHEMA_ID = "parley.plan.v1";
export const PARLEY_PLAN_V1_ARTIFACT_KIND = "plan";

export const PLAN_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
export const PLAN_PHASE_KINDS = Object.freeze(["implementation", "review", "approval", "decision_gate", "human_checkpoint", "human_approval_gate"]);
export const HUMAN_GATE_PHASE_KINDS = Object.freeze(["human_checkpoint", "human_approval_gate"]);

export const PLAN_PHASE_STATUSES = Object.freeze([
  "draft",
  "proposed",
  "ready",
  "active",
  "blocked",
  "deferred",
  "failed",
  "complete",
  "superseded",
  "cancelled"
]);

export const PLAN_RELATIONSHIP_FIELDS = Object.freeze([
  "supersedes",
  "superseded_by",
  "extracts_from",
  "constrains",
  "constrained_by",
  "depends_on",
  "blocks",
  "blocked_by",
  "related_to"
]);

export const PLAN_PARLEY_BINDING_FIELDS = Object.freeze([
  "object_id",
  "artifact_id",
  "source_thread_id",
  "source_message_id"
]);

export const PLAN_REQUIRED_BODY_HEADINGS = Object.freeze([
  { level: 1, text: "<Title>" },
  { level: 2, text: "Purpose" },
  { level: 2, text: "Background" },
  { level: 2, text: "Scope" },
  { level: 3, text: "In Scope" },
  { level: 3, text: "Out of Scope" },
  { level: 2, text: "Current State" },
  { level: 2, text: "Target State" },
  { level: 2, text: "Plan" },
  { level: 2, text: "Phases" },
  { level: 2, text: "Acceptance Criteria" },
  { level: 2, text: "Risks and Constraints" },
  { level: 2, text: "Open Questions" },
  { level: 2, text: "Review and Approval" },
  { level: 2, text: "Change Log" }
]);

export const PARLEY_PLAN_V1_SCHEMA = Object.freeze({
  schema_id: PARLEY_PLAN_V1_SCHEMA_ID,
  artifact_kind: PARLEY_PLAN_V1_ARTIFACT_KIND,
  format: "markdown_with_yaml_frontmatter",
  required_frontmatter: Object.freeze([
    "schema",
    "artifact_kind",
    "authority",
    "plan_id",
    "board_id",
    "title",
    "status",
    "version",
    "created_at",
    "updated_at",
    "owner",
    "participants",
    "scope",
    "landing",
    "review",
    "relationships",
    "parley"
  ]),
  optional_frontmatter: Object.freeze(["priority", "coordination_mode"]),
  landing_fields: Object.freeze(["namespace", "subpath", "filename"]),
  relationship_fields: PLAN_RELATIONSHIP_FIELDS,
  parley_binding_fields: PLAN_PARLEY_BINDING_FIELDS,
  required_body_headings: PLAN_REQUIRED_BODY_HEADINGS,
  deferred_phase_rule: "Deferred phases require owner, deferral reason, non-goals before activation, and activation conditions or review trigger."
});

function validationResult(errors, details = {}) {
  return { ok: errors.length === 0, errors, ...details };
}

function addError(errors, message) {
  errors.push(message);
}

function assertAllowed(value, allowedValues, fieldName, errors) {
  if (!allowedValues.includes(value)) {
    addError(errors, `${fieldName} must be one of: ${allowedValues.join(", ")}`);
  }
}

function optionalStringOrNull(value, fieldName, errors) {
  if (value == null) return null;
  if (typeof value !== "string" || !value.trim()) {
    addError(errors, `${fieldName} must be null or a non-empty string`);
    return value;
  }
  return value.trim();
}

function validateRequiredString(value, fieldName, errors) {
  try {
    return assertNonEmptyString(value, fieldName);
  } catch (error) {
    addError(errors, error.message);
    return value;
  }
}

function validateRecordId(value, fieldName, errors) {
  try {
    return assertRecordId(value, fieldName);
  } catch (error) {
    addError(errors, error.message);
    return value;
  }
}

function validateBoardId(value, fieldName, errors) {
  try {
    return assertBoardId(value, fieldName);
  } catch (error) {
    addError(errors, error.message);
    return value;
  }
}

function validateIsoTimestamp(value, fieldName, errors) {
  try {
    return assertIsoTimestamp(value, fieldName);
  } catch (error) {
    addError(errors, error.message);
    return value;
  }
}

function validateObject(value, fieldName, errors) {
  try {
    return assertObject(value, fieldName);
  } catch (error) {
    addError(errors, error.message);
    return {};
  }
}

function validateAllowedObjectKeys(raw, fieldName, allowedKeys, errors) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) addError(errors, `${fieldName}.${key} is not allowed`);
  }
}

function validateStringArray(value, fieldName, errors, { minItems = 0 } = {}) {
  if (!Array.isArray(value)) {
    addError(errors, `${fieldName} must be an array`);
    return value;
  }
  if (value.length < minItems) {
    addError(errors, `${fieldName} must contain at least ${minItems} item${minItems === 1 ? "" : "s"}`);
  }
  value.forEach((item, index) => validateRequiredString(item, `${fieldName}[${index}]`, errors));
  return value;
}

function validatePositiveInteger(value, fieldName, errors) {
  if (!Number.isInteger(value) || value < 1) {
    addError(errors, `${fieldName} must be a positive integer`);
  }
  return value;
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function extractPlanFrontmatter(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("plan document must be a non-empty markdown string");
  }
  const normalized = normalizeLineEndings(markdown);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    throw new Error("plan document must start with YAML frontmatter delimited by ---");
  }
  return {
    yaml: match[1],
    body: normalized.slice(match[0].length)
  };
}

function lineIndent(line) {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) return JSON.parse(value);
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseKeyValue(text, lineNumber) {
  const separator = text.indexOf(":");
  if (separator < 1) throw new Error(`invalid YAML frontmatter line ${lineNumber}: expected key: value`);
  return {
    key: text.slice(0, separator).trim(),
    rest: text.slice(separator + 1).trim()
  };
}

function nextSignificantLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const text = lines[index].trim();
    if (text && !text.startsWith("#")) return { index, text, indent: lineIndent(lines[index]) };
  }
  return null;
}

function parseArrayObjectItem(lines, state, item, currentIndent) {
  if (!item) {
    state.index += 1;
    const next = nextSignificantLine(lines, state.index);
    return next && next.indent > currentIndent ? parseObject(lines, state, next.indent) : {};
  }

  const inlineObjectMatch = item.match(/^[A-Za-z_][A-Za-z0-9_-]*\s*:/);
  if (!inlineObjectMatch) {
    state.index += 1;
    return parseScalar(item);
  }

  const { key, rest } = parseKeyValue(item, state.index + 1);
  const result = {};
  state.index += 1;
  if (rest) {
    result[key] = parseScalar(rest);
  } else {
    const next = nextSignificantLine(lines, state.index);
    result[key] = next && next.indent > currentIndent ? parseObject(lines, state, next.indent) : {};
  }

  const next = nextSignificantLine(lines, state.index);
  if (next && next.indent > currentIndent) {
    Object.assign(result, parseObject(lines, state, next.indent));
  }
  return result;
}

function parseArray(lines, state, indent) {
  const result = [];
  while (state.index < lines.length) {
    const raw = lines[state.index];
    const text = raw.trim();
    if (!text || text.startsWith("#")) {
      state.index += 1;
      continue;
    }
    const currentIndent = lineIndent(raw);
    if (currentIndent < indent) break;
    if (currentIndent > indent) throw new Error(`invalid YAML frontmatter line ${state.index + 1}: unexpected indentation`);
    if (!text.startsWith("- ")) break;
    const item = text.slice(2).trim();
    result.push(parseArrayObjectItem(lines, state, item, currentIndent));
  }
  return result;
}

function parseObject(lines, state, indent) {
  const result = {};
  while (state.index < lines.length) {
    const raw = lines[state.index];
    const text = raw.trim();
    if (!text || text.startsWith("#")) {
      state.index += 1;
      continue;
    }
    const currentIndent = lineIndent(raw);
    if (currentIndent < indent) break;
    if (currentIndent > indent) throw new Error(`invalid YAML frontmatter line ${state.index + 1}: unexpected indentation`);
    if (text.startsWith("- ")) break;

    const { key, rest } = parseKeyValue(text, state.index + 1);
    state.index += 1;
    if (rest) {
      result[key] = parseScalar(rest);
      continue;
    }

    const next = nextSignificantLine(lines, state.index);
    if (!next || next.indent <= currentIndent) {
      result[key] = {};
      continue;
    }
    if (next.text.startsWith("- ")) {
      result[key] = parseArray(lines, state, next.indent);
    } else {
      result[key] = parseObject(lines, state, next.indent);
    }
  }
  return result;
}

export function parsePlanFrontmatterYaml(yaml) {
  if (typeof yaml !== "string") throw new Error("frontmatter YAML must be a string");
  const lines = normalizeLineEndings(yaml).split("\n");
  const state = { index: 0 };
  const parsed = parseObject(lines, state, 0);
  const remaining = nextSignificantLine(lines, state.index);
  if (remaining) throw new Error(`invalid YAML frontmatter line ${remaining.index + 1}: could not parse line`);
  return parsed;
}

export function parseParleyPlanV1Document(markdown) {
  const { yaml, body } = extractPlanFrontmatter(markdown);
  return {
    frontmatter: parsePlanFrontmatterYaml(yaml),
    body
  };
}

export function validateParleyPlanV1Frontmatter(frontmatter) {
  const errors = [];
  const raw = validateObject(frontmatter, "frontmatter", errors);

  if (raw.schema !== PARLEY_PLAN_V1_SCHEMA_ID) addError(errors, `schema must be ${PARLEY_PLAN_V1_SCHEMA_ID}`);
  if (raw.artifact_kind !== PARLEY_PLAN_V1_ARTIFACT_KIND) addError(errors, "artifact_kind must be plan");

  validateRequiredString(raw.authority, "authority", errors);
  validateRecordId(raw.plan_id, "plan_id", errors);
  validateBoardId(raw.board_id, "board_id", errors);
  validateRequiredString(raw.title, "title", errors);
  validateRequiredString(raw.owner, "owner", errors);
  validateIsoTimestamp(raw.created_at, "created_at", errors);
  validateIsoTimestamp(raw.updated_at, "updated_at", errors);
  validatePositiveInteger(raw.version, "version", errors);
  assertAllowed(raw.status, COORDINATION_STATUSES, "status", errors);

  if (raw.priority != null) assertAllowed(raw.priority, PLAN_PRIORITIES, "priority", errors);
  validateAllowedObjectKeys(raw, "frontmatter", [
    ...PARLEY_PLAN_V1_SCHEMA.required_frontmatter,
    ...PARLEY_PLAN_V1_SCHEMA.optional_frontmatter
  ], errors);
  if (raw.coordination_mode != null) validateRequiredString(raw.coordination_mode, "coordination_mode", errors);

  validateStringArray(raw.participants, "participants", errors, { minItems: 1 });

  const scope = validateObject(raw.scope, "scope", errors);
  validateRequiredString(scope.summary, "scope.summary", errors);
  validateStringArray(scope.in, "scope.in", errors, { minItems: 1 });
  validateStringArray(scope.out, "scope.out", errors, { minItems: 1 });

  const landing = validateObject(raw.landing, "landing", errors);
  validateRequiredString(landing.namespace, "landing.namespace", errors);
  validateRequiredString(landing.subpath, "landing.subpath", errors);
  validateRequiredString(landing.filename, "landing.filename", errors);
  if (typeof landing.filename === "string" && !landing.filename.endsWith(".md")) {
    addError(errors, "landing.filename must use the .md extension");
  }

  const review = validateObject(raw.review, "review", errors);
  validateStringArray(review.required_reviewers, "review.required_reviewers", errors);
  validateStringArray(review.approvals, "review.approvals", errors);
  validateStringArray(review.objections, "review.objections", errors);

  const relationships = validateObject(raw.relationships, "relationships", errors);
  for (const field of PLAN_RELATIONSHIP_FIELDS) {
    validateStringArray(relationships[field], `relationships.${field}`, errors);
  }

  const parley = validateObject(raw.parley, "parley", errors);
  for (const field of PLAN_PARLEY_BINDING_FIELDS) {
    optionalStringOrNull(parley[field], `parley.${field}`, errors);
  }

  return validationResult(errors, { frontmatter: raw });
}

export function collectMarkdownHeadings(body) {
  return normalizeLineEndings(body)
    .split("\n")
    .map((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!match) return null;
      return { level: match[1].length, text: match[2].trim(), line: index + 1 };
    })
    .filter(Boolean);
}

function findRequiredHeadingSequence(headings, title, errors) {
  let cursor = 0;
  for (const required of PLAN_REQUIRED_BODY_HEADINGS) {
    const expectedText = required.text === "<Title>" ? title : required.text;
    const foundIndex = headings.findIndex((heading, index) => (
      index >= cursor && heading.level === required.level && heading.text === expectedText
    ));
    if (foundIndex === -1) {
      addError(errors, `body heading required in order: ${"#".repeat(required.level)} ${expectedText}`);
      continue;
    }
    cursor = foundIndex + 1;
  }
}

function sectionBounds(bodyLines, startHeadingPattern, endHeadingPattern) {
  const start = bodyLines.findIndex((line) => startHeadingPattern.test(line));
  if (start === -1) return null;
  const endOffset = bodyLines.slice(start + 1).findIndex((line) => endHeadingPattern.test(line));
  const end = endOffset === -1 ? bodyLines.length : start + 1 + endOffset;
  return { start, end };
}

export function parsePlanPhaseField(block, label) {
  const lines = block.split("\n");
  const labelPattern = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
  const start = lines.findIndex((line) => labelPattern.test(line.trim()));
  if (start === -1) return null;
  const firstLineRemainder = lines[start].replace(labelPattern, "").trim();
  const collected = [];
  if (firstLineRemainder) collected.push(firstLineRemainder);
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^#{1,6}\s+/.test(trimmed)) break;
    if (/^[A-Z][A-Za-z -]+:/.test(trimmed)) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function hasConcretePhaseContent(value) {
  if (value == null) return false;
  const cleaned = value
    .replace(/<!--.*?-->/gs, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !["- ...", "...", "- TBD", "TBD"].includes(line));
  return cleaned.length > 0;
}

function phaseBlocksFromBody(body) {
  const bodyLines = normalizeLineEndings(body).split("\n");
  const bounds = sectionBounds(bodyLines, /^##\s+Phases\s*$/, /^##\s+Acceptance Criteria\s*$/);
  if (!bounds) return [];
  const phaseSection = bodyLines.slice(bounds.start + 1, bounds.end).join("\n");
  const phaseMatches = [...phaseSection.matchAll(/^###\s+Phase\s+[^\n]*$/gm)];
  return phaseMatches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < phaseMatches.length ? phaseMatches[index + 1].index : phaseSection.length;
    return {
      heading: match[0].trim(),
      block: phaseSection.slice(start, end),
      index
    };
  });
}

function validatePhaseBlocks(body, errors) {
  const phaseBlocks = phaseBlocksFromBody(body);
  for (const phaseBlock of phaseBlocks) {
    const block = phaseBlock.block;
    const titleLine = phaseBlock.heading;
    const kind = parsePlanPhaseField(block, "Kind") ?? "implementation";
    const status = parsePlanPhaseField(block, "Status");
    const owner = parsePlanPhaseField(block, "Owner");
    if (kind != null) assertAllowed(kind, PLAN_PHASE_KINDS, `${titleLine} kind`, errors);
    if (status != null) assertAllowed(status, PLAN_PHASE_STATUSES, `${titleLine} status`, errors);
    if (HUMAN_GATE_PHASE_KINDS.includes(kind)) {
      if (!hasConcretePhaseContent(owner)) addError(errors, `${titleLine} human gate phase requires Owner`);
      if (!hasConcretePhaseContent(parsePlanPhaseField(block, "Required from"))) {
        addError(errors, `${titleLine} human gate phase requires Required from`);
      }
    }
    if (status === "deferred") {
      if (!hasConcretePhaseContent(owner)) addError(errors, `${titleLine} deferred phase requires Owner`);
      if (!hasConcretePhaseContent(parsePlanPhaseField(block, "Deferral reason"))) {
        addError(errors, `${titleLine} deferred phase requires Deferral reason`);
      }
      if (!hasConcretePhaseContent(parsePlanPhaseField(block, "Non-goals before activation"))) {
        addError(errors, `${titleLine} deferred phase requires Non-goals before activation`);
      }
      const hasActivationConditions = hasConcretePhaseContent(parsePlanPhaseField(block, "Activation conditions"));
      const hasReviewTrigger = hasConcretePhaseContent(parsePlanPhaseField(block, "Review trigger"));
      if (!hasActivationConditions && !hasReviewTrigger) {
        addError(errors, `${titleLine} deferred phase requires Activation conditions or Review trigger`);
      }
    }
  }
}

function slugifyPhaseId(heading, index) {
  const match = heading.match(/^###\s+Phase\s+([^—-]+)(?:[—-]\s*(.+))?$/);
  const phaseNumber = match?.[1]?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return phaseNumber ? `phase_${phaseNumber}` : `phase_${index + 1}`;
}

function phaseTitle(heading) {
  const match = heading.match(/^###\s+Phase\s+[^—-]+[—-]\s*(.+)$/);
  return match?.[1]?.trim() ?? heading.replace(/^###\s+/, "").trim();
}

function stringListFromField(value) {
  if (!hasConcretePhaseContent(value)) return [];
  return value
    .replace(/<!--.*?-->/gs, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !["...", "TBD"].includes(line));
}

export function collectParleyPlanV1Phases(markdownOrBody, options = {}) {
  const body = options.bodyOnly === true ? markdownOrBody : parseParleyPlanV1Document(markdownOrBody).body;
  return phaseBlocksFromBody(body).map((phaseBlock) => {
    const status = parsePlanPhaseField(phaseBlock.block, "Status") ?? "proposed";
    const owner = parsePlanPhaseField(phaseBlock.block, "Owner");
    return {
      phase_id: slugifyPhaseId(phaseBlock.heading, phaseBlock.index),
      title: phaseTitle(phaseBlock.heading),
      heading: phaseBlock.heading,
      kind: parsePlanPhaseField(phaseBlock.block, "Kind") ?? "implementation",
      status,
      owner: hasConcretePhaseContent(owner) ? owner.trim() : null,
      required_from: parsePlanPhaseField(phaseBlock.block, "Required from"),
      requested_decision: parsePlanPhaseField(phaseBlock.block, "Requested decision"),
      due_at: parsePlanPhaseField(phaseBlock.block, "Due at"),
      supporting_agents: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Supporting agents")),
      entry_criteria: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Entry criteria")),
      work: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Work")),
      exit_criteria: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Exit criteria")),
      activation_conditions: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Activation conditions")),
      review_trigger: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Review trigger")),
      deferral_reason: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Deferral reason")),
      non_goals_before_activation: stringListFromField(parsePlanPhaseField(phaseBlock.block, "Non-goals before activation"))
    };
  });
}

export function collectParleyPlanV1DeferredPhases(markdownOrBody, options = {}) {
  return collectParleyPlanV1Phases(markdownOrBody, options).filter((phase) => phase.status === "deferred");
}

export function validateParleyPlanV1Body(body, frontmatter) {
  const errors = [];
  if (typeof body !== "string" || !body.trim()) {
    addError(errors, "body must be non-empty markdown");
    return validationResult(errors, { headings: [] });
  }
  const headings = collectMarkdownHeadings(body);
  findRequiredHeadingSequence(headings, frontmatter?.title, errors);
  validatePhaseBlocks(body, errors);
  return validationResult(errors, { headings });
}

export function validateParleyPlanV1Document(markdown) {
  const errors = [];
  let parsed;
  try {
    parsed = parseParleyPlanV1Document(markdown);
  } catch (error) {
    return validationResult([error.message], { frontmatter: null, headings: [] });
  }

  const frontmatterResult = validateParleyPlanV1Frontmatter(parsed.frontmatter);
  errors.push(...frontmatterResult.errors);
  const bodyResult = validateParleyPlanV1Body(parsed.body, parsed.frontmatter);
  errors.push(...bodyResult.errors);

  return validationResult(errors, {
    frontmatter: parsed.frontmatter,
    headings: bodyResult.headings
  });
}

export function assertParleyPlanV1Document(markdown) {
  const result = validateParleyPlanV1Document(markdown);
  if (!result.ok) {
    throw new Error(`invalid ${PARLEY_PLAN_V1_SCHEMA_ID} document: ${result.errors.join("; ")}`);
  }
  return result;
}

function yamlScalar(value) {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const raw = String(value);
  if (!raw || /[:#\n]|^[-{}[\],&*?]|\s$|^\s/.test(raw)) return JSON.stringify(raw);
  return raw;
}

function yamlArrayLines(key, item, indent) {
  const spaces = " ".repeat(indent);
  if (item.length === 0) return [`${spaces}${key}: []`];
  const lines = [`${spaces}${key}:`];
  for (const entry of item) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const entries = Object.entries(entry);
      if (entries.length === 0) {
        lines.push(`${spaces}  - {}`);
        continue;
      }
      const [[firstKey, firstValue], ...rest] = entries;
      if (firstValue && typeof firstValue === "object") {
        lines.push(`${spaces}  - ${firstKey}:`);
        lines.push(...yamlLinesForObject(firstValue, indent + 4));
      } else {
        lines.push(`${spaces}  - ${firstKey}: ${yamlScalar(firstValue)}`);
      }
      for (const [restKey, restValue] of rest) {
        if (Array.isArray(restValue)) {
          lines.push(...yamlArrayLines(restKey, restValue, indent + 4));
        } else if (restValue && typeof restValue === "object") {
          lines.push(`${spaces}    ${restKey}:`);
          lines.push(...yamlLinesForObject(restValue, indent + 6));
        } else {
          lines.push(`${spaces}    ${restKey}: ${yamlScalar(restValue)}`);
        }
      }
    } else {
      lines.push(`${spaces}  - ${yamlScalar(entry)}`);
    }
  }
  return lines;
}

function yamlLinesForObject(value, indent = 0) {
  const spaces = " ".repeat(indent);
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      lines.push(...yamlArrayLines(key, item, indent));
    } else if (item && typeof item === "object") {
      lines.push(`${spaces}${key}:`);
      lines.push(...yamlLinesForObject(item, indent + 2));
    } else {
      lines.push(`${spaces}${key}: ${yamlScalar(item)}`);
    }
  }
  return lines;
}

function defaultRelationships() {
  return Object.fromEntries(PLAN_RELATIONSHIP_FIELDS.map((field) => [field, []]));
}

function defaultParleyBindings() {
  return Object.fromEntries(PLAN_PARLEY_BINDING_FIELDS.map((field) => [field, null]));
}

function listBodySection(items, fallback = "TBD") {
  if (!Array.isArray(items)) return bodySection(items, fallback);
  const lines = items.map((item) => {
    if (item == null) return null;
    if (typeof item === "string") return item.trim();
    return JSON.stringify(item);
  }).filter(Boolean);
  if (lines.length === 0) return fallback;
  return lines.map((line) => (line.startsWith("-") || line.startsWith("#") ? line : `- ${line}`)).join("\n");
}

function phaseItemBodySection(phase, index) {
  if (typeof phase === "string") return phase.trim();
  if (phase == null || typeof phase !== "object" || Array.isArray(phase)) return String(phase ?? "").trim();
  const title = phase.title ?? `Phase ${index + 1}`;
  const requiredFrom = phase.requiredFrom ?? phase.required_from ?? "N/A";
  const requestedDecision = phase.requestedDecision ?? phase.requested_decision ?? "N/A";
  const dueAt = phase.dueAt ?? phase.due_at ?? "N/A";
  return [
    `### Phase ${index + 1} — ${title}`,
    "",
    `Kind: ${phase.kind ?? phase.type ?? "implementation"}`,
    `Status: ${phase.status ?? "draft"}`,
    `Owner: ${phase.owner ?? phase.shepherd ?? "TBD"}`,
    "",
    "Required from:",
    requiredFrom,
    "",
    "Requested decision:",
    requestedDecision,
    "",
    "Due at:",
    dueAt,
    "",
    "Entry criteria:",
    listBodySection(phase.entryCriteria ?? phase.entry_criteria),
    "",
    "Work:",
    listBodySection(phase.work),
    "",
    "Exit criteria:",
    listBodySection(phase.exitCriteria ?? phase.exit_criteria),
    "",
    "Supporting agents:",
    listBodySection(phase.supportingAgents ?? phase.supporting_agents, "None."),
    "",
    "Activation conditions:",
    listBodySection(phase.activationConditions ?? phase.activation_conditions),
    "",
    "Review trigger:",
    listBodySection(phase.reviewTrigger ?? phase.review_trigger),
    "",
    "Deferral reason:",
    listBodySection(phase.deferralReason ?? phase.deferral_reason),
    "",
    "Non-goals before activation:",
    listBodySection(phase.nonGoalsBeforeActivation ?? phase.non_goals_before_activation)
  ].join("\n");
}

function phaseBodySection(value, fallback = "No phases defined yet.") {
  if (Array.isArray(value)) {
    const phases = value.map(phaseItemBodySection).filter(Boolean);
    return phases.length === 0 ? fallback : phases.join("\n\n");
  }
  return bodySection(value, fallback);
}

function bodySection(value, fallback = "TBD") {
  if (value == null || value === "") return fallback;
  if (Array.isArray(value)) return listBodySection(value, fallback);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).trim();
}

export function createParleyPlanV1Document(input) {
  const raw = validateObject(input, "plan input", []);
  const now = new Date().toISOString();
  const frontmatter = {
    schema: PARLEY_PLAN_V1_SCHEMA_ID,
    artifact_kind: PARLEY_PLAN_V1_ARTIFACT_KIND,
    authority: raw.authority,
    plan_id: raw.plan_id,
    board_id: raw.board_id,
    title: raw.title,
    status: raw.status ?? "draft",
    version: raw.version ?? 1,
    created_at: raw.created_at ?? now,
    updated_at: raw.updated_at ?? raw.created_at ?? now,
    owner: raw.owner,
    participants: raw.participants,
    scope: raw.scope,
    landing: raw.landing,
    review: raw.review ?? { required_reviewers: [], approvals: [], objections: [] },
    relationships: raw.relationships ?? defaultRelationships(),
    parley: raw.parley ?? defaultParleyBindings()
  };

  if (raw.priority != null) frontmatter.priority = raw.priority;
  if (raw.coordination_mode != null) frontmatter.coordination_mode = raw.coordination_mode;

  const sections = raw.sections ?? {};
  const markdown = [
    "---",
    ...yamlLinesForObject(frontmatter),
    "---",
    "",
    `# ${frontmatter.title}`,
    "",
    "## Purpose",
    "",
    bodySection(sections.purpose),
    "",
    "## Background",
    "",
    bodySection(sections.background),
    "",
    "## Scope",
    "",
    bodySection(sections.scope),
    "",
    "### In Scope",
    "",
    frontmatter.scope.in.map((item) => `- ${item}`).join("\n"),
    "",
    "### Out of Scope",
    "",
    frontmatter.scope.out.map((item) => `- ${item}`).join("\n"),
    "",
    "## Current State",
    "",
    bodySection(sections.current_state),
    "",
    "## Target State",
    "",
    bodySection(sections.target_state),
    "",
    "## Plan",
    "",
    bodySection(sections.plan),
    "",
    "## Phases",
    "",
    phaseBodySection(sections.phases, "No phases defined yet."),
    "",
    "## Acceptance Criteria",
    "",
    bodySection(sections.acceptance_criteria),
    "",
    "## Risks and Constraints",
    "",
    bodySection(sections.risks_and_constraints),
    "",
    "## Open Questions",
    "",
    bodySection(sections.open_questions, "None recorded."),
    "",
    "## Review and Approval",
    "",
    bodySection(sections.review_and_approval, "No review recorded yet."),
    "",
    "## Change Log",
    "",
    bodySection(sections.change_log, `- v${frontmatter.version}: Initial plan document.`),
    ""
  ].join("\n");

  assertParleyPlanV1Document(markdown);
  return markdown;
}
