import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createOpenThreadTool } from "../src/actions/open_thread.js";
import { createClaimTurnTool } from "../src/actions/claim_turn.js";
import { createReplyThreadTool } from "../src/actions/reply.js";
import { createSettleTurnTool } from "../src/actions/settle_turn.js";
import { createConcludeThreadTool } from "../src/actions/conclude_thread.js";
import { createDispatchTransportRequestTool } from "../src/actions/dispatch_transport_request.js";
import { createRecordHumanSummaryAnchorTool } from "../src/actions/record_human_summary_anchor.js";
import { loadMessageRecord, loadThreadRecord } from "../src/store.js";

const REPO_ROOT = "/home/agent/workspace/Kairos";
const INITIATOR_SESSION_KEY = "agent:kairos-operator:discord:channel:1494492383726010418";
const RECIPIENT_SESSION_KEY = "agent:kairos-operator:subagent:test-target";

async function makePluginConfig() {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "parley-transport-test-"));
  return {
    repoRoot: REPO_ROOT,
    parleyRuntimeRoot: runtimeRoot
  };
}

async function withPluginConfig(run) {
  const pluginConfig = await makePluginConfig();
  try {
    await run(pluginConfig);
  } finally {
    await fs.rm(pluginConfig.parleyRuntimeRoot, { recursive: true, force: true });
  }
}

function makeAcceptedGatewayCaller(gatewayCalls = []) {
  return async (request) => {
    gatewayCalls.push(request);
    return {
      runId: `mock-run-${gatewayCalls.length}`,
      status: "started"
    };
  };
}

async function openAndSettleThread(pluginConfig, gatewayCalls = []) {
  const openTool = createOpenThreadTool({ pluginConfig });
  const openResult = await openTool.execute(null, {
    kind: "coordination",
    controlMode: "peer",
    initiator: "kairos-operator",
    recipient: "parley-test-target",
    nextActionOwner: "parley-test-target",
    bodyText: "Live test after gateway restart.",
    targetSessionKey: RECIPIENT_SESSION_KEY,
    initiatorSessionKey: INITIATOR_SESSION_KEY,
    transport: "openclaw_runtime_subagent",
    openedByAction: "parley-transport-test"
  });

  const settleTool = createSettleTurnTool({ pluginConfig, callGateway: makeAcceptedGatewayCaller(gatewayCalls) });
  const settleResult = await settleTool.execute(null, {
    threadId: openResult.details.thread.thread_id,
    actor: "parley-test-target",
    controlMarker: "turn_complete",
    nextActionOwner: "kairos-operator",
    bodyText: "PARLEY RETURN PATH FIX VERIFIED"
  });

  return { openResult, settleResult };
}

async function openRecordAndSettleHumanSummaryThread(pluginConfig, gatewayCalls = []) {
  const openTool = createOpenThreadTool({ pluginConfig });
  const openResult = await openTool.execute(null, {
    kind: "coordination",
    controlMode: "peer",
    initiator: "kairos-operator",
    recipient: "parley-test-target",
    originKind: "human",
    nextActionOwner: "parley-test-target",
    bodyText: "Please provide a combined opinion.",
    targetSessionKey: RECIPIENT_SESSION_KEY,
    initiatorSessionKey: INITIATOR_SESSION_KEY
  });

  const recordTool = createRecordHumanSummaryAnchorTool({ pluginConfig });
  const recordResult = await recordTool.execute(null, {
    threadId: openResult.details.thread.thread_id,
    messageId: "1496381619869712556",
    channel: "discord",
    channelId: "1494492383726010418",
    target: "channel:1494492383726010418",
    accountId: "kairos-operator",
    createdAt: "2026-04-22T05:26:30.000Z"
  });

  const settleTool = createSettleTurnTool({ pluginConfig, callGateway: makeAcceptedGatewayCaller(gatewayCalls) });
  const settleResult = await settleTool.execute(null, {
    threadId: openResult.details.thread.thread_id,
    actor: "parley-test-target",
    controlMarker: "turn_complete",
    nextActionOwner: "kairos-operator",
    bodyText: "PARLEY RETURN PATH FIX VERIFIED"
  });

  return { openResult, recordResult, settleResult };
}

