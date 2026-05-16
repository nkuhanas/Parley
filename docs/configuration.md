# Configuration

Parley resolves runtime configuration through an explicit mode contract before any local state writes.

## Runtime mode

Installation source and runtime mode are separate choices: ClawHub or npm installs the package, while `PARLEY_MODE` / `parleyMode` decides how tools store or reach Parley state.

Set `PARLEY_MODE` or plugin/config `parleyMode` to one of:

- `standalone`: intentional local file-backed Parley state.
- `service`: authoritative service process with an explicit DB path.
- `client`: remote-only client; requires `PARLEY_API_URL`/`parleyApiUrl` and must not configure local state paths.
- `test`: isolated temp/test state only.

Surface-aware defaulting is intentionally narrow: direct human CLI may default to `standalone` and report its state root, but the OpenClaw adapter must receive an explicit mode. Client mode and unset OpenClaw adapter mode fail before creating local state.

## Common fields

- `parleyMode`: explicit runtime mode for adapter/configured use.
- `parleyStateRoot`: base state root for intentional standalone local usage.
- `parleyRuntimeRoot`: directory for thread/message runtime state in standalone/test usage.
- `parleyApiUrl`: remote service URL for client mode.
- `parleyAuthTokenFile`: file containing a bearer token for client-mode service calls or service protected-route auth.
- `parleyAuthToken`: inline bearer token for client-mode service calls or service protected-route auth. Prefer `parleyAuthTokenFile` for deploys.
- `parleyAgentId`: default caller agent id when runtime context does not provide one.
- `parleyDefaultBoard`: default board for discovery/read clients; board-scoped writes should still pass `boardId` explicitly.
- `parleyDbPath`: service-mode SQLite DB path; must not live inside the repo checkout, the default OpenClaw workspaces root, or configured forbidden roots.
- `parleyRoot`: base directory for board data in standalone/local board usage.
- `parleyRegistry`: global agent registry.
- `parleyBoards`: explicitly configured boards.
- `parleyDefaultBoards`: optional host-provided default boards.

Configuration precedence is: explicit plugin/tool configuration, then JSON object loaded from `PARLEY_CONFIG`, then environment variables. OpenClaw adapter context has no unsafe implicit local default: unset mode raises `PARLEY_MODE_REQUIRED` during registration, before local state layout is created.

## OpenClaw adapter

The OpenClaw adapter is a strict configured surface:

- `parleyMode=client` / `PARLEY_MODE=client` uses the remote SDK/service (`parleyApiUrl` or `PARLEY_API_URL` is required) and refuses local state or DB path inputs.
- `parleyMode=standalone` / `PARLEY_MODE=standalone` uses the embedded client and intentional file-backed local state.
- unset mode fails closed with `PARLEY_MODE_REQUIRED` before registering tools against local storage.
- service-backed query and mutate tools preserve their existing OpenClaw names/descriptors and route through the same service boundary used by the remote client. Runtime transport tools that are not yet exposed by the HTTP service fail clearly in client mode instead of touching local runtime state.

A typical OpenClaw client configuration contains only the remote service connection plus caller identity hints:

```json
{
  "parleyMode": "client",
  "parleyApiUrl": "http://127.0.0.1:7331",
  "parleyAuthTokenFile": "/etc/parley/token",
  "parleyAgentId": "my-agent",
  "parleyDefaultBoard": "project"
}
```

Keep bearer values in files for deployments. Inline token configuration exists for local tests and controlled development environments.

## Service SQLite ledger

Service mode uses a boring SQLite ledger for MVP durability: records are stored by scope, board id, collection, record id, JSON body, and metadata/version. The DB is a ledger boundary, not the Parley domain model; plans, obligations, artifacts, relationships, and effects remain canonical JSON records at this layer.

Before starting a service process against a new or upgraded DB, run the idempotent migration command:

```sh
PARLEY_MODE=service PARLEY_DB_PATH=/var/lib/parley/parley.sqlite parley migrate
```

From a repo checkout without an installed `parley` bin, use:

```sh
PARLEY_MODE=service PARLEY_DB_PATH=/var/lib/parley/parley.sqlite npm run cli -- migrate
```

Start the HTTP service with the daemon entrypoint:

```sh
PARLEY_MODE=service \
PARLEY_DB_PATH=/var/lib/parley/parley.sqlite \
PARLEY_AUTH_TOKEN_FILE=/etc/parley/token \
parleyd
```

The daemon binds `127.0.0.1:7331` by default and prints a JSON ready event. Use `PARLEY_HOST`/`PARLEY_PORT` or `--host`/`--port` to override the bind address. Protected routes require bearer auth by default; `/health` is unauthenticated.

For deploys, stop or quiesce the service and take a filesystem/volume backup of the SQLite DB path before running migrations. Migrations are designed to be safe to rerun, but backup-before-migrate is the deployment contract until production orchestration is added.

Keep `PARLEY_DB_PATH` outside the repo checkout and outside OpenClaw workspaces. Use `parleyForbiddenDbRoots`/`forbiddenDbRoots` to add site-specific forbidden locations.

## Git-backed deployment helpers

`tools/deploy/deploy-parley <commit-or-tag>` and `tools/deploy/rollback-parley <commit-or-tag> [db-backup.sqlite]` provide a small commit-pinned deploy/rollback shape for service hosts. The helpers require a clean deployment checkout, fetch tags, check out the requested ref, install dependencies, and health-check the service. Deploy also backs up the DB before migration. Configure paths with `PARLEY_DEPLOY_REPO`, `PARLEY_DEPLOY_DB`, `PARLEY_DEPLOY_BACKUP_DIR`, `PARLEY_DEPLOY_SERVICE`, and `PARLEY_DEPLOY_HEALTH_URL`.

## Agent registry

```js
parleyRegistry: {
  agents: {
    "my-agent": {
      display_name: "My Agent",
      kind: "agent",
      runtime_bindings: [
        { scheme: "openclaw", type: "agent", id: "my-agent" }
      ],
      default_board: "project",
      memberships: {
        project: {
          board_agent_id: "my-agent",
          roles: ["implementation"],
          permissions: { preset: "board_admin" }
        }
      }
    }
  }
}
```

## Board config

```js
parleyBoards: {
  project: {
    board_id: "project",
    display_name: "Project",
    board_root: "~/.local/share/parley/boards/project",
    artifact_namespaces: [
      {
        id: "project_plans",
        roles: ["plan_landing", "explicit_landing", "reference"],
        default_for: ["plan_landing"],
        uri_prefix: "repo://plans/",
        resolved_root: "~/projects/example/plans"
      }
    ],
    members: [
      { agent_id: "my-agent", board_agent_id: "my-agent" }
    ]
  }
}
```

Use explicit `boardId` for every board-scoped operation. `default_board` helps callers choose a board after discovery, but Parley does not silently route board-scoped tools to it.

## Namespace safety

Artifact namespaces are trust boundaries. Parley tools may search reference namespaces and return matching paths and excerpts, and plan/artifact tools may write under landing namespaces. Configure `artifact_namespaces[].resolved_root` to the smallest project/docs/plans directory that agents need. Avoid broad roots such as `$HOME`, an entire vault, `.ssh`, credential stores, directories with `.env` files, or any path containing unrelated secrets.

Use `allowed_subpaths` when only part of a namespace should accept generated or landed artifacts.
