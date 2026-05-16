# Codex CLI client example

This example shows how to launch a Codex CLI worker with Parley client-mode identity metadata.

`parley-codex` does not grant board authority by itself. It configures client-mode environment and provenance, then launches Codex. The Parley service registry still controls which boards `codex-agent` can access and mutate.

## Start a Parley service

```sh
PARLEY_MODE=service \
PARLEY_DB_PATH=/path/to/parley.sqlite \
PARLEY_AUTH_TOKEN_FILE=/path/to/token \
parleyd
```

The service registry should include a durable Codex actor binding such as `codex:agent:codex-agent` and the board memberships that actor needs.

## Inspect the launch environment

Use `--print-env` to inspect the sanitized Parley environment without launching Codex:

```sh
parley-codex \
  --api-url http://127.0.0.1:7331 \
  --auth-token-file ~/.config/parley/token \
  --actor codex-agent \
  --default-board project \
  --print-env
```

Use `--dry-run` to inspect the sanitized command plus environment:

```sh
parley-codex \
  --api-url http://127.0.0.1:7331 \
  --auth-token-file ~/.config/parley/token \
  --actor codex-agent \
  --default-board project \
  --dry-run
```

The output should include client-mode settings such as:

```json
{
  "ok": true,
  "launch": {
    "env": {
      "PARLEY_MODE": "client",
      "PARLEY_API_URL": "http://127.0.0.1:7331",
      "PARLEY_AGENT_ID": "codex-agent",
      "PARLEY_DEFAULT_BOARD": "project",
      "PARLEY_CALLER_RUNTIME": "codex",
      "PARLEY_CALLER_RUNTIME_REF": "codex:agent:codex-agent",
      "PARLEY_CALLER_RUNTIME_ALIASES": "codex:session:<generated-session-id>",
      "PARLEY_WORKER_SURFACE": "codex-cli"
    }
  }
}
```

## Launch Codex with Parley metadata

```sh
parley-codex \
  --api-url http://127.0.0.1:7331 \
  --auth-token-file ~/.config/parley/token \
  --actor codex-agent \
  --default-board project \
  -- \
  "inspect the current Parley obligations and summarize what needs action"
```

Inside that Codex process, Parley-aware tooling or scripts can use the exported environment to call the shared Parley service in client mode.

## Smoke Parley before launching Codex

You can also use the same identity contract with the `parley` CLI before launching a worker:

```sh
PARLEY_MODE=client \
PARLEY_API_URL=http://127.0.0.1:7331 \
PARLEY_AUTH_TOKEN_FILE=~/.config/parley/token \
PARLEY_AGENT_ID=codex-agent \
PARLEY_CALLER_RUNTIME_REF=codex:agent:codex-agent \
parley where-am-i --board project
```

A healthy response should resolve `codex-agent`, show the `project` board, and return obligation/recovery guidance.