test("parley_open_thread defaults the bounded normal path cleanly", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    assert.equal(openResult.details.thread.kind, "coordination");
    assert.equal(openResult.details.thread.control_mode, "peer");
    assert.equal(openResult.details.thread.next_action_owner, "parley-test-target");
    assert.equal(openResult.details.status.thread.state, "awaiting_next_action");
    assert.equal(openResult.details.status.workflow.phase, "ready_for_dispatch");
    assert.deepEqual(openResult.details.status.workflow.next_steps, ["dispatch_transport_request"]);
  });
});

test("parley_open_thread defaults human-origin threads to summary_to_human when a recorded anchor is supplied", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      kind: "coordination",
      controlMode: "peer",
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      originKind: "human",
      humanSummaryAnchor: {
        messageId: "1496381619869712556",
        channel: "discord",
        channelId: "1494492383726010418",
        target: "channel:1494492383726010418",
        accountId: "kairos-operator",
        createdAt: "2026-04-22T05:26:30.000Z"
      },
      nextActionOwner: "parley-test-target",
      bodyText: "Please provide a combined opinion.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    assert.equal(openResult.details.thread.origin_kind, "human");
    assert.equal(openResult.details.thread.report_back_policy, "summary_to_human");
    assert.equal(openResult.details.thread.human_summary_anchor.message_id, "1496381619869712556");
    assert.equal(openResult.details.thread.human_summary_anchor.channel, "discord");
    assert.equal(openResult.details.thread.human_summary_anchor_status, "recorded");
    assert.equal(openResult.details.human_summary_anchor_required, false);

    const persistedThread = await loadThreadRecord(pluginConfig, openResult.details.thread.thread_id);
    assert.equal(persistedThread.origin_kind, "human");
    assert.equal(persistedThread.report_back_policy, "summary_to_human");
    assert.equal(persistedThread.human_summary_anchor.message_id, "1496381619869712556");
    assert.equal(persistedThread.human_summary_anchor.channel_id, "1494492383726010418");
    assert.equal(persistedThread.human_summary_anchor_status, "recorded");
  });
});

test("parley_open_thread defaults human-origin threads without an explicit policy to a generated anchor request", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      kind: "coordination",
      controlMode: "peer",
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      originKind: "human",
      nextActionOwner: "parley-test-target",
      bodyText: "Please provide a combined opinion.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    assert.equal(openResult.details.human_summary_anchor_required, true);
    assert.equal(openResult.details.human_summary_anchor_request.mode, "caller_send");
    assert.equal(openResult.details.human_summary_anchor_request.style, "sendoff");
    assert.equal(openResult.details.human_summary_anchor_request.canonical_thread_id, openResult.details.thread.thread_id);
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, /^PARLEY THREAD\n/m);
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, new RegExp(`thread: ${openResult.details.thread.thread_id}`));
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, /kind: coordination/);
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, /participants: kairos-operator -> parley-test-target/);
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, /status: awaiting_next_action/);
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, /next: parley-test-target/);
    assert.match(openResult.details.human_summary_anchor_request.anchor_text, /report: final update will follow in reply to this message after settlement/);
    assert.equal(openResult.details.thread.human_summary_anchor, null);
    assert.equal(openResult.details.thread.human_summary_anchor_status, "pending_send");
    assert.equal(openResult.details.thread.human_summary_anchor_request_text, openResult.details.human_summary_anchor_request.anchor_text);
    assert.equal(openResult.details.status.thread.state, "awaiting_next_action");
    assert.equal(openResult.details.status.transport.required, true);
    assert.equal(openResult.details.status.transport.state, "pending_dispatch");
    assert.equal(openResult.details.status.human_summary.anchor_required, true);
    assert.equal(openResult.details.status.human_summary.anchor_status, "pending_send");
    assert.equal(openResult.details.status.workflow.phase, "ready_for_anchor_and_dispatch");
    assert.deepEqual(openResult.details.status.workflow.next_steps, [
      "send_and_record_human_summary_anchor",
      "dispatch_transport_request"
    ]);

    const persistedThread = await loadThreadRecord(pluginConfig, openResult.details.thread.thread_id);
    assert.equal(persistedThread.human_summary_anchor, null);
    assert.equal(persistedThread.human_summary_anchor_status, "pending_send");
    assert.equal(persistedThread.human_summary_anchor_request_text, openResult.details.human_summary_anchor_request.anchor_text);
  });
});


