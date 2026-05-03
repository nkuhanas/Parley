import { buildDiagnostics, buildGuidance, guidanceSummary } from "./rules.js";

function compactObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => {
    if (child === undefined) return false;
    if (Array.isArray(child) && child.length === 0) return false;
    if (child && typeof child === "object" && !Array.isArray(child) && Object.keys(child).length === 0) return false;
    return true;
  }));
}

export function enrichToolDetails(details, options = {}) {
  if (details == null || typeof details !== "object" || Array.isArray(details)) return details;
  if (details.ok != null && details.summary != null && !options.force) return details;

  const guidance = compactObject(buildGuidance(details));
  const diagnostics = compactObject(buildDiagnostics(details));
  return compactObject({
    ok: true,
    summary: guidanceSummary(details),
    ...details,
    guidance,
    diagnostics
  });
}
