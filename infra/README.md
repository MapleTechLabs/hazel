# Hazel infrastructure

Everything that runs on Cloudflare is declared with [Alchemy v2](https://alchemy.run) (the Effect
version) in `alchemy.run.ts`. Each app declares its own resources:

| App          | Declared in                                     | Runs as                                                                                                                                 |
| ------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| web          | `apps/web-foldkit/alchemy.run.ts`               | `Website.StaticSite` (Vite SPA, assets only)                                                                                            |
| landing      | `apps/landing/alchemy.run.ts`                   | `Website.StaticSite` (Astro) — prd only                                                                                                 |
| docs         | `apps/docs/alchemy.run.ts`                      | `Website.Vite` (TanStack Start SSR) — prd only                                                                                          |
| link-preview | `apps/link-preview-worker/alchemy.run.ts`       | async Worker + KV                                                                                                                       |
| bot-gateway  | `apps/bot-gateway/alchemy.run.ts`               | Effect Worker relaying bot WebSockets + `BotGateway` Durable Object per bot (SQLite event log; replaces Durable Streams + Redis leases) |
| api          | `apps/backend/src/worker.ts`                    | Effect Worker + Durable Objects (Org, Channel, User: the data; MessageLive; RateLimiter, DiscordGateway) + KV + cron                    |
| directory    | `packages/infra/src/cloudflare/directory-db.ts` | D1 `DIRECTORY_DB` (users, auth, bots, routing indexes), bound by api and bot-gateway                                                    |

Shared deploy-time helpers (stage parsing, the `HazelStack` context, env/secret helpers, Worker
runtime glue) live in `packages/infra`. The design and the decisions behind it are in
[`cloudflare-migration-plan.md`](./cloudflare-migration-plan.md) and, for data and sync,
[`durable-object-sync-plan.md`](./durable-object-sync-plan.md) (which supersedes the old plan's
Postgres, Electric and cluster parts).

There is no Postgres, Electric or cluster: data lives in the Durable Objects and D1, and the
background work runs in the objects. **Not on Cloudflare (yet):** `bots/*` are rewritten as
Workers in a follow-up.

## Stages

| Stage        | Command                                   | Data                                           | Domains                                      |
| ------------ | ----------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `prd`        | `bun run alchemy:deploy:prd`              | the stage's D1 + Durable Objects               | `*.hazel.sh`                                 |
| `pr-<n>`     | `PR_NUMBER=<n> bun run alchemy:deploy:pr` | its own D1 + Durable Objects (empty on create) | `app-pr-<n>.hazel.sh`, `api-pr-<n>.hazel.sh` |
| `dev_<user>` | `bun run alchemy:dev`                     | local, in `.alchemy/`; reads `.env.local` only | workers.dev / localhost                      |

Local dev needs `.env.local` (`.env.local.example`, or `bun run setup`) and MinIO for uploads
(`docker compose up -d`).

prd keeps the wrangler-era Worker and KV names (`hazel-app`, `hazel-landing`,
`link-preview-worker`, `hazel-actors`, `hazel-actor-kv`, `link-preview-worker-link-cache`), and
`--adopt` takes them over in place on the first deploy.

## Credentials

Alchemy reads its own credentials from the environment (or an `alchemy profile`):

- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (the "Maki Account", `189f0e30…`)
- `MAPLE_API_KEY` (optional): an org-admin Maple API key with `ingest_keys:read`. With it, the
  stack reads the org's ingest keys (`@maple-dev/alchemy`) and binds the private one onto the
  Effect Workers (api, bot-gateway), which export traces, logs and metrics through
  the Maple SDK (`packages/infra/src/cloudflare/maple.ts`). Without it, and under `alchemy dev`,
  the SDK is a no-op.
  On prd it also declares Hazel's monitoring in Maple (`packages/infra/src/cloudflare/maple-monitoring.ts`):
  a "Hazel services" dashboard, plus error-rate and p95 alert rules per Worker (needs a key that
  is also allowed `dashboards:write` and `alerts:write`).
