# Parley Interim Agent-Side Transport Code Change Plan

Status: implemented
Authority: implementation-note
Owner: Kairos operator + orchestrator
Scope: by-file implementation plan and landed-reference notes for the interim Parley transport branch
Concrete plugin identity: Parley
Implementation branch: no-FR/no-PR interim branch
Depends on:
- `docs/agent-comms/parley/mvp-thread-protocol-spec.md`
- `plans/agent-comms/parley/mvp-implementation-plan.md`
- `docs/agent-comms/parley/interim-agent-side-transport-spec.md`
- `docs/agent-comms/parley/interim-agent-side-transport-tool-contracts.md`

## 1. Purpose

Translate the interim Parley transport branch into a concrete by-file implementation plan for the current codebase under `apps/kairos-openclaw-tools/src/parley/`.

This document now serves two roles:

- the original by-file implementation plan
- a status-aligned reference for what has actually landed locally as of 2026-04-22

This plan assumes:

- Parley canon remains plugin-owned
- transport dispatch is caller-managed or helper-managed through existing `sessions_send` semantics
- action execution must stop claiming transport attempt/acceptance inside Parley itself

## 1.1 Implementation status update, 2026-04-22

The core branch described here is now implemented locally and live-verified.
In particular:

- caller-managed `transport_required` / `transport_request` results are live
- `parley_record_transport_result` is live
- `parley_dispatch_transport_request` is live, now resolves dispatch from canonical `threadId` + `messageId`, and records accepted dispatch after gateway reload
- recipient-side return routing back to the initiator session was verified during the live round-trip
- the remaining near-term work is tests/docs tightening and any desired upstream runtime cleanup

## 2. High-level delta

The previous code path was:

- mutate canonical state
- call `dispatchParleyTransport(...)` immediately
- patch records based on live runtime dispatch result
- return `transport_sent` and `transport`

The current interim branch now does the following instead:

- mutate canonical state
- generate a transport handoff payload only
- persist message transport state as `pending_dispatch`
- return `transport_required` plus `transport_request`
- later finalize accepted/failed delivery through `parley_record_transport_result` or the bounded helper `parley_dispatch_transport_request`

## 3. File-by-file plan

### 3.1 `apps/kairos-openclaw-tools/src/parley/transport.js`

#### Current role
- renders protocol envelope, protocol block, and outbound text
- performs immediate runtime dispatch through `api.runtime.subagent.run(...)`

#### Required change
Split transport rendering from transport execution.
This file should stop owning live delivery.

#### Concrete edits

1. Keep and preserve:
   - `buildParleyProtocolEnvelope(...)`
   - `renderParleyProtocolBlock(...)`
   - `renderParleyOutboundText(...)`
   - preview-oriented helpers for transport label/correlation/target-session extraction

2. Remove or stop exporting the live dispatch path:
   - `dispatchParleyTransport(...)`

3. Replace it with a pure handoff builder, for example:
   - `buildTransportRequest({ thread, message })`

4. `buildTransportRequest(...)` should:
   - read `thread.transport_correlation.targetSessionKey`
   - throw or return structured error if missing
   - build the canonical idempotency key `parley:<thread_id>:<message_id>`
   - return:

```json
{
  "mode": "agent_sessions_send",
  "target_session_key": "string",
  "outbound_text": "string",
  "idempotency_key": "parley:<thread_id>:<message_id>",
  "canonical_thread_id": "string",
  "canonical_message_id": "string"
}
```

5. Preserve `buildTransportPreview(...)` only if still useful for debugging and result visibility.
   If retained, it should be explicitly non-dispatching.

#### Notes
The transport module becomes render-plus-handoff only.
That keeps later graduation to a native adapter localized to this file.

---

### 3.2 `apps/kairos-openclaw-tools/src/parley/actions/common.js`

#### Current role
- thread lookup helpers
- message/thread persistence helper
- immediate runtime dispatch inside `buildParleyActionResult(...)`

#### Required change
This file becomes the place that assembles the new result contract, not the place that dispatches transport.

#### Concrete edits

1. Remove the import of:
   - `dispatchParleyTransport`

2. Replace it with import of:
   - `buildTransportRequest`

3. Change `buildParleyActionResult(api, { tool, thread, message, note })` so it:
   - does not perform runtime send
   - optionally generates `transport_request`
   - returns `transport_required`
   - returns note wording that does not claim delivery attempt

4. Recommended new logic shape:

