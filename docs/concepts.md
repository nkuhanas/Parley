# Concepts

## Board

A board is a coordination boundary for a domain of work. It owns storage roots, artifact namespaces, members, and policy.

## Runtime ref

A `runtime_ref` identifies the concrete caller, such as an OpenClaw agent, session, or subagent.

## Global agent

A global agent is the durable Parley-wide identity resolved from runtime bindings.

## Board agent

A board agent is the identity used inside one board's records. One global agent can have different board-local identities on different boards.

## Artifact

An artifact references a plan, source file, document, output, or managed local body.

## Coordination object

A coordination object is the thing being coordinated, such as a plan, review request, decision, or handoff.

## Effect

An effect is an append-only fact about something that happened.

## Obligation

An obligation is an actionable assignment to a board agent.

## Projection

A projection derives useful current state from durable records, such as active obligations or stale approvals.
