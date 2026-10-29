# Hazel infrastructure

Everything that runs on Cloudflare is declared with [Alchemy v2](https://alchemy.run) (the Effect
version) in `alchemy.run.ts`. Each app declares its own resources:

| App          | Declared in                                     | Runs as                                                                                                              |
| ------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| web          | `apps/web-foldkit/alchemy.run.ts`               | `Website.StaticSite` (Vite SPA, assets only)                                                                         |
| landing      | `apps/landing/alchemy.run.ts`                   | `Website.StaticSite` (Astro) — prd only                                                                              |
| docs         | `apps/docs/alchemy.run.ts`                      | `Website.Vite` (TanStack Start SSR) — not deployed yet: docs.hazel.sh stays on Vercel                                |
| link-preview | `apps/link-preview-worker/alchemy.run.ts`       | async Worker + KV                                                                                                    |
| bot-gateway  | `apps/bot-gateway/alchemy.run.ts`               | Effect Worker relaying bot WebSockets + `BotGateway` Durable Object per bot (SQLite event log)                       |
| api          | `apps/backend/src/worker.ts`                    | Effect Worker + Durable Objects (Org, Channel, User: the data; MessageLive; RateLimiter, DiscordGateway) + KV + cron |
| directory    | `packages/infra/src/cloudflare/directory-db.ts` | D1 `DIRECTORY_DB` (users, auth, bots, routing indexes), bound by api and bot-gateway                                 |

Shared deploy-time helpers (stage parsing, the `HazelStack` context, env/secret helpers, Worker
runtime glue) live in `packages/infra`. Data and sync are designed in
[`durable-object-sync-plan.md`](./durable-object-sync-plan.md).

Data lives in the Durable Objects and D1, uploads in R2, and the background work runs in the
objects. **Not on Cloudflare (yet):** `bots/*` are being rewritten as Workers.

## Stages

| Stage        | Command                                   | Data                                           | Domains                                      |
| ------------ | ----------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `prd`        | `bun run alchemy:deploy:prd`              | the stage's D1 + Durable Objects               | `*.hazel.sh`                                 |
| `pr-<n>`     | `PR_NUMBER=<n> bun run alchemy:deploy:pr` | its own D1 + Durable Objects (empty on create) | `app-pr-<n>.hazel.sh`, `api-pr-<n>.hazel.sh` |
| `dev_<user>` | `bun run alchemy:dev`                     | local, in `.alchemy/`; reads `.env.local` only | workers.dev / localhost                      |

Local dev needs `.env.local` (`.env.local.example`, or `bun run setup`) and MinIO for uploads
(`docker compose up -d`).

prd keeps the wrangler-era Worker and KV names (`hazel-app`, `hazel-landing`,
`link-preview-worker`, `link-preview-worker-link-cache`), and `--adopt` takes them over in place
on the first deploy.

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

## Decommissioning the Postgres stack

The Postgres, Electric, cluster and RivetKit code is gone (`durable-object-sync-plan.md` has the
cutover). What is left lives outside the repo:

- **PlanetScale.** The old stack declared the `hazel` database (`RemovalPolicy.retain`) and the
  roles `db-api-role`, `db-electric-role` and `db-cluster-role`, plus the `HAZEL_DB` Hyperdrive.
  They are no longer declared, so the next successful prd deploy deletes the roles and the
  Hyperdrive and drops the database from state without deleting it. That needs the PlanetScale
  provider, which `alchemy.run.ts` registers until then; remove it after that deploy. Dropping the
  database itself is a manual, irreversible step in PlanetScale.
- **Railway** (backend, cluster, Electric, Redis, the OTel collector) and **Electric Cloud**:
  shut down from their dashboards.