test("parley_record_human_summary_anchor records a delivered anchor for a pending human summary thread", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      kind: "coordination",
      controlMode: "peer",
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      originKind: "human",
      nextActionOwner: "parley-test-target",
      bodyText: "Please provide a combined opinion.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    const recordTool = createRecordHumanSummaryAnchorTool({ pluginConfig });
    const recordResult = await recordTool.execute(null, {
      threadId: openResult.details.thread.thread_id,
      messageId: "1496381619869712556",
      channel: "discord",
      channelId: "1494492383726010418",
      target: "channel:1494492383726010418",
      accountId: "kairos-operator",
      createdAt: "2026-04-22T05:26:30.000Z"
    });

    assert.equal(recordResult.details.thread.human_summary_anchor_status, "recorded");
    assert.equal(recordResult.details.thread.human_summary_anchor.message_id, "1496381619869712556");
    assert.equal(recordResult.details.thread.human_summary_anchor_request_text, openResult.details.thread.human_summary_anchor_request_text);
    assert.equal(recordResult.details.status.transport.state, "not_required");
    assert.equal(recordResult.details.status.human_summary.anchor_status, "recorded");
    assert.equal(recordResult.details.status.human_summary.anchor_message_id, "1496381619869712556");
    assert.equal(recordResult.details.status.workflow.phase, "awaiting_next_action");
    assert.deepEqual(recordResult.details.status.workflow.next_steps, ["wait_for_next_action_owner"]);

    const persistedThread = await loadThreadRecord(pluginConfig, openResult.details.thread.thread_id);
    assert.equal(persistedThread.human_summary_anchor_status, "recorded");
    assert.equal(persistedThread.human_summary_anchor.message_id, "1496381619869712556");
    assert.equal(persistedThread.human_summary_anchor_request_text, openResult.details.thread.human_summary_anchor_request_text);
  });
});

test("parley_open_thread lets callers explicitly suppress human-summary follow-up on human-origin threads", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      kind: "coordination",
      controlMode: "peer",
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      originKind: "human",
      suppressHumanSummary: true,
      nextActionOwner: "parley-test-target",
      bodyText: "Please provide a combined opinion.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    assert.equal(openResult.details.thread.origin_kind, "human");
    assert.equal(openResult.details.thread.report_back_policy, "none");
    assert.equal(openResult.details.thread.human_summary_anchor, null);
    assert.equal(openResult.details.thread.human_summary_anchor_status, "not_required");
    assert.equal(openResult.details.human_summary_anchor_required, false);
    assert.equal(openResult.details.status.human_summary.anchor_required, false);
    assert.equal(openResult.details.status.workflow.phase, "ready_for_dispatch");
    assert.deepEqual(openResult.details.status.workflow.next_steps, ["dispatch_transport_request"]);
  });
});

test("parley_open_thread rejects archived reportBackPolicy input", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    await assert.rejects(
      openTool.execute(null, {
        initiator: "kairos-operator",
        recipient: "parley-test-target",
        originKind: "human",
        reportBackPolicy: "none",
        bodyText: "Please take a look.",
        targetSessionKey: RECIPIENT_SESSION_KEY,
        initiatorSessionKey: INITIATOR_SESSION_KEY
      }),
      /reportBackPolicy is archived and no longer accepted/
    );
  });
});

test("parley_open_thread validates transport correlation shape", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    await assert.rejects(
      openTool.execute(null, {
        initiator: "kairos-operator",
        recipient: "parley-test-target",
        bodyText: "Please take a look.",
        targetSessionKey: RECIPIENT_SESSION_KEY,
        transportCorrelation: "raw-session"
      }),
      /transportCorrelation must be an object/
    );
    await assert.rejects(
      openTool.execute(null, {
        initiator: "kairos-operator",
        recipient: "parley-test-target",
        bodyText: "Please take a look.",
        targetSessionKey: RECIPIENT_SESSION_KEY,
        transportCorrelation: { invented: true }
      }),
      /transportCorrelation\.invented is not allowed/
    );

    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY,
      transportCorrelation: {
        participantSessionKeys: {
          observer: "agent:kairos-observer:session:test"
        }
      }
    });
    assert.equal(openResult.details.thread.transport_correlation.participantSessionKeys.observer, "agent:kairos-observer:session:test");
    assert.equal(openResult.details.thread.transport_correlation.participantSessionKeys["kairos-operator"], INITIATOR_SESSION_KEY);
    assert.equal(openResult.details.thread.transport_correlation.participantSessionKeys["parley-test-target"], RECIPIENT_SESSION_KEY);
  });
});