```js
export async function buildParleyActionResult(api, { tool, thread, message, note, transportRequired = true }) {
  const result = {
    tool,
    thread,
    message,
    note
  };

  if (!transportRequired) {
    return formatParleyResult({
      ...result,
      transport_required: false
    });
  }

  const transportRequest = buildTransportRequest({ thread, message });
  return formatParleyResult({
    ...result,
    transport_required: true,
    transport_request: transportRequest
  });
}
```

5. Add helper(s) if useful, for example:
   - `createPendingTransportFields(...)`
   - `createTransportRequestForResult(...)`

#### Notes
This file should become the main contract assembly layer for all Parley action results.

---

### 3.3 `apps/kairos-openclaw-tools/src/parley/store.js`

#### Current role
- thread/message record creation
- JSON persistence
- transport-thread index helpers

#### Required change
Extend canonical message records so transport state is explicit even before delivery occurs.

#### Concrete edits

1. Extend `createMessageRecord(input)` with fields:
   - `transport_state`
   - `transport_target_session_key`
   - `transport_idempotency_key`
   - `transport_error`
   - `transport_attempted_at`
   - `transport_accepted_at`

2. Initialize transport-bearing messages with:

```json
{
  "transport_state": "pending_dispatch",
  "transport_target_session_key": "<target session key>",
  "transport_idempotency_key": "parley:<thread_id>:<message_id>",
  "transport_message_ref": null,
  "transport_error": null,
  "transport_attempted_at": null,
  "transport_accepted_at": null
}
```

3. Keep `transport_message_ref` as the canonical accepted-send handle field.

4. Consider adding a small update helper, for example:
   - `updateMessageTransport(pluginConfig, threadId, messageId, patch)`

This would simplify the later `parley_record_transport_result` implementation.

5. No thread-store migration logic is strictly required for draft-stage local JSON runtime, but code should tolerate missing new transport fields on older message files if you expect existing state to be loaded.

#### Notes
This is the main persistence change needed to stop conflating rendered output with accepted delivery.

---

### 3.4 `apps/kairos-openclaw-tools/src/parley/schema.js`

#### Current role
- validates thread and message records
- validates enums and state transitions

#### Required change
Add explicit validation for message transport state and transport metadata.

#### Concrete edits

1. Add transport-state enum, for example:

```js
export const TRANSPORT_STATES = Object.freeze([
  "not_required",
  "pending_dispatch",
  "accepted",
  "failed"
]);
```

2. Add validator:
   - `assertTransportState(value)`

3. Extend `assertMessageRecord(record)` to validate:
   - `transport_state`
   - `transport_target_session_key`
   - `transport_idempotency_key`
   - `transport_error`
   - `transport_attempted_at`
   - `transport_accepted_at`

4. Add consistency rules such as:
   - `accepted` may have `transport_message_ref`
   - `failed` may have `transport_error`
   - `pending_dispatch` should not yet require timestamps or ref
   - `not_required` should allow all transport metadata to be null

5. Keep the validation permissive enough to load old records if backward compatibility matters during branch development.

#### Notes
This file is where the interim branch becomes a real canonical contract instead of just a result-shaping convention.

---

### 3.5 `apps/kairos-openclaw-tools/src/parley/actions/open_thread.js`

#### Current role
- create opening thread and message records
- call shared action-result builder with note claiming runtime-subagent dispatch attempt

#### Required change
Initialize transport metadata on the opening message and update note wording.

#### Concrete edits

1. When creating the opening message input, include:
   - `transport_state: "pending_dispatch"`
   - `transport_target_session_key`
   - `transport_idempotency_key`
   - null transport acceptance fields

2. Derive `transport_target_session_key` from canonical thread transport correlation.

3. Update note text to something like:
   - `Canonical Parley records created and transport handoff generated for caller-managed dispatch.`

4. Keep action parameters unchanged for this branch.

---

### 3.6 `apps/kairos-openclaw-tools/src/parley/actions/claim_turn.js`

#### Required change
Same pattern as `open_thread.js`.

#### Concrete edits
- initialize pending transport fields on the new control message
- keep canonical mutation logic unchanged
- change note text from runtime dispatch wording to handoff wording

Recommended note:
- `Turn claimed in canonical state and transport handoff generated for caller-managed dispatch.`

---

### 3.7 `apps/kairos-openclaw-tools/src/parley/actions/reply.js`

#### Required change
Same pattern as above.

