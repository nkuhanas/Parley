export const DEFAULT_HUMAN_BOARD_AGENT_ID = "human";
export const PARLEY_DEFAULT_HUMAN_MEMBER_ID = DEFAULT_HUMAN_BOARD_AGENT_ID;

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const normalized = value.trim();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function protectedHumanPermissions(value) {
  const existing = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    preset: existing.preset ?? "human_protected",
    ...existing,
    protected: true
  };
}

export function createProtectedHumanBoardMember(overrides = {}) {
  const roles = uniqueStrings([...(Array.isArray(overrides.roles) ? overrides.roles : []), "human"]);
  return {
    agent_id: DEFAULT_HUMAN_BOARD_AGENT_ID,
    board_agent_id: DEFAULT_HUMAN_BOARD_AGENT_ID,
    display_name: overrides.display_name ?? overrides.displayName ?? "Human",
    kind: "human",
    runtime_refs: Array.isArray(overrides.runtime_refs ?? overrides.runtimeRefs)
      ? (overrides.runtime_refs ?? overrides.runtimeRefs)
      : [],
    roles,
    permissions: protectedHumanPermissions(overrides.permissions)
  };
}

export function repairProtectedHumanBoardMember(existing = {}) {
  return createProtectedHumanBoardMember({
    ...existing,
    display_name: existing.display_name ?? existing.displayName ?? "Human",
    runtime_refs: existing.runtime_refs ?? existing.runtimeRefs ?? [],
    roles: uniqueStrings([...(Array.isArray(existing.roles) ? existing.roles : []), "human"]),
    permissions: existing.permissions && typeof existing.permissions === "object" && !Array.isArray(existing.permissions)
      ? existing.permissions
      : { preset: "human_protected", protected: true }
  });
}

export function isDefaultHumanMember(member = {}) {
  return member?.board_agent_id === DEFAULT_HUMAN_BOARD_AGENT_ID
    || member?.boardAgentId === DEFAULT_HUMAN_BOARD_AGENT_ID
    || member?.agent_id === DEFAULT_HUMAN_BOARD_AGENT_ID
    || member?.agentId === DEFAULT_HUMAN_BOARD_AGENT_ID
    || member?.global_agent_id === DEFAULT_HUMAN_BOARD_AGENT_ID
    || member?.globalAgentId === DEFAULT_HUMAN_BOARD_AGENT_ID;
}

export function isProtectedHumanBoardMember(member = {}) {
  return isDefaultHumanMember(member);
}