test("parley_claim_turn records state without dispatching an empty control message", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    const gatewayCalls = [];
    const claimTool = createClaimTurnTool({
      pluginConfig,
      callGateway: makeAcceptedGatewayCaller(gatewayCalls)
    });
    const claimResult = await claimTool.execute(null, {
      threadId: openResult.details.thread.thread_id,
      actor: "parley-test-target"
    });

    assert.equal(gatewayCalls.length, 0);
    assert.equal(claimResult.details.transport_required, false);
    assert.equal(claimResult.details.status.transport.state, "not_required");
    assert.deepEqual(claimResult.details.status.workflow.next_steps, ["continue_current_turn_or_settle"]);
  });
});

test("parley_reply_thread auto-dispatches substantive replies", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    const gatewayCalls = [];
    const replyTool = createReplyThreadTool({
      pluginConfig,
      callGateway: makeAcceptedGatewayCaller(gatewayCalls)
    });
    const replyResult = await replyTool.execute(null, {
      threadId: openResult.details.thread.thread_id,
      sender: "parley-test-target",
      bodyText: "Here is the answer."
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(replyResult.details.transport_required, false);
    assert.equal(replyResult.details.dispatch_status, "accepted");
    assert.equal(replyResult.details.message.transport_state, "accepted");
    assert.equal(replyResult.details.status.workflow.phase, "in_active_turn");
    assert.deepEqual(replyResult.details.status.workflow.next_steps, ["continue_current_turn_or_settle"]);
  });
});

test("parley_settle_turn returns a dynamic human-summary update request once an anchor is recorded", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const gatewayCalls = [];
    const { settleResult } = await openRecordAndSettleHumanSummaryThread(pluginConfig, gatewayCalls);

    assert.equal(gatewayCalls.length, 1);
    assert.equal(settleResult.details.human_summary_update_available, true);
    assert.equal(settleResult.details.human_summary_update_request.mode, "caller_reply");
    assert.equal(settleResult.details.human_summary_update_request.style, "state_update");
    assert.equal(settleResult.details.human_summary_update_request.target_message_id, "1496381619869712556");
    assert.equal(settleResult.details.human_summary_update_request.canonical_thread_id, settleResult.details.thread.thread_id);
    assert.equal(settleResult.details.human_summary_update_request.canonical_message_id, settleResult.details.message.message_id);
    assert.match(settleResult.details.human_summary_update_request.update_text, /^PARLEY UPDATE\n/m);
    assert.match(settleResult.details.human_summary_update_request.update_text, new RegExp(`thread: ${settleResult.details.thread.thread_id}`));
    assert.match(settleResult.details.human_summary_update_request.update_text, /status: awaiting_next_action/);
    assert.match(settleResult.details.human_summary_update_request.update_text, /next: kairos-operator/);
    assert.match(settleResult.details.human_summary_update_request.update_text, /latest: turn_complete by parley-test-target/);
    assert.match(settleResult.details.human_summary_update_request.update_text, /report: final update remains pending until the thread is concluded/);
    assert.equal(settleResult.details.status.human_summary.update_available, true);
    assert.equal(settleResult.details.status.human_summary.update_target_message_id, "1496381619869712556");
    assert.deepEqual(settleResult.details.status.workflow.next_steps, [
      "send_human_summary_state_update",
      "send_final_human_summary",
      "conclude_thread_when_done"
    ]);
  });
});

test("parley_conclude_thread rejects conclusion before the initiator owns the next action", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    const concludeTool = createConcludeThreadTool({ pluginConfig });
    await assert.rejects(
      concludeTool.execute(null, {
        threadId: openResult.details.thread.thread_id,
        actor: "kairos-operator"
      }),
      /currently own the next action/
    );
  });
});

test("parley_conclude_thread succeeds once the initiator owns the next action", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const gatewayCalls = [];
    const { settleResult } = await openAndSettleThread(pluginConfig, gatewayCalls);
    const concludeTool = createConcludeThreadTool({ pluginConfig, callGateway: makeAcceptedGatewayCaller(gatewayCalls) });
    const concludeResult = await concludeTool.execute(null, {
      threadId: settleResult.details.thread.thread_id,
      actor: "kairos-operator",
      bodyText: "All done."
    });

    assert.equal(concludeResult.details.thread.thread_state, "concluded");
    assert.equal(concludeResult.details.thread.next_action_owner, null);
    assert.equal(concludeResult.details.dispatch_status, "accepted");
    assert.equal(concludeResult.details.message.transport_state, "accepted");
    assert.equal(concludeResult.details.status.workflow.phase, "concluded");
    assert.deepEqual(concludeResult.details.status.workflow.next_steps, []);
  });
});

