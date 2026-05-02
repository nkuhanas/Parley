# Getting started

This guide creates one board, one global agent, and one board-local identity.

## 1. Install

```sh
npm install @nkuhanas/parley
```

For a local checkout:

```sh
npm install
npm test
```

## 2. Configure one board

Start with `examples/basic-board/config.example.json`. Replace paths and runtime ids with values from your OpenClaw setup.

The minimum useful setup contains:

- `parleyRoot`: where board state and managed artifacts live
- `parleyRegistry.agents`: global agent identities and runtime bindings
- `parleyBoards`: board storage, artifact namespaces, and members

## 3. Register tools

Use the package's plugin entrypoint, or call `registerParleyTools(api)` from another plugin.

## 4. Smoke test

Call:

```js
parley_describe({ topic: "recovery" })
const runtime = parley_where_am_i({})
parley_where_am_i({ boardId: runtime.boards.default_board })
```

`parley_describe` should return structured topics, schemas, valid values, and examples for fresh agents. Use `parley_describe({})` for an overview, `parley_describe({ topic: "targets" })` for target scope ontology, `parley_describe({ topic: "query.runtime_obligations" })` for runtime obligations, `parley_describe({ topic: "query.board_obligations" })` for board obligations, `parley_describe({ topic: "query.search" })` for namespace search shape, and `parley_describe({ boardId: runtime.boards.default_board })` for board metadata only.

`where_am_i({})` should return runtime identity, runtime protocol obligations, and accessible boards/default board hints. Use the default board value, or another board from the response, as the explicit `boardId` for board-scoped recovery and operations. Parley does not silently apply `default_board`.

## 5. Add coordination records

After identity works, register an artifact, create an object around it, record an effect, and create an obligation. Pass `boardId` on each board-scoped call. Then call `where_am_i` again with the same `boardId` and verify the board obligation appears in the board section.

For runtime obligation recovery, use:

```js
parley_query({
  action: "runtime_obligations",
  input: { filter: "needs_my_action" }
})
```

For board obligation recovery, use:

```js
parley_query({
  action: "board_obligations",
  boardId: runtime.boards.default_board,
  input: { filter: "needs_my_action", targetKinds: ["plans"] }
})
```

For board namespace discovery, use:

```js
parley_query({
  action: "search",
  boardId: runtime.boards.default_board,
  input: { query: "checkpoint", namespaces: ["project_docs", "project_plans"] }
})
```
