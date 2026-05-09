import fs from "node:fs/promises";
import path from "node:path";

import { findArtifactNamespace } from "../../core/board/board.js";
import { normalizeServiceRequest } from "../context.js";
import { SERVICE_ERROR_CODES, serviceError } from "../errors.js";
import { resolveServiceCallerIdentity } from "../identity.js";
import { queryResponse } from "../responses.js";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);
const TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".css", ".html", ".xml"
]);
const MAX_FILE_BYTES = 1024 * 1024;

function value(input, snakeName, camelName = snakeName) {
  return input?.[snakeName] ?? input?.[camelName];
}

function summarizeIdentity(identity) {
  return {
    board_id: identity.board_id,
    global_agent_id: identity.global_agent_id,
    board_agent_id: identity.board_agent_id
  };
}

function normalizeStringArray(rawValue, fieldName) {
  if (rawValue == null) return [];
  if (!Array.isArray(rawValue)) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, `${fieldName} must be an array`);
  }
  return rawValue.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, `${fieldName}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
}

function normalizeQuery(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, "query is required.");
  }
  return rawValue.trim();
}

function normalizeLimit(rawValue) {
  if (rawValue == null) return 20;
  if (!Number.isInteger(rawValue) || rawValue < 0) {
    throw serviceError(SERVICE_ERROR_CODES.VALIDATION_FAILED, "limit must be a non-negative integer");
  }
  return Math.min(rawValue, 100);
}

function normalizeNamespaceIds(board, rawValue) {
  const explicit = normalizeStringArray(rawValue, "namespaces");
  if (explicit.length > 0) return [...new Set(explicit)];
  const allowed = Array.isArray(board.allowed_reference_namespaces) ? board.allowed_reference_namespaces : [];
  if (allowed.length > 0) return [...new Set(allowed)];
  return (Array.isArray(board.artifact_namespaces) ? board.artifact_namespaces : [])
    .filter((namespace) => Array.isArray(namespace.roles) && namespace.roles.includes("reference"))
    .map((namespace) => namespace.id);
}

function buildUri(namespace, relativePath) {
  const prefix = typeof namespace.uri_prefix === "string" ? namespace.uri_prefix : "";
  return `${prefix}${relativePath.split(path.sep).join("/")}`;
}

async function* walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

function isLikelyTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function scoreMatch({ query, terms, relativePath, content }) {
  const haystackPath = relativePath.toLowerCase();
  const haystack = content.toLowerCase();
  const phrase = query.toLowerCase();
  let score = 0;
  if (haystackPath.includes(phrase)) score += 50;
  if (haystack.includes(phrase)) score += 25;
  for (const term of terms) {
    if (haystackPath.includes(term)) score += 10;
    if (haystack.includes(term)) score += 3;
  }
  return score;
}

function excerptFor(content, query, terms) {
  const lower = content.toLowerCase();
  let index = lower.indexOf(query.toLowerCase());
  if (index < 0) {
    for (const term of terms) {
      index = lower.indexOf(term);
      if (index >= 0) break;
    }
  }
  if (index < 0) index = 0;
  const start = Math.max(0, index - 120);
  const end = Math.min(content.length, index + 240);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

async function searchNamespace(namespace, query, terms, limit) {
  if (typeof namespace.resolved_root !== "string" || !namespace.resolved_root.trim()) {
    throw serviceError(
      SERVICE_ERROR_CODES.VALIDATION_FAILED,
      `artifact namespace ${namespace.id} has no resolved_root for search`
    );
  }
  const root = path.normalize(namespace.resolved_root);
  const results = [];
  for await (const filePath of walkFiles(root)) {
    if (results.length >= limit * 8) break;
    if (!isLikelyTextFile(filePath)) continue;
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_BYTES) continue;
    const relativePath = path.relative(root, filePath);
    const content = await fs.readFile(filePath, "utf8");
    const score = scoreMatch({ query, terms, relativePath, content });
    if (score <= 0) continue;
    results.push({
      namespace: namespace.id,
      uri: buildUri(namespace, relativePath),
      relative_path: relativePath.split(path.sep).join("/"),
      resolved_path: filePath,
      score,
      excerpt: excerptFor(content, query, terms)
    });
  }
  return results;
}

export async function searchReferences(request = {}, deps = {}) {
  const { caller, input } = normalizeServiceRequest(request);
  const identity = resolveServiceCallerIdentity(deps.pluginConfig, caller, input);
  const query = normalizeQuery(value(input, "query"));
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = normalizeLimit(value(input, "limit"));
  const namespaceIds = normalizeNamespaceIds(identity.board, value(input, "namespaces"));
  const namespaces = namespaceIds.map((namespaceId) => findArtifactNamespace(identity.board, namespaceId, "reference"));
  const batches = [];
  for (const namespace of namespaces) {
    batches.push(...await searchNamespace(namespace, query, terms, limit));
  }
  const ranked = batches
    .sort((a, b) => b.score - a.score || a.namespace.localeCompare(b.namespace) || a.relative_path.localeCompare(b.relative_path));

  return queryResponse({
    data: {
      tool: "parley_query_search",
      identity: summarizeIdentity(identity),
      query: {
        query,
        namespaces: namespaceIds,
        limit
      },
      counts: {
        matched: ranked.length,
        returned: Math.min(ranked.length, limit),
        truncated: ranked.length > limit
      },
      results: ranked.slice(0, limit)
    }
  });
}