- `MAPLE_ALERTS_WEBHOOK_URL` (optional, prd): the alert rules' destination, a Hazel channel's
  Maple webhook URL (Integrations → Maple in Hazel, `…/webhooks/incoming/<id>/<token>/maple`).
  Without it only the dashboard is declared.

Locally, `bunx alchemy profile refresh --profile default --provider Cloudflare` re-authenticates
the default profile.

Worker env (secrets are uploaded as Worker secrets, plain values as vars) is listed in
`apps/backend/src/worker/env.ts` and in each app's `alchemy.run.ts`. CI passes them from the
`production` / `pr-preview` GitHub Environments (`.github/workflows/deploy-*.yml`).

## Durable Object cutover (prd)

Instant, with some data loss accepted (`durable-object-sync-plan.md`):

1. **Plan first.** `bunx alchemy plan --stage prd`: expect the D1 `directory` and the object
   classes to be created, `OutboxDispatcher` deleted (alchemy emits its `deleted_classes`
   migration), and the `electric-proxy` Worker and PlanetScale/Hyperdrive resources destroyed.
2. **Deploy** with `IMPORT_SECRET` and `IMPORT_ENABLED=true` in the deploy env (by hand; not in CI).
3. **Import** the old Postgres (read-only from here on):
   `bun run --cwd apps/backend import-postgres --from <postgres url> --to https://api.hazel.sh --secret <IMPORT_SECRET>`.
   Run it with `--dry-run` first to see the row counts per target.
4. **Discord gateway.** Set `DISCORD_GATEWAY_ENABLED=true` on the Worker and turn it off wherever
   else it runs: Discord allows one session per bot token.
5. Redeploy without `IMPORT_SECRET` / `IMPORT_ENABLED`, then decommission Railway (backend, cluster, Electric, Redis), Electric
   Cloud and the PlanetScale database once nothing reads them.

## Cutover log (2026-10-10, local deploy via `bun run alchemy:deploy:prd:local`)

Historical: the Postgres/Electric/cluster setup below is replaced by the Durable Object cutover.

- Secrets live in the Hazel Infisical project (`9e94bb4d-…`, env `prod`); copied from Railway `api`, `CLUSTER_API_SECRET` and `ELECTRIC_SECRET` generated.
- Cluster: `CLUSTER_API_SECRET` set on Railway `api` and `cluster`; public domain `cluster-production-6155.up.railway.app` (port 3001) is `CLUSTER_URL`.
- Moved to Cloudflare: `api.hazel.sh` (`hazel-api`), `electric.hazel.sh` (`hazel-electric-proxy`), `bot-gateway.hazel.sh`.
- Electric itself runs on Railway (service `electric`, volume at `/app/persistent`, PlanetScale role `electric-railway` with replication); `ELECTRIC_URL` = `electric-production-0d89.up.railway.app`. Electric runs with `ELECTRIC_MANUAL_TABLE_PUBLISHING=true` and `ELECTRIC_DB_POOL_SIZE=4` (PS-5 allows 50 connections): the synced tables plus `channel_access` were added to `electric_publication_default` by hand (owned by `postgres`; Electric's role cannot alter it), so a newly synced table must be added there too. The Cloudflare Container was removed: always-on it cost several times more and lost its disk on every restart. `app.hazel.sh` serves `apps/web-foldkit`.
- Rollback DNS (all unproxied CNAMEs, detach the Worker custom domain first): `api` → `j0tqzlof.up.railway.app`, `electric` → `2hg74iuk.up.railway.app`, `bot-gateway` → `s3t62x1p.up.railway.app` (was proxied).
- Not done yet: Discord gateway flip (Worker `false`, Railway still runs it), `MAPLE_API_KEY` for Worker telemetry to Maple and `MAPLE_ALERTS_WEBHOOK_URL` for its alerts, docs.hazel.sh stays on Vercel, GitHub `production` environment secrets for CI deploys. Link previews return `INVALID_URL` for every URL (already broken on the June build).
