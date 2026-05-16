# Examples

The example directories are intentionally small and use placeholder identities. They are starting points for local smoke tests, not production policy templates.

- `examples/basic-board/` shows one board, one global agent, one board-local identity, and a single plan/reference namespace.
- `examples/multi-board/` shows one global agent participating in two boards with separate board-local identities.
- `examples/codex-cli-client/` shows how to launch a Codex CLI worker with Parley client-mode identity metadata.

Replace placeholder runtime ids, board ids, namespace paths, and storage roots with values from your OpenClaw setup. Keep namespace roots narrow: prefer a project docs or plans directory over a broad home/vault root.

For service/client deployments, use the examples for board and identity shape, then put service connection fields such as `parleyMode`, `parleyApiUrl`, and `parleyAuthTokenFile` in the OpenClaw plugin config for each client agent.