#### Concrete edits
- initialize pending transport fields on the substantive reply message
- keep ownership/state mutation rules unchanged
- update note wording

Recommended note:
- `Substantive reply recorded in canonical state and transport handoff generated for caller-managed dispatch.`

---

### 3.8 `apps/kairos-openclaw-tools/src/parley/actions/probe.js`

#### Required change
Same pattern as above.

#### Concrete edits
- initialize pending transport fields on the probe control message
- preserve probe count / last probe updates
- update note wording

Recommended note:
- `Probe recorded in canonical state and transport handoff generated for caller-managed dispatch.`

---

### 3.9 `apps/kairos-openclaw-tools/src/parley/actions/settle_turn.js`

#### Required change
Same pattern as above.

#### Concrete edits
- initialize pending transport fields on the settling message
- preserve settling marker / next-action-owner semantics
- update note wording

Recommended note:
- `Turn settled in canonical state and transport handoff generated for caller-managed dispatch.`

---

### 3.10 `apps/kairos-openclaw-tools/src/parley/actions/conclude_thread.js`

#### Required change
Same pattern as above.

#### Concrete edits
- initialize pending transport fields on the concluding message
- preserve terminal thread-state logic
- update note wording

Recommended note:
- `Thread concluded in canonical state and transport handoff generated for caller-managed dispatch.`

---

### 3.11 `apps/kairos-openclaw-tools/src/parley/actions/record_transport_result.js` (implemented)

#### Current status
This action implementation file exists and is part of the active public tool surface.

#### Tool name
- `parley_record_transport_result`

#### Required behavior

1. Load and validate the thread.
2. Load and validate the target message.
3. Confirm message belongs to the given thread.
4. Accept:
   - `threadId`
   - `messageId`
   - `status`
   - optional `transportMessageRef`
   - optional `error`
5. Update canonical message transport fields:

##### Accepted
```json
{
  "transport_state": "accepted",
  "transport_message_ref": "<transportMessageRef or prior value>",
  "transport_error": null,
  "transport_attempted_at": "now",
  "transport_accepted_at": "now"
}
```

##### Failed
```json
{
  "transport_state": "failed",
  "transport_error": {
    "code": "string",
    "message": "string"
  },
  "transport_attempted_at": "now"
}
```

6. Return a normal structured Parley result showing updated message transport state.

#### Notes
This new file is the main operational addition for the interim branch.

---

### 3.12 `apps/kairos-openclaw-tools/src/parley/tools.js`

#### Current role
- registers current Parley public tools

#### Implemented change
The tool registry now includes both interim transport follow-up tools:

- `parley_record_transport_result`
- `parley_dispatch_transport_request`

#### Result
The public contract expansion required for the interim branch is already in place.

---

### 3.13 `apps/kairos-openclaw-tools/index.js`

#### Required change
Likely no Parley-specific logic change needed beyond whatever tool registration already flows through `registerParleyTools(api)`.

#### Check
Verify no plugin-level schema or exported metadata needs documentation updates because of the new tool addition.

---

## 4. Recommended implementation order

1. `schema.js`
2. `store.js`
3. `transport.js`
4. `actions/common.js`
5. update existing action files
6. add `actions/record_transport_result.js`
7. update `tools.js`
8. run local smoke tests against full open/claim/reply/probe/settle/conclude flow plus accepted/failed result recording

## 5. First validation targets

After implementation, validate at least:

1. each Parley action now returns:
   - `transport_required`
   - `transport_request`
   - no `transport_sent`

2. created message files contain:
   - `transport_state: pending_dispatch`
   - target session key
   - idempotency key

3. `parley_record_transport_result(status=accepted)` updates:
   - `transport_state`
   - `transport_message_ref`
   - timestamps

4. `parley_record_transport_result(status=failed)` updates:
   - `transport_state`
   - `transport_error`
   - attempted timestamp

5. no Parley action claims delivery attempt or acceptance in result notes

## 6. Non-goals for this edit set

Do not add in this branch:

- a new upstream first-class plugin runtime transport API as part of this repo-local edit set
- label resolution
- reply-target semantics beyond explicit session-key routing
- transcript-entry ids
- automatic reconciliation loops
- broader routing logic

Note: the current local helper path already uses a bounded internal gateway bridge to invoke `sessions.send`. That implementation detail is now part of the active local branch and should be treated as a stopgap transport adapter, not as the long-term upstream target.
