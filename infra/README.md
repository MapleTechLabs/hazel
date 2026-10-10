# Hazel infrastructure

Everything that runs on Cloudflare is declared with [Alchemy v2](https://alchemy.run) (the Effect
version) in `alchemy.run.ts`. Each app declares its own resources:

| App            | Declared in                                 | Runs as                                                                                                                                 |
| -------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| web            | `apps/web/alchemy.run.ts`                   | `Website.StaticSite` (Vite SPA, assets only)                                                                                            |
| landing        | `apps/landing/alchemy.run.ts`               | `Website.StaticSite` (Astro) — prd only                                                                                                 |
| docs           | `apps/docs/alchemy.run.ts`                  | `Website.Vite` (TanStack Start SSR) — prd only                                                                                          |
| link-preview   | `apps/link-preview-worker/alchemy.run.ts`   | async Worker + KV                                                                                                                       |
| actors         | `apps/actors/alchemy.run.ts`                | async Worker + RivetKit Durable Object + KV                                                                                             |
| electric-proxy | `apps/electric-proxy/alchemy.run.ts`        | Effect Worker + KV; forwards to the `electric` Worker                                                                                   |
| electric       | `apps/electric-proxy/resources.ts`          | async Worker hosting self-hosted Electric in a Container (one instance)                                                                 |
| bot-gateway    | `apps/bot-gateway/alchemy.run.ts`           | Effect Worker relaying bot WebSockets + `BotGateway` Durable Object per bot (SQLite event log; replaces Durable Streams + Redis leases) |
| api            | `apps/backend/src/worker.ts`                | Effect Worker + Durable Objects (RateLimiter, OutboxDispatcher, DiscordGateway) + KV + cron                                             |
| database       | `packages/infra/src/cloudflare/hazel-db.ts` | PlanetScale Postgres (prd) + `HAZEL_DB` Hyperdrive                                                                                      |

Shared deploy-time helpers (stage parsing, the `HazelStack` context, env/secret helpers, Worker
runtime glue) live in `packages/infra`. The design and the decisions behind it are in
[`cloudflare-migration-plan.md`](./cloudflare-migration-plan.md).

**Not on Cloudflare (yet):** `apps/cluster` (Effect Cluster workflows + crons) stays on Railway;
`bots/*` are rewritten as Workers in a follow-up.

## Stages

| Stage        | Command                                   | Database                                       | Domains                                      |
| ------------ | ----------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `prd`        | `bun run alchemy:deploy:prd`              | PlanetScale `hazel`, managed by the stack      | `*.hazel.sh`                                 |
| `pr-<n>`     | `PR_NUMBER=<n> bun run alchemy:deploy:pr` | `HAZEL_PG_URL` (shared preview DB)             | `app-pr-<n>.hazel.sh`, `api-pr-<n>.hazel.sh` |
| `dev_<user>` | `bun run alchemy:dev`                     | docker Postgres (`docker compose up postgres`) | workers.dev / localhost                      |

prd keeps the wrangler-era Worker and KV names (`hazel-app`, `hazel-landing`,
`link-preview-worker`, `hazel-actors`, `hazel-actor-kv`, `link-preview-worker-link-cache`), and
`--adopt` takes them over in place on the first deploy.

## Credentials

Alchemy reads its own credentials from the environment (or an `alchemy profile`):

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (the "Maki Account", `189f0e30…`)
- `PLANETSCALE_API_TOKEN_ID`, `PLANETSCALE_API_TOKEN`, `PLANETSCALE_ORGANIZATION` (prd only)
- `MAPLE_API_KEY` (optional): an org-admin Maple API key with `ingest_keys:read`. With it, the
  stack reads the org's ingest keys (`@maple-dev/alchemy`) and binds the private one onto the
  Effect Workers (api, electric-proxy, bot-gateway), which export traces, logs and metrics through
  the Maple SDK (`packages/infra/src/cloudflare/maple.ts`). Without it, and under `alchemy dev`,
  the SDK is a no-op.

