import fs from "node:fs/promises";
import path from "node:path";

import { contentHash } from "../../core/plan/projection.js";

const MIRROR_METADATA_SCHEMA = "parley.projection_mirror.v1";
const REPO_PLANS_URI_PREFIX = "repo://plans/";

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function isUnderRoot(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath);
  const root = path.resolve(rootPath);
  const relative = path.relative(root, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function splitSafeRelativePath(value, fieldName) {
  if (value == null || value === "") return [];
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  if (value.includes("\0") || path.isAbsolute(value)) throw new Error(`${fieldName} must be a safe relative path`);
  return value.split(/[\\/]+/).filter(Boolean).map((part) => {
    if (part === "." || part === "..") throw new Error(`${fieldName} contains an unsafe path segment`);
    return part;
  });
}

function projectionRelativeParts(projection) {
  if (typeof projection?.uri === "string" && projection.uri.startsWith(REPO_PLANS_URI_PREFIX)) {
    const repoSubpath = projection.uri.slice("repo://".length);
    return { parts: splitSafeRelativePath(repoSubpath, "projection.uri") };
  }

  const namespace = projection?.namespace;
  const filename = projection?.filename;
  if (typeof namespace !== "string" || !namespace.trim() || typeof filename !== "string" || !filename.trim()) {
    return { skipped: "missing_projection_namespace_or_filename" };
  }
  return {
    parts: [
      ...splitSafeRelativePath(namespace.trim(), "projection.namespace"),
      ...splitSafeRelativePath(projection.subpath ?? "", "projection.subpath"),
      ...splitSafeRelativePath(filename.trim(), "projection.filename")
    ]
  };
}

function metadataPathFor(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.parley-mirror.json`);
}

async function readExistingFile(targetPath) {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) return { symlink: true };
    if (!stat.isFile()) return { notFile: true };
    const body = await fs.readFile(targetPath, "utf8");
    return { body, digest: contentHash(body) };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readMetadata(targetPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(metadataPathFor(targetPath), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeFileAtomic(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, content, { encoding: "utf8", flag: "wx" });
  await fs.rename(tempPath, targetPath);
}

async function writeMetadata(targetPath, projection, contentDigest) {
  const metadata = {
    schema: MIRROR_METADATA_SCHEMA,
    generatedBy: "parley",
    kind: projection.kind,
    uri: projection.uri,
    contentDigest,
    updatedAt: new Date().toISOString()
  };
  await writeFileAtomic(metadataPathFor(targetPath), `${JSON.stringify(metadata, null, 2)}\n`);
}

async function materializePlanProjection(projection, mirrorRoot) {
  if (projection?.kind !== "plan_markdown" || typeof projection?.body !== "string") return null;
  const relative = projectionRelativeParts(projection);
  if (relative.skipped) return { status: "skipped", reason: relative.skipped };
  const root = path.resolve(mirrorRoot);
  const targetPath = path.resolve(root, ...relative.parts);
  if (!isUnderRoot(targetPath, root)) return { status: "skipped", reason: "projection_path_outside_mirror_root" };

  const contentDigest = projection.contentDigest ?? contentHash(projection.body);
  const existing = await readExistingFile(targetPath);
  if (existing?.symlink) return { status: "skipped", reason: "local_mirror_target_is_symlink", localPath: targetPath };
  if (existing?.notFile) return { status: "skipped", reason: "local_mirror_target_is_not_file", localPath: targetPath };

  if (existing != null) {
    if (existing.digest === contentDigest) {
      await writeMetadata(targetPath, projection, contentDigest);
      return { status: "unchanged", localPath: targetPath, contentDigest };
    }
    const metadata = await readMetadata(targetPath);
    if (metadata?.schema !== MIRROR_METADATA_SCHEMA || metadata?.generatedBy !== "parley" || metadata?.contentDigest !== existing.digest) {
      return {
        status: "skipped",
        reason: "local_mirror_conflict",
        localPath: targetPath,
        existingContentDigest: existing.digest,
        expectedPreviousDigest: metadata?.contentDigest
      };
    }
  }

  await writeFileAtomic(targetPath, projection.body);
  await writeMetadata(targetPath, projection, contentDigest);
  return { status: "written", localPath: targetPath, contentDigest };
}

export async function materializeProjectionResult(result, options = {}) {
  const mirrorRoot = options.runtimeConfig?.mode === "client" ? options.runtimeConfig?.projectionMirrorRoot : null;
  if (mirrorRoot == null || result == null || typeof result !== "object" || Array.isArray(result)) return result;
  const projection = result.projection;
  if (projection == null || typeof projection !== "object" || Array.isArray(projection)) return result;

  try {
    const materialization = await materializePlanProjection(projection, mirrorRoot);
    if (materialization == null) return result;
    return {
      ...result,
      projection: compactObject({ ...projection, localPath: materialization.localPath, materialization }),
      projection_materialization: materialization
    };
  } catch (error) {
    const materialization = compactObject({
      status: "failed",
      reason: error?.code ?? "projection_materialization_failed",
      message: error?.message
    });
    return {
      ...result,
      projection: compactObject({ ...projection, materialization }),
      projection_materialization: materialization
    };
  }
}
