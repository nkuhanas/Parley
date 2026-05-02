import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedGatewayCallerPromise = null;

async function readPackageName(packageJsonPath) {
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

async function findOpenClawRoot(startDir) {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 12; depth += 1) {
    const packageName = await readPackageName(path.join(current, "package.json"));
    if (packageName === "openclaw") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function resolveOpenClawRoot() {
  const candidates = [];

  if (typeof process.env.OPENCLAW_INSTALL_ROOT === "string" && process.env.OPENCLAW_INSTALL_ROOT.trim()) {
    candidates.push(process.env.OPENCLAW_INSTALL_ROOT.trim());
  }

  if (typeof process.argv?.[1] === "string" && process.argv[1].trim()) {
    candidates.push(path.dirname(path.resolve(process.argv[1])));
  }

  candidates.push(__dirname);

  for (const candidate of candidates) {
    const resolved = await findOpenClawRoot(candidate);
    if (resolved) return resolved;
  }

  throw new Error("Unable to resolve OpenClaw install root for Parley transport dispatch");
}

async function loadGatewayCaller() {
  const openClawRoot = await resolveOpenClawRoot();
  const moduleUrl = pathToFileURL(path.join(openClawRoot, "dist", "plugin-sdk", "testing.js")).href;
  const mod = await import(moduleUrl);
  if (typeof mod.callGateway !== "function") {
    throw new Error("OpenClaw gateway caller export not available");
  }
  return mod.callGateway;
}

export async function getOpenClawGatewayCaller(override) {
  if (typeof override === "function") {
    return override;
  }
  if (!cachedGatewayCallerPromise) {
    cachedGatewayCallerPromise = loadGatewayCaller();
  }
  return await cachedGatewayCallerPromise;
}
