# CLI

The alpha CLI is intentionally small and uses the same runtime mode resolver as the embedded client and OpenClaw adapter.

```sh
parley mode
parley describe
parley my-boards --config ./parley.config.json
parley where-am-i --config ./parley.config.json --board project
```

## Standalone mode

Direct CLI usage may default to `standalone` when neither `PARLEY_MODE` nor `PARLEY_API_URL` is set. The CLI reports the resolved `stateRoot`/`runtimeRoot` in JSON output and prints implicit state-root warnings to stderr.

Standalone CLI calls use the embedded Parley service boundary with local file-backed state.

## Client mode

`PARLEY_MODE=client` requires `PARLEY_API_URL`. Remote HTTP transport is not implemented in this slice, so command execution fails clearly after config validation instead of falling back to local state.

## Config

Use `--config <file>` or `PARLEY_CONFIG=<file>` to load a JSON object shaped like Parley plugin config. Command-line flags such as `--mode`, `--state-root`, `--runtime-root`, `--api-url`, `--agent`, and `--default-board` override file config.
