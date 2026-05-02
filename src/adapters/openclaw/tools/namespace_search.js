import fs from "node:fs/promises";
import path from "node:path";

import { findArtifactNamespace } from "../../../core/board/board.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache"]);
const TEXT_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".json", ".jsonl", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".sh", ".css", ".html", ".xml"
]);
const MAX_FILE_BYTES = 1024 * 1024;

function normalizeStringArray(value, fieldName) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    return item.trim();
  });
}

function normalizeQuery(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("query required");
  return value.trim();
}

function normalizeLimit(value) {
  if (value == null) return 20;
  if (!Number.isInteger(value) || value < 0) throw new Error("limit must be a non-negative integer");
  return Math.min(value, 100);
}

function normalizeNamespaceIds(board, value) {
  const explicit = normalizeStringArray(value, "namespaces");
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
    throw new Error(`artifact namespace ${namespace.id} has no resolved_root for search`);
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

export function createNamespaceSearchAction(api) {
  return {
    name: "parley_query_search",
    label: "Parley Query Search",
    description: "Search files under board-registered reference namespaces.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "query"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        query: { type: "string", description: "Search query." },
        namespaces: { type: "array", items: { type: "string" }, description: "Optional board artifact namespace ids. Defaults to allowed reference namespaces." },
        limit: { type: "number", description: "Maximum results to return. Defaults to 20; capped at 100." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const query = normalizeQuery(params?.query);
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const limit = normalizeLimit(params?.limit);
      const namespaceIds = normalizeNamespaceIds(identity.board, params?.namespaces);
      const namespaces = namespaceIds.map((namespaceId) => findArtifactNamespace(identity.board, namespaceId, "reference"));
      const batches = [];
      for (const namespace of namespaces) {
        batches.push(...await searchNamespace(namespace, query, terms, limit));
      }
      const ranked = batches
        .sort((a, b) => b.score - a.score || a.namespace.localeCompare(b.namespace) || a.relative_path.localeCompare(b.relative_path));
      return boardResult({
        tool: "parley_query_search",
        identity,
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
      });
    }
  };
}
