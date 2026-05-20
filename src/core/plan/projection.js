import crypto from "node:crypto";

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

export function contentHash(markdown) {
  return `sha256:${crypto.createHash("sha256").update(markdown, "utf8").digest("hex")}`;
}

export function planProjectionPayload({ plan, artifact = null, markdown, includeBody = true } = {}) {
  if (plan == null || typeof markdown !== "string") return null;
  const landing = plan.landing ?? {};
  return compactObject({
    kind: "plan_markdown",
    planId: plan.plan_id,
    boardId: plan.board_id,
    artifactId: artifact?.artifact_id ?? plan.artifact_id,
    artifactVersion: artifact?.version ?? plan.version,
    uri: landing.uri ?? artifact?.uri,
    mediaType: "text/markdown; charset=utf-8",
    contentDigest: artifact?.content_hash ?? contentHash(markdown),
    body: includeBody ? markdown : undefined,
    namespace: landing.namespace,
    subpath: landing.subpath,
    filename: landing.filename,
    serviceLocalPath: landing.resolved_path ?? artifact?.resolved_path
  });
}
