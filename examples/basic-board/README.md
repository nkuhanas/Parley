# Basic board example

`config.example.json` shows one global agent with one default board.

Replace:

- `my-agent` with your OpenClaw agent id
- `~/projects/example/plans` with a real plan/document directory
- `~/.local/share/parley` if you want Parley state somewhere else

The example board includes the protected human member `human`. New Parley-created boards add this member automatically; for persisted configs, use `parley --config ./config.example.json doctor --board project` to inspect the entry.

Then run `parley_query({ action: "my_boards" })` from that agent, choose the returned `default_board`, and call `parley_query({ action: "where_am_i", boardId: "project" })`.
