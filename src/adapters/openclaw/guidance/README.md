# OpenClaw agent-facing guidance

This directory owns reusable plaintext guidance for Parley OpenClaw tool responses.

Keep prompt-like or agent-facing wording here instead of scattering it through individual tool implementations.

- `catalog.js` stores reusable summaries, meanings, next-call reasons, and avoid notes.
- `rules.js` derives guidance from structured tool result facts.
- `envelope.js` applies the standard response enrichment used by OpenClaw tool result helpers.

Tool files should return structured state facts. The shared response helpers add compact operational text and next-call hints.

Guidance is advisory. It may suggest useful inspections or safe continuation calls, but it must not grant authority to activate, promote, mutate follow-on workflow, or act for another participant.