Locally, `bunx alchemy profile refresh --profile default --provider Cloudflare` re-authenticates
the default profile.

Worker env (secrets are uploaded as Worker secrets, plain values as vars) is listed in
`apps/backend/src/worker/env.ts` and in each app's `alchemy.run.ts`. CI passes them from the
`production` / `pr-preview` GitHub Environments (`.github/workflows/deploy-*.yml`).

## First prd deploy (cutover)

1. **Plan first.** `bunx alchemy plan --stage prd` and check that the existing Workers, KV
   namespaces and custom domains show as _adopt/update_, not _create/replace_.
2. **Database.** The first deploy creates the PlanetScale database `hazel` and its roles.
    - Load the schema with `drizzle-kit push` (packages/db) against the API role's URL.
    - Copy the data over in a maintenance window (`pg_dump` from the current host, then restore).
    - Repoint the Railway services (backend, cluster) at PlanetScale first, so the database moves
      before any compute does.
3. **Cluster (Railway).**
    - Set `DATABASE_URL` / `EFFECT_DATABASE_URL` to the cluster role's connection string.
    - Set `CLUSTER_API_SECRET` (the same value as the api Worker's).
    - Set `OTEL_BASE_URL=https://ingest.maple.dev` and `MAPLE_INGEST_KEY`, then delete the OTel
      collector service.
    - Give the cluster a public domain and set the api Worker's `CLUSTER_URL` to it.
4. **api.** Deploy, then move `api.hazel.sh` to the Worker. It is a custom domain on the Worker,
   so alchemy creates the DNS record; remove the Railway domain first.
    - The outbox dispatcher runs on both sides during the overlap; claims use `SKIP LOCKED`, so no
      event is processed twice.
5. **Discord gateway.** Set `DISCORD_GATEWAY_ENABLED=true` on the Worker _and_ `false` on the
   Railway backend in the same window: Discord allows one session per bot token.
6. Keep Railway's backend running for a week as a rollback, then delete it (with Redis and the
   collector).

## Cutover log (2026-10-10, local deploy via `bun run alchemy:deploy:prd:local`)

- Secrets live in the Hazel Infisical project (`9e94bb4d-…`, env `prod`); copied from Railway `api`, `CLUSTER_API_SECRET` and `ELECTRIC_SECRET` generated.
- Cluster: `CLUSTER_API_SECRET` set on Railway `api` and `cluster`; public domain `cluster-production-6155.up.railway.app` (port 3001) is `CLUSTER_URL`.
- Moved to Cloudflare: `api.hazel.sh` (`hazel-api`), `electric.hazel.sh` (`hazel-electric-proxy`), `bot-gateway.hazel.sh`.
- Electric itself runs on Railway (service `electric`, volume at `/app/persistent`, PlanetScale role `electric-railway` with replication); `ELECTRIC_URL` = `electric-production-0d89.up.railway.app`. Electric runs with `ELECTRIC_MANUAL_TABLE_PUBLISHING=true` and `ELECTRIC_DB_POOL_SIZE=4` (PS-5 allows 50 connections): the synced tables plus `channel_access` were added to `electric_publication_default` by hand (owned by `postgres`; Electric's role cannot alter it), so a newly synced table must be added there too. The Cloudflare Container was removed: always-on it cost several times more and lost its disk on every restart. `app.hazel.sh` serves `apps/web-foldkit`.
- Rollback DNS (all unproxied CNAMEs, detach the Worker custom domain first): `api` → `j0tqzlof.up.railway.app`, `electric` → `2hg74iuk.up.railway.app`, `bot-gateway` → `s3t62x1p.up.railway.app` (was proxied).
- Not done yet: Discord gateway flip (Worker `false`, Railway still runs it), `MAPLE_API_KEY` for Worker telemetry to Maple, docs.hazel.sh stays on Vercel, GitHub `production` environment secrets for CI deploys. Link previews return `INVALID_URL` for every URL (already broken on the June build).
