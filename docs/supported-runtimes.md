# Supported runtimes

Parley is harness-agnostic at the coordination layer. Runtime integrations provide caller identity, service configuration, and a way to call Parley tools, CLI commands, HTTP routes, or client modules.

Parley does not run agents. The runtime or harness owns execution. Parley owns durable coordination state and recovery surfaces.

## Current integration surfaces

| Runtime / surface | Status | Notes |
|---|---|---|
| OpenClaw | Primary adapter | Full plugin/tool integration through `plugin.js` and the OpenClaw tool registry |
| Codex CLI | Wrapper-supported | Use `parley-codex` to launch Codex with Parley client-mode environment |
| Custom scripts | Supported through CLI/HTTP | Provide Parley service URL, credentials, caller identity, and explicit board IDs |
| Other harnesses | Adapter possible | Integrate by calling the Parley service or package exports and providing identity metadata |

## Environment contract

Common client-mode environment variables:

| Variable | Purpose |
|---|---|
| `PARLEY_MODE=client` | Forces client mode |
| `PARLEY_API_URL` | Parley service URL |
| `PARLEY_AUTH_TOKEN_FILE` | Path to a bearer token file for protected service routes |
| `PARLEY_AUTH_TOKEN` | Inline bearer token for controlled local/dev usage; prefer token files for deployments |
| `PARLEY_AGENT_ID` | Durable Parley actor identity |
| `PARLEY_DEFAULT_BOARD` | Optional default board hint |
| `PARLEY_CALLER_RUNTIME` | Runtime scheme, such as `openclaw` or `codex` |
| `PARLEY_CALLER_RUNTIME_REF` | Stable runtime reference, such as `codex:agent:codex-agent` |
| `PARLEY_CALLER_RUNTIME_ALIASES` | Optional ephemeral session aliases, such as `codex:session:<id>` |
| `PARLEY_SESSION_ID` | Runtime/session provenance |
| `PARLEY_WORKER_SURFACE` | Surface label such as `codex-cli` |
| `PARLEY_HOST_ID` | Host provenance used by wrappers and generated session metadata |
| `PARLEY_WORKSPACE` | Workspace provenance |

The wrapper or environment does not grant authority by itself. Authority comes from Parley registry identity resolution, board membership, and board-local permissions.

## Identity contract

A runtime integration should provide a stable runtime reference for the durable actor and may provide ephemeral aliases for sessions or workers.

Example Codex CLI identity:

```text
PARLEY_CALLER_RUNTIME=codex
PARLEY_CALLER_RUNTIME_REF=codex:agent:codex-agent
PARLEY_CALLER_RUNTIME_ALIASES=codex:session:codex-host-20260516T220000Z-12345
```

The Parley registry must bind the durable runtime reference before that caller can gain board authority:

```json
{
  "parleyRegistry": {
    "agents": {
      "codex-agent": {
        "runtime_bindings": [
          { "scheme": "codex", "type": "agent", "id": "codex-agent" }
        ],
        "default_board": "project",
        "memberships": {
          "project": {
            "board_agent_id": "codex-agent",
            "roles": ["implementation"]
          }
        }
      }
    }
  }
}
```

Session aliases are provenance and recovery hints. They should not be the only durable authority binding for long-running work.

## Board contract

Board-scoped operations should pass an explicit `boardId` even when a default board is configured.

A typical recovery sequence is:

```text
parley_describe
parley_where_am_i
parley_where_am_i({ boardId: "project" })
parley_query_board_obligations({ boardId: "project", filter: "needs_my_action" })
```

Use `default_board` as a selection hint, not as implicit authority.

## OpenClaw

OpenClaw is the primary adapter today. It registers Parley tools, derives caller runtime metadata from trusted OpenClaw context, and routes calls through standalone/local or client/service mode according to configuration.

For service-backed multi-agent coordination, configure the OpenClaw plugin in `client` mode with a Parley service URL, bearer token file, caller agent id, and optional default board.

## Codex CLI

`parley-codex` launches Codex with Parley client-mode environment variables. It is intentionally thin: it prepares environment and provenance, then execs the configured Codex command.

Use `parley-codex --dry-run` or `parley-codex --print-env` to inspect the sanitized launch environment before running Codex.

See `../examples/codex-cli-client/README.md` for a starter flow.

## Custom scripts and future adapters

Custom scripts can integrate through the CLI, HTTP service, or package exports. They should:

1. run in `client` mode when sharing a backend,
2. provide a stable caller identity,
3. use explicit board IDs for board-scoped work,
4. record significant external changes as artifacts, effects, checkpoints, or obligation updates,
5. treat Parley guidance as recovery/action context, not as a host permission grant.
