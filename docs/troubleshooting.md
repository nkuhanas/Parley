# Troubleshooting

## `callerRuntimeRef required`

Parley could not derive the caller identity. Pass `callerRuntimeRef` explicitly or ensure the OpenClaw tool context includes an agent id or session key.

## Caller does not resolve to a global agent

Add a matching `runtime_bindings` entry for the caller under `parleyRegistry.agents`.

## Caller is not a board member

Add the board to the global agent's `memberships`, and ensure the board has a matching `members` entry or can synthesize one from membership data.

## Board-scoped operation requires boardId

Call `parley_my_boards` or `parley_query({ action: "my_boards" })` first, choose a board from the response, then pass it as `boardId`. `default_board` is a selection hint; Parley does not silently apply it to `where_am_i`, projections, validation, or mutations.

## Artifact path rejected

Check the board's `artifact_namespaces`, `resolved_root`, and `allowed_subpaths`. Parley rejects paths outside configured namespace boundaries.

## Tool not visible after install

Restart OpenClaw after changing plugin registration or allowlists, then inspect plugin/tool visibility again.
