function refKey(ref) {
  return `${ref.kind}:${ref.id}${ref.version == null ? "" : `@${ref.version}`}`;
}

function increment(counter, key) {
  const normalized = key ?? "unknown";
  counter[normalized] = (counter[normalized] ?? 0) + 1;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function compareEdges(a, b) {
  return a.relationship_id.localeCompare(b.relationship_id);
}

function nodeLabel(ref, artifactsById, objectsById) {
  if (ref.kind === "artifact") return artifactsById.get(ref.id)?.title ?? ref.id;
  if (ref.kind === "object") return objectsById.get(ref.id)?.title ?? ref.id;
  return ref.id;
}

export function buildRelationshipGraph(relationships, artifacts, objects) {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
  const objectsById = new Map(objects.map((object) => [object.object_id, object]));
  const nodesByKey = new Map();
  const allEdges = [];
  const byType = {};
  const byStatus = {};

  for (const relationship of relationships) {
    increment(byType, relationship.type);
    increment(byStatus, relationship.status);
    const fromKey = refKey(relationship.from);
    const toKey = refKey(relationship.to);
    allEdges.push({
      relationship_id: relationship.relationship_id,
      type: relationship.type,
      status: relationship.status,
      from: fromKey,
      to: toKey,
      reason: relationship.reason,
      source_effect_id: relationship.source_effect_id,
      removed_effect_id: relationship.removed_effect_id,
      removed_at: relationship.removed_at,
      correction_of: relationship.correction_of,
      replaces_relationship_id: relationship.replaces_relationship_id
    });
  }

  const activeEdges = allEdges.filter((edge) => edge.status === "active").sort(compareEdges);
  const inactiveEdges = allEdges.filter((edge) => edge.status !== "active").sort(compareEdges);
  for (const relationship of relationships.filter((item) => item.status === "active")) {
    for (const ref of [relationship.from, relationship.to]) {
      const key = refKey(ref);
      if (!nodesByKey.has(key)) {
        nodesByKey.set(key, {
          key,
          kind: ref.kind,
          id: ref.id,
          version: ref.version,
          label: nodeLabel(ref, artifactsById, objectsById)
        });
      }
    }
  }
  return {
    nodes: [...nodesByKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
    edges: activeEdges,
    active_edges: activeEdges,
    inactive_edges: inactiveEdges,
    counts: {
      nodes: nodesByKey.size,
      edges: activeEdges.length,
      active_edges: activeEdges.length,
      inactive_edges: inactiveEdges.length,
      by_type: sortedObject(byType),
      by_status: sortedObject(byStatus)
    }
  };
}
