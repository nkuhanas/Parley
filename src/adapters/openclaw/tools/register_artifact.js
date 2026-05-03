import fs from "node:fs/promises";
import path from "node:path";

import { assertPathUnderArtifactNamespaces, resolveArtifactNamespacePath, resolveManagedArtifactPath } from "../../../core/board/board.js";
import { createArtifactRecord, saveArtifactRecord } from "../../../core/storage/board_store.js";
import { assertNonEmptyString } from "../../../core/board/board_schema.js";
import { boardResult, callerRuntimeRefParameter, resolveToolCaller } from "./v2_common.js";
import { importPlanArtifactSetup } from "./plan_common.js";

function normalizeStorageMode(value) {
  if (typeof value !== "string" || !value.trim()) return "reference_only";
  return value.trim().replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function normalizeVersion(value) {
  if (value == null) return 1;
  if (!Number.isInteger(value) || value < 1) throw new Error("version must be a positive integer");
  return value;
}

function ensureUnderAllowedRoots(candidatePath, allowedRoots, fieldName) {
  const resolved = path.resolve(candidatePath);
  const allowed = allowedRoots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
  });
  if (!allowed) throw new Error(`${fieldName} must be under an allowed board root`);
  return resolved;
}

export function createRegisterArtifactTool(api) {
  return {
    name: "parley_register_artifact",
    label: "Parley Register Artifact",
    description: "Register a board-scoped Parley artifact reference for the v2/dev object/effect/obligation slice.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["boardId", "kind", "storageMode"],
      properties: {
        callerRuntimeRef: callerRuntimeRefParameter(),
        boardId: { type: "string", description: "Required board id for this board-scoped operation. Call parley_my_boards to discover accessible boards and default_board." },
        artifactId: { type: "string", description: "Optional stable artifact id. Defaults to artifact_<uuid>." },
        kind: { type: "string", description: "Artifact kind, e.g. plan, invariant_spec, decision_record, documentation." },
        storageMode: { type: "string", description: "reference_only, managed_local, or explicit_landing." },
        uri: { type: "string", description: "Artifact URI/ref for reference-only or explicit-landing artifacts." },
        title: { type: "string", description: "Optional artifact title." },
        version: { type: "number", description: "Positive integer artifact version. Defaults to 1." },
        status: { type: "string", description: "Artifact status. Defaults to draft." },
        contentHash: { type: "string", description: "Optional content hash." },
        landingRoot: { type: "string", description: "Optional explicit landing root for explicit_landing artifacts." },
        artifactNamespace: { type: "string", description: "Optional board artifact namespace for explicit landing or reference validation." },
        landingSubpath: { type: "string", description: "Optional safe relative subpath under artifactNamespace." },
        resolvedPath: { type: "string", description: "Optional resolved artifact body path." },
        filename: { type: "string", description: "Safe relative filename for managed_local or namespace-backed artifact bodies." },
        bodyText: { type: "string", description: "Optional body text to create/update for managed_local artifacts." }
      }
    },
    async execute(_toolCallId, params) {
      const identity = resolveToolCaller(api, params);
      const storageMode = normalizeStorageMode(params?.storageMode);
      let resolvedPath = typeof params?.resolvedPath === "string" && params.resolvedPath.trim() ? params.resolvedPath.trim() : null;
      let uri = typeof params?.uri === "string" && params.uri.trim() ? params.uri.trim() : null;
      let landingRoot = typeof params?.landingRoot === "string" && params.landingRoot.trim() ? params.landingRoot.trim() : null;

      if (storageMode === "managed_local") {
        const filename = assertNonEmptyString(params?.filename ?? `${params?.artifactId ?? "artifact"}.md`, "filename");
        resolvedPath = resolveManagedArtifactPath(identity.board, filename);
        uri = uri ?? `parley-artifact://${identity.board_id}/${filename}`;
        if (typeof params?.bodyText === "string") {
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, params.bodyText, "utf8");
        }
      }

      if (storageMode === "explicit_landing") {
        if (typeof params?.artifactNamespace === "string" && params.artifactNamespace.trim()) {
          const landing = resolveArtifactNamespacePath(identity.board, {
            role: "explicit_landing",
            namespace: params.artifactNamespace,
            subpath: params?.landingSubpath ?? "",
            filename: params?.filename
          });
          landingRoot = landing.landing_root;
          resolvedPath = landing.resolved_path;
          uri = uri ?? landing.uri;
        } else {
          if (landingRoot != null) landingRoot = ensureUnderAllowedRoots(landingRoot, identity.board.allowed_landing_roots, "landingRoot");
          if (resolvedPath != null) resolvedPath = ensureUnderAllowedRoots(resolvedPath, identity.board.allowed_landing_roots, "resolvedPath");
        }
        if (typeof params?.bodyText === "string" && resolvedPath != null) {
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, params.bodyText, "utf8");
        }
      }

      if (storageMode === "reference_only" && resolvedPath != null) {
        if (typeof params?.artifactNamespace === "string" && params.artifactNamespace.trim()) {
          resolvedPath = assertPathUnderArtifactNamespaces(identity.board, resolvedPath, "reference", "resolvedPath");
        } else {
          resolvedPath = ensureUnderAllowedRoots(resolvedPath, identity.board.allowed_reference_roots, "resolvedPath");
        }
      }

      const artifact = createArtifactRecord({
        board_id: identity.board_id,
        artifact_id: params?.artifactId,
        kind: params?.kind,
        storage_mode: storageMode,
        uri,
        version: normalizeVersion(params?.version),
        status: params?.status,
        title: params?.title,
        content_hash: params?.contentHash,
        landing_root: landingRoot,
        resolved_path: resolvedPath
      });
      const saved = await saveArtifactRecord(api.pluginConfig, identity.board, artifact);
      let planImport = null;
      if (saved.kind === "plan" && saved.resolved_path != null) {
        const markdown = await fs.readFile(saved.resolved_path, "utf8");
        planImport = await importPlanArtifactSetup(api, identity, saved, markdown);
      }
      return boardResult({
        tool: "parley_register_artifact",
        identity,
        artifact: saved,
        plan: planImport?.plan ?? null,
        setupState: planImport?.setupState ?? null,
        plan_validation: planImport?.validation ?? null,
        plan_lifecycle: { obligations: planImport?.lifecycleObligations ?? [] }
      });
    }
  };
}