test("parley_settle_turn routes return transport back to initiator session and auto-dispatches it", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const gatewayCalls = [];
    const { settleResult } = await openAndSettleThread(pluginConfig, gatewayCalls);

    assert.equal(gatewayCalls.length, 1);
    assert.equal(settleResult.details.transport_required, false);
    assert.equal(settleResult.details.dispatch_status, "accepted");
    assert.equal(
      settleResult.details.message.transport_target_session_key,
      INITIATOR_SESSION_KEY
    );
    assert.equal(settleResult.details.message.transport_state, "accepted");
  });
});

test("parley_dispatch_transport_request dispatches by canonical thread/message ids and records accepted dispatch", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    const gatewayCalls = [];
    const dispatchTool = createDispatchTransportRequestTool({
      pluginConfig,
      callGateway: async (request) => {
        gatewayCalls.push(request);
        assert.equal(request.method, "sessions.send");
        assert.equal(request.params.key, RECIPIENT_SESSION_KEY);
        assert.equal(request.params.idempotencyKey, openResult.details.transport_request.idempotency_key);
        assert.equal(request.params.message, openResult.details.transport_request.outbound_text);
        return {
          runId: "mock-run-id",
          status: "started"
        };
      }
    });

    const dispatchResult = await dispatchTool.execute(null, {
      threadId: openResult.details.thread.thread_id,
      messageId: openResult.details.message.message_id,
      timeoutMs: 30000
    });

    assert.equal(gatewayCalls.length, 1);
    assert.equal(dispatchResult.details.dispatch_status, "accepted");
    assert.equal(dispatchResult.details.message.transport_state, "accepted");
    assert.equal(dispatchResult.details.message.transport_message_ref, "mock-run-id");
    assert.equal(dispatchResult.details.status.transport.state, "accepted");
    assert.equal(dispatchResult.details.status.transport.accepted, true);
    assert.equal(dispatchResult.details.status.workflow.phase, "awaiting_next_action");
    assert.deepEqual(dispatchResult.details.status.workflow.next_steps, ["wait_for_next_action_owner"]);

    const persistedMessage = await loadMessageRecord(
      pluginConfig,
      dispatchResult.details.thread.thread_id,
      dispatchResult.details.message.message_id
    );

    assert.equal(persistedMessage.transport_state, "accepted");
    assert.equal(persistedMessage.transport_message_ref, "mock-run-id");
    assert.equal(persistedMessage.transport_target_session_key, RECIPIENT_SESSION_KEY);
  });
});

test("parley_dispatch_transport_request rejects stale non-latest pending messages on the same thread", async () => {
  await withPluginConfig(async (pluginConfig) => {
    const openTool = createOpenThreadTool({ pluginConfig });
    const openResult = await openTool.execute(null, {
      initiator: "kairos-operator",
      recipient: "parley-test-target",
      bodyText: "Please take a look.",
      targetSessionKey: RECIPIENT_SESSION_KEY,
      initiatorSessionKey: INITIATOR_SESSION_KEY
    });

    const replyTool = createReplyThreadTool({
      pluginConfig,
      callGateway: makeAcceptedGatewayCaller([])
    });
    const replyResult = await replyTool.execute(null, {
      threadId: openResult.details.thread.thread_id,
      sender: "parley-test-target",
      bodyText: "Returning with an answer."
    });

    const gatewayCalls = [];
    const dispatchTool = createDispatchTransportRequestTool({
      pluginConfig,
      callGateway: async (request) => {
        gatewayCalls.push(request);
        return {
          runId: "latest-run-id",
          status: "started"
        };
      }
    });

    await assert.rejects(
      dispatchTool.execute(null, {
        threadId: openResult.details.thread.thread_id,
        messageId: openResult.details.message.message_id,
        timeoutMs: 30000
      }),
      /only the latest thread message may be dispatched/
    );

    assert.equal(gatewayCalls.length, 0);

    const alreadyAcceptedResult = await dispatchTool.execute(null, {
      threadId: replyResult.details.thread.thread_id,
      messageId: replyResult.details.message.message_id,
      timeoutMs: 30000
    });

    assert.equal(alreadyAcceptedResult.details.dispatch_status, "already_accepted");
    assert.equal(gatewayCalls.length, 0);
    assert.equal(replyResult.details.dispatch_status, "accepted");
    assert.equal(replyResult.details.message.transport_message_ref, "mock-run-1");
  });
});
