# Troubleshooting

## `callerRuntimeRef required`

Parley could not derive the caller identity. Pass `callerRuntimeRef` explicitly or ensure the OpenClaw tool context includes an agent id or session key.

## Caller does not resolve to a global agent

Add a matching `runtime_bindings` entry for the caller under `parleyRegistry.agents`.

## Caller is not a board member

Add the board to the global agent's `memberships`, and ensure the board has a matching `members` entry or can synthesize one from membership data.

## Board-scoped operation requires boardId

Call `parley_describe({ topic: "recovery" })`, then `parley_where_am_i({})` or `parley_my_boards({})`, choose a board from the response, and pass it as `boardId`. `default_board` is a selection hint; Parley does not silently apply it to board-scoped projections, validation, mutations, or board obligations. `parley_query({ action: "my_boards" })` remains available as an advanced facade path.

`parley_where_am_i({})` is valid and returns runtime obligations plus board discovery hints. `parley_where_am_i({ boardId })` returns compact separate runtime and board sections. Add `verbosity: "full"` only when full diagnostic detail is needed.

For invalid facade actions, filters, or targetKinds, validation errors include `validValues` plus a hint to call `parley_describe` with the relevant topic. Prefer first-class tools for normal agent work; use `parley_query` or `parley_mutate` only when a single-dispatch compatibility surface is needed.

## Artifact path rejected

Check the board's `artifact_namespaces`, `resolved_root`, and `allowed_subpaths`. Parley rejects paths outside configured namespace boundaries.

## Tool not visible after install

Restart OpenClaw after changing plugin registration or allowlists, then inspect plugin/tool visibility again.

## OpenClaw reports `plugin tool runtime missing`

If OpenClaw shows a plugin as loaded and manifest tool names are visible, but invoking one tool fails with `plugin tool runtime missing (<plugin-id>): <tool-name>`, check whether the plugin registered runtime-context tool factories without explicit names.

OpenClaw descriptor discovery can expose names from `contracts.tools`, but runtime invocation still has to find the specific registered factory for the requested tool. For factory registrations such as `(toolContext) => createTool(...)`, pass the tool name explicitly:

```js
api.registerTool((toolContext) => createTool({ ...api, toolContext }), { name: "parley_example" });
```

Do not rely on the factory's JavaScript function name or on the eventual returned tool object's `name` alone for runtime matching. If several nameless factories are registered, OpenClaw may route through the wrong factory and then report that the requested runtime tool is missing.

Recommended checks:

- Inspect plugin status and manifest tool names.
- Add or keep a regression test that fails when any factory registration lacks `options.name` or `options.names`.
- Restart OpenClaw after syncing the fixed adapter/plugin code.
- Re-run a direct tool invocation, not just plugin inspection.
