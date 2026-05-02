# Contributing

Parley is early alpha software. Keep changes small, tested, and scoped.

## Development

```sh
npm install
npm test
```

## Guidelines

- Keep core coordination logic independent of host-specific adapters.
- Put OpenClaw-specific code under `src/adapters/openclaw/`.
- Keep public docs generic and free of private deployment details.
- Prefer fail-closed behavior for identity, board, and path ambiguity.
- Update tests when changing protocol or projection behavior.
