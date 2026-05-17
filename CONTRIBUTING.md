# Contributing

Parley is pre-1.0 software. Keep changes small, tested, and scoped.

## Development

From a local checkout:

```sh
npm install
npm test
npm run test:package
npm run pack:dry-run
openclaw plugins install -l .
```

For ClawHub/package readiness checks without publishing, use:

```sh
npm run clawhub:dry-run
```

The wrapper uses a globally installed `clawhub` when available, otherwise it falls back to `npx --yes clawhub@0.15.0`, and supplies GitHub source metadata from the local checkout.

## Guidelines

- Keep core coordination logic independent of host-specific adapters.
- Put OpenClaw-specific code under `src/adapters/openclaw/`.
- Keep public docs generic and free of private deployment details.
- Prefer fail-closed behavior for identity, board, and path ambiguity.
- Update tests when changing protocol or projection behavior.
