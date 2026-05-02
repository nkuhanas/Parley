# Basic board example

`config.example.json` shows one global agent with one default board.

Replace:

- `my-agent` with your OpenClaw agent id
- `~/projects/example/plans` with a real plan/document directory
- `~/.local/share/parley` if you want Parley state somewhere else

Then run `parley_query({ action: "my_boards" })` and `parley_query({ action: "where_am_i" })` from that agent.
