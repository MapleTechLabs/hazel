# Hazel Backend

The api Cloudflare Worker for Hazel Chat (`src/worker.ts`): the HTTP API, RPC, and the Durable
Objects that hold the data (`src/worker/objects/`: `OrgObject`, `ChannelObject`, `UserObject`)
over the directory D1 database. See `infra/durable-object-sync-plan.md`.

## Tech Stack

- **Cloudflare Workers** and **Durable Objects**, via Alchemy
- **Effect-TS** for functional programming and dependency injection
- **Effect RPC** for type-safe APIs
- **effect-orm** on SQLite (Durable Object storage, D1)
- **Hazel auth** (`@hazel/auth`) for sign-in and sessions

## Development

The backend runs only as a Worker. Start the whole stack from the monorepo root:

```bash
bun run alchemy:dev
```

Tests run on in-memory node SQLite: `bun run test`.
