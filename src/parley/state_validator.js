import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertArtifactRecord,
  assertCoordinationObjectRecord,
  assertEffectRecord,
  assertObligationRecord,
  assertProjectionCheckpointRecord,
  assertRelationshipRecord
} from "./board_schema.js";

const COLLECTIONS = Object.freeze([
  { name: "artifacts", idField: "artifact_id", validator: assertArtifactRecord },
  { name: "objects", idField: "object_id", validator: assertCoordinationObjectRecord },
  { name: "effects", idField: "effect_id", validator: assertEffectRecord },
  { name: "obligations", idField: "obligation_id", validator: assertObligationRecord },
  { name: "relationships", idField: "relationship_id", validator: assertRelationshipRecord },
  { name: "checkpoints", idField: null, validator: assertProjectionCheckpointRecord }
]);

const ENDPOINT_TYPES = Object.freeze({ artifact: "artifact_id", object: "object_id" });
const WARNING_CYCLE_TYPES = new Set(["depends_on", "blocks"]);
const ERROR_CYCLE_TYPES = new Set(["supersedes"]);

function diagnostic(severity, code, message, details = {}) {
  return { severity, code, message, details };
}

function pushError(result, code, message, details = {}) {
  result.errors.push(diagnostic("error", code, message, details));
}

function pushWarning(result, code, message, details = {}) {
  result.warnings.push(diagnostic("warning", code, message, details));
}

