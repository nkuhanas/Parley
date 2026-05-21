import {
  DEFAULT_HUMAN_BOARD_AGENT_ID,
  createProtectedHumanBoardMember,
  isProtectedHumanBoardMember,
  repairProtectedHumanBoardMember
} from "./board/human_member.js";

const BOARD_COLLECTION_KEYS = Object.freeze(["parleyDefaultBoards", "parleyBoards"]);
const MEMBER_ARRAY_KEYS = Object.freeze(["agent_registry", "agents", "members"]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function boardCollectionEntries(config = {}) {
  const entries = [];
  for (const collectionKey of BOARD_COLLECTION_KEYS) {
    const collection = config[collectionKey];
    if (!isObject(collection)) continue;
    for (const [key, board] of Object.entries(collection)) {
      if (!isObject(board)) continue;
      entries.push({ collectionKey, key, board, boardId: board.board_id ?? board.boardId ?? key });
    }
  }
  return entries;
}

function memberArrayInfo(board, options = {}) {
  for (const key of MEMBER_ARRAY_KEYS) {
    if (Array.isArray(board[key])) return { key, members: board[key], existed: true };
  }
  if (options.repair === true) {
    board.members = [];
    return { key: "members", members: board.members, existed: false };
  }
  return { key: "members", members: [], existed: false };
}

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

function humanMemberDiagnostics(member) {
  if (!isObject(member)) return ["human member entry is not an object"];
  const issues = [];
  const boardAgentId = member.board_agent_id ?? member.boardAgentId;
  const agentId = member.agent_id ?? member.agentId ?? member.global_agent_id ?? member.globalAgentId;
  const roles = uniqueStrings(member.roles);
  if (boardAgentId !== DEFAULT_HUMAN_BOARD_AGENT_ID) issues.push("board_agent_id is not human");
  if (agentId !== DEFAULT_HUMAN_BOARD_AGENT_ID) issues.push("agent_id/global_agent_id is not human");
  if (member.kind !== "human") issues.push("kind is not human");
  if (!roles.includes("human")) issues.push("roles does not include human");
  if (!isObject(member.permissions)) issues.push("permissions is missing");
  if (isObject(member.permissions) && member.permissions.protected !== true) issues.push("permissions.protected is not true");
  return issues;
}

function inspectOrRepairBoard(entry, options = {}) {
  const { key: memberArrayKey, members } = memberArrayInfo(entry.board, options);
  const existingIndex = members.findIndex(isProtectedHumanBoardMember);
  const existing = existingIndex === -1 ? null : members[existingIndex];
  const issues = existing == null ? ["human member missing"] : humanMemberDiagnostics(existing);
  const repaired = options.repair === true && issues.length > 0;

  if (repaired) {
    if (existing == null) {
      members.push(createProtectedHumanBoardMember());
    } else {
      members[existingIndex] = repairProtectedHumanBoardMember(existing);
    }
  }

  return {
    board_id: entry.boardId,
    source: `${entry.collectionKey}.${entry.key}.${memberArrayKey}`,
    status: issues.length === 0 ? "ok" : repaired ? "repaired" : existing == null ? "missing" : "needs_repair",
    repaired,
    issues,
    human_member_id: DEFAULT_HUMAN_BOARD_AGENT_ID
  };
}

export function doctorParleyBoardConfig(config = {}, options = {}) {
  if (!isObject(config)) throw new Error("Parley config must be an object");
  const selectedBoardId = options.boardId;
  const entries = boardCollectionEntries(config)
    .filter((entry) => selectedBoardId == null || entry.boardId === selectedBoardId);
  if (selectedBoardId != null && entries.length === 0) {
    throw new Error(`board not found in config: ${selectedBoardId}`);
  }
  const boards = entries.map((entry) => inspectOrRepairBoard(entry, options));
  const summary = {
    boards_checked: boards.length,
    ok: boards.filter((board) => board.status === "ok").length,
    missing: boards.filter((board) => board.status === "missing").length,
    needs_repair: boards.filter((board) => board.status === "needs_repair").length,
    repaired: boards.filter((board) => board.repaired).length
  };
  return {
    ok: summary.missing === 0 && summary.needs_repair === 0,
    protected_member_id: DEFAULT_HUMAN_BOARD_AGENT_ID,
    repaired: summary.repaired > 0,
    summary,
    boards
  };
}
