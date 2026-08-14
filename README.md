# VAL Checker

VAL Checker is being built in staged tracks. Track B is complete and currently in hardening; Track C remains blocked by the 14-day durability gate. See the [roadmap](docs/roadmap.md) for the phase boundaries and gate.

## Requirements

- Node.js 22 or newer
- pnpm 11.19.0
- Docker Desktop or Podman for local Supabase integration tests

Install dependencies with `pnpm install`.

## Tests

Run unit tests without Supabase:

```shell
pnpm test:unit
```

Integration tests use only the local Supabase stack. Start it before running them:

```shell
pnpm supabase:start
pnpm test:integration
```

Run both suites with:

```shell
pnpm test
```

Because the full command includes integration tests, the local Supabase stack must already be running. Stop it afterward with `pnpm supabase:stop` when it is no longer needed.

The test suites do not make live Riot requests or depend on other external services.