function pushInfo(result, code, message, details = {}) {
  result.info.push(diagnostic("info", code, message, details));
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function listCollectionFiles(board, collectionName) {
  const dirPath = path.join(board.state_root, collectionName);
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => ({ name: entry.name, path: path.join(dirPath, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeFileId(fileName) {
  return fileName.replace(/\.json$/, "");
}

function refKey(ref) {
  return `${ref.kind}:${ref.id}${ref.version == null ? "" : `@${ref.version}`}`;
}

function recordKey(collectionName, id) {
  return `${collectionName}:${id}`;
}

function artifactById(records) {
  return new Map(records.map((record) => [record.artifact_id, record]));
}

function objectById(records) {
  return new Map(records.map((record) => [record.object_id, record]));
}

function relationshipEndpointExists(endpoint, artifacts, objects) {
  if (endpoint.kind === "artifact") return artifacts.has(endpoint.id);
  if (endpoint.kind === "object") return objects.has(endpoint.id);
  return false;
}

function validateEndpointVersion(result, relationship, endpoint, artifacts, fieldName) {
  if (endpoint.kind !== "artifact" || endpoint.version == null) return;
  const artifact = artifacts.get(endpoint.id);
  if (artifact == null) return;
  if (artifact.version !== endpoint.version) {
    pushWarning(
      result,
      "relationship_endpoint_version_mismatch",
      `relationship ${relationship.relationship_id} ${fieldName} references artifact version ${endpoint.version}, current record is version ${artifact.version}`,
      { relationship_id: relationship.relationship_id, field: fieldName, artifact_id: endpoint.id, referenced_version: endpoint.version, current_version: artifact.version }
    );
  }
}

function hashContent(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function validateArtifactHash(result, artifact) {
  if (artifact.content_hash == null || artifact.resolved_path == null) return;
  if (!artifact.content_hash.startsWith("sha256:")) {
    pushWarning(result, "artifact_hash_unsupported", `artifact ${artifact.artifact_id} uses unsupported content_hash format`, {
      artifact_id: artifact.artifact_id,
      content_hash: artifact.content_hash
    });
    return;
  }
  try {
    const body = await fs.readFile(artifact.resolved_path);
    const actual = hashContent(body);
    if (actual !== artifact.content_hash) {
      pushWarning(result, "artifact_hash_mismatch", `artifact ${artifact.artifact_id} content hash does not match resolved body`, {
        artifact_id: artifact.artifact_id,
        resolved_path: artifact.resolved_path,
        expected: artifact.content_hash,
        actual
      });
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      pushWarning(result, "artifact_body_missing", `artifact ${artifact.artifact_id} resolved body is missing`, {
        artifact_id: artifact.artifact_id,
        resolved_path: artifact.resolved_path
      });
      return;
    }
    throw error;
  }
}

function addEdge(graph, from, to, relationship) {
  const list = graph.get(from) ?? [];
  list.push({ to, relationship_id: relationship.relationship_id });
  graph.set(from, list);
}

function findCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return stack.slice(start).concat(node);
    }
    if (visited.has(node)) return null;
    visiting.add(node);
    stack.push(node);
    for (const edge of graph.get(node) ?? []) {
      const cycle = visit(edge.to);
      if (cycle != null) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle != null) return cycle;
  }
  return null;
}

function validateRelationshipCycles(result, relationships) {
  const active = relationships.filter((relationship) => relationship.status === "active");
  for (const [relationshipType, severity] of [
    ...[...WARNING_CYCLE_TYPES].map((type) => [type, "warning"]),
    ...[...ERROR_CYCLE_TYPES].map((type) => [type, "error"])
  ]) {
    const graph = new Map();
    for (const relationship of active.filter((item) => item.type === relationshipType)) {
      addEdge(graph, refKey(relationship.from), refKey(relationship.to), relationship);
    }
    const cycle = findCycle(graph);
    if (cycle == null) continue;
    const details = { relationship_type: relationshipType, cycle_path: cycle };
    if (severity === "error") {
      pushError(result, "relationship_cycle", `${relationshipType} relationship cycle detected`, details);
    } else {
      pushWarning(result, "relationship_cycle", `${relationshipType} relationship cycle detected`, details);
    }
  }
}

function validateReferences(result, recordsByCollection) {
  const artifacts = artifactById(recordsByCollection.artifacts);
  const objects = objectById(recordsByCollection.objects);
  const effects = new Map(recordsByCollection.effects.map((record) => [record.effect_id, record]));

  for (const object of recordsByCollection.objects) {
    if (object.artifact_ref == null) continue;
    const artifact = artifacts.get(object.artifact_ref.artifact_id);
    if (artifact == null) {
      pushError(result, "object_artifact_ref_missing", `object ${object.object_id} references missing artifact ${object.artifact_ref.artifact_id}`, {
        object_id: object.object_id,
        artifact_id: object.artifact_ref.artifact_id
      });
    } else if (artifact.version !== object.artifact_ref.version) {
      pushWarning(result, "object_artifact_ref_version_mismatch", `object ${object.object_id} references artifact version ${object.artifact_ref.version}, current record is version ${artifact.version}`, {
        object_id: object.object_id,
        artifact_id: object.artifact_ref.artifact_id,
        referenced_version: object.artifact_ref.version,
        current_version: artifact.version
      });
    }
  }

  for (const relationship of recordsByCollection.relationships) {
    for (const fieldName of ["from", "to"]) {
      const endpoint = relationship[fieldName];
      if (relationship.status === "active" && !relationshipEndpointExists(endpoint, artifacts, objects)) {
        pushError(result, "relationship_endpoint_missing", `relationship ${relationship.relationship_id} ${fieldName} endpoint is missing`, {
          relationship_id: relationship.relationship_id,
          field: fieldName,
          endpoint
        });
      }
      validateEndpointVersion(result, relationship, endpoint, artifacts, fieldName);
    }
    if (relationship.source_effect_id != null && !effects.has(relationship.source_effect_id)) {
      pushError(result, "relationship_source_effect_missing", `relationship ${relationship.relationship_id} source effect is missing`, {
        relationship_id: relationship.relationship_id,
        source_effect_id: relationship.source_effect_id
      });
    }
    if (relationship.removed_effect_id != null && !effects.has(relationship.removed_effect_id)) {
      pushError(result, "relationship_removed_effect_missing", `relationship ${relationship.relationship_id} removed effect is missing`, {
        relationship_id: relationship.relationship_id,
        removed_effect_id: relationship.removed_effect_id
      });
    }
  }

  for (const obligation of recordsByCollection.obligations) {
    if (obligation.source_effect_id != null && !effects.has(obligation.source_effect_id)) {
      pushError(result, "obligation_source_effect_missing", `obligation ${obligation.obligation_id} source effect is missing`, {
        obligation_id: obligation.obligation_id,
        source_effect_id: obligation.source_effect_id
      });
    }
    const target = obligation.target ?? {};
    if (target.artifact_id != null && !artifacts.has(target.artifact_id)) {
      pushError(result, "obligation_target_artifact_missing", `obligation ${obligation.obligation_id} target artifact is missing`, {
        obligation_id: obligation.obligation_id,
        artifact_id: target.artifact_id
      });
    }
    if (target.object_id != null && !objects.has(target.object_id)) {
      pushError(result, "obligation_target_object_missing", `obligation ${obligation.obligation_id} target object is missing`, {
        obligation_id: obligation.obligation_id,
        object_id: target.object_id
      });
    }
  }

  for (const effect of recordsByCollection.effects) {
    const target = effect.target ?? {};
    if (target.artifact_id != null && !artifacts.has(target.artifact_id)) {
      pushError(result, "effect_target_artifact_missing", `effect ${effect.effect_id} target artifact is missing`, {
        effect_id: effect.effect_id,
        artifact_id: target.artifact_id
      });
    }
    if (target.object_id != null && !objects.has(target.object_id)) {
      pushError(result, "effect_target_object_missing", `effect ${effect.effect_id} target object is missing`, {
        effect_id: effect.effect_id,
        object_id: target.object_id
      });
    }
    if (target.relationship_id != null && !recordsByCollection.relationships.some((relationship) => relationship.relationship_id === target.relationship_id)) {
      pushWarning(result, "effect_target_relationship_missing", `effect ${effect.effect_id} target relationship is missing`, {
        effect_id: effect.effect_id,
        relationship_id: target.relationship_id
      });
    }
  }
}

export async function validateParleyBoardState(_pluginConfig, board, _options = {}) {
  const result = {
    board_id: board.board_id,
    ok: true,
    errors: [],
    warnings: [],
    info: [],
    counts: {},
    records: {}
  };
  const recordsByCollection = Object.fromEntries(COLLECTIONS.map((collection) => [collection.name, []]));
  const globalIds = new Map();

  for (const collection of COLLECTIONS) {
    const files = await listCollectionFiles(board, collection.name);
    result.counts[collection.name] = files.length;
    result.records[collection.name] = { files: files.length, valid: 0, invalid: 0 };
    const idsInCollection = new Map();

    for (const file of files) {
      let raw;
      try {
        raw = await readJsonFile(file.path);
      } catch (error) {
        result.records[collection.name].invalid += 1;
        pushError(result, "record_json_invalid", `${collection.name}/${file.name} is not valid JSON`, { collection: collection.name, file: file.name, error: error.message });
        continue;
      }

      let validated;
      try {
        validated = collection.validator(raw);
      } catch (error) {
        result.records[collection.name].invalid += 1;
        pushError(result, "record_schema_invalid", `${collection.name}/${file.name} failed schema validation`, { collection: collection.name, file: file.name, error: error.message });
        continue;
      }

      result.records[collection.name].valid += 1;
      recordsByCollection[collection.name].push(validated);
      if (validated.board_id !== board.board_id) {
        pushError(result, "record_board_mismatch", `${collection.name}/${file.name} belongs to board ${validated.board_id}`, {
          collection: collection.name,
          file: file.name,
          board_id: validated.board_id,
          expected_board_id: board.board_id
        });
      }

      if (collection.idField != null) {
        const id = validated[collection.idField];
        const fileId = normalizeFileId(file.name);
        if (fileId !== id) {
          pushError(result, "record_filename_id_mismatch", `${collection.name}/${file.name} contains ${collection.idField} ${id}`, {
            collection: collection.name,
            file: file.name,
            id_field: collection.idField,
            id
          });
        }
        if (idsInCollection.has(id)) {
          pushError(result, "record_duplicate_id", `${collection.name} duplicate id ${id}`, {
            collection: collection.name,
            id,
            files: [idsInCollection.get(id), file.name]
          });
        }
        idsInCollection.set(id, file.name);
        const prior = globalIds.get(id);
        if (prior != null) {
          pushError(result, "record_id_reused", `record id ${id} is reused across board collections`, {
            id,
            first: prior,
            second: recordKey(collection.name, id)
          });
        }
        globalIds.set(id, recordKey(collection.name, id));
      }
    }
  }

  validateReferences(result, recordsByCollection);
  validateRelationshipCycles(result, recordsByCollection.relationships);
  for (const artifact of recordsByCollection.artifacts) {
    await validateArtifactHash(result, artifact);
  }

  const permissionMode = board.permission_model?.mode ?? "unknown";
  if (permissionMode === "board_wide_all_tools") {
    pushInfo(result, "permission_model_advisory", "board_wide_all_tools does not enforce fine-grained Parley permissions", {
      permission_model: permissionMode,
      fine_grained_permissions_enforced: false
    });
  }

  result.ok = result.errors.length === 0;
  return result;
}
