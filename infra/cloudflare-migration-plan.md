# Hazel → 100% Cloudflare, infra as Alchemy v2 (Effect)

Reference implementation: `../maple` (alchemy `2.0.0-beta.80`, Effect 4). Copy API names from
`maple/node_modules/alchemy/lib`, **not** from the local `alchemy-effect` checkout (beta.36, older names).

## Where we are today

| Piece                                | Runs on                        | Target                                                            |
| ------------------------------------ | ------------------------------ | ----------------------------------------------------------------- |
| `apps/web` (Vite SPA)                | CF Workers assets (wrangler)   | `Cloudflare.Website.Vite`                                         |
| `apps/landing` (Astro)               | CF Workers assets (wrangler)   | `Cloudflare.Website.StaticSite` / `Astro`                         |
| `apps/link-preview-worker`           | CF Worker + KV (wrangler)      | `Cloudflare.Worker` + `KV.Namespace`                              |
| `apps/actors` (RivetKit)             | CF Worker + DO + KV (wrangler) | `Cloudflare.Worker` + DO + KV                                     |
| `apps/docs` (TanStack Start/Nitro)   | unclear                        | Worker (Nitro `cloudflare-module`)                                |
| `apps/electric-proxy`                | Railway, Bun                   | Worker (template: `maple/apps/electric-sync`)                     |
| `apps/backend`                       | Railway, Bun                   | Worker `api` + DOs + Queues + Cron                                |
| `apps/cluster` (Effect Cluster)      | Railway, Bun                   | **stays on Railway for now** (deferred; Phase 5)                  |
| `apps/bot-gateway` + Durable Streams | Railway, Bun/Node              | `BotGateway` Durable Object per bot                               |
| Redis                                | Railway                        | gone: RateLimit / KV / DOs                                        |
| OTel collector                       | Railway                        | gone: Workers observability → Maple                               |
| Object storage                       | R2 via S3 API (Bun `s3`)       | native R2 binding + presign helpers                               |
| Postgres                             | external                       | **PlanetScale Postgres managed by alchemy** + Hyperdrive          |
| Electric                             | Electric Cloud                 | **self-hosted in a `Cloudflare.Container`** behind electric-proxy |
| `bots/*`                             | Bun                            | **follow-up**: rewrite as Workers (out of scope here)             |

Target = all compute on Cloudflare, including Electric, **except `apps/cluster`**, which stays on
Railway for now. Postgres is off Cloudflare too: a PlanetScale database declared in the same alchemy
stack.

**Decisions (2026-10-05)**

- Postgres: PlanetScale, managed by alchemy.
- Electric: self-host it on CF Containers.
- Bots: rewrite as Workers in a separate follow-up.
- Cluster: **stays on Railway for now**; the Workflows port is deferred (see Phase 5).

---

## Phase 0: Alchemy foundation (no behaviour change)

1. **Deps**: add to root catalog `alchemy: 2.0.0-beta.80`, `@cloudflare/workers-types`, and a
   `workerd` override matching maple.
2. **`packages/infra` (`@hazel/infra`)**: port from `maple/packages/infra/src`:
    - `cloudflare/stage.ts`: parses `prd | pr-<n> | dev_<user>` and provides `resolveWorkerName`.
    - `cloudflare/stack.ts`: `HazelStack` `Context.Service` (stage, domains, urls, db) plus
      sibling-Worker services (`ApiWorker`, …). `Worker.ref` can't see siblings in the same deploy.
    - `stageProps` / `stageNamed`, guarded by `__ALCHEMY_RUNTIME__`.
    - `env.ts`: `optionalPlain`, `optionalSecret`, `requireSecretEntry` and `merge`. `Redacted` values
      become Worker secrets. Each app keeps a typed env catalog. **Never call `Config.*` inside a
      Worker init**, because at plan time it becomes an auto-bound secret.
    - `worker-runtime.ts`: env → `ConfigProvider` (`reifyBoundConfigProvider`), so existing
      `Config.String(...)` reads keep working at runtime.
    - `worker-http.ts`, `cached-recoverable.ts`: `WorkerPlatformLive`, `isolateContext` and the lazy
      per-isolate `HttpRouter.toHttpEffect` cache. The router is never built during init.
    - `worker-telemetry.ts`, `observability.ts`: Maple OTLP from Workers.
    - `hazel-db.ts`: `Cloudflare.Hyperdrive.Connection("HAZEL_DB", …)` with `caching.disabled` and a
      `dev:` origin pointing at docker Postgres, plus `readHazelDbBinding(env)`.
3. **Root `alchemy.run.ts`** + `tsconfig.alchemy.json`:
    - `Alchemy.Stack("hazel", { providers, state })`. State is `Cloudflare.state()`, or
      `Alchemy.localState()` when `ALCHEMY_LOCAL_STATE` is set.
    - The stack yields each Worker class and returns URLs as outputs.
4. **Port the already-CF apps** and delete their `wrangler.jsonc`. Deploy with `--adopt` so existing
   Workers, KV and domains are adopted, not recreated:
    - `web` → `Website.Vite` (SPA not-found handling; `VITE_*` in `env` gets inlined at build).
    - `landing` → `Website.StaticSite` / `Website.Astro`.
    - `link-preview-worker` → class-form `Cloudflare.Worker` + `KV.Namespace("LINK_CACHE")`.
    - `actors` → Worker + DO namespace + KV. **Risk:** RivetKit ships its own `ActorHandler` DO class,
      not an alchemy `Cloudflare.DurableObject`. Spike binding a foreign DO class (raw `bindings`)
      before anything else in this phase.
    - `docs` → Worker from the Nitro `cloudflare-module` output.
5. **Scripts** (mirroring maple): `alchemy:deploy:prd`, `alchemy:deploy:pr`, `alchemy:destroy:pr`.
   `dev` runs `alchemy dev --stage dev_$USER --env-file .env.local` with local state.

**Exit:** `alchemy deploy --stage prd` reproduces today's CF footprint with zero diff in behaviour.

## Phase 1: Data plane

- **Postgres (PlanetScale, alchemy-managed)**, following maple's `alchemy.run.ts`:
    - `Planetscale.PostgresBranch("hazel-db-main", { database, name: "main", migrations: "packages/db/drizzle" })`
      with `RemovalPolicy.retain()`. Drizzle migrations are applied by the stack.
    - App role: `Planetscale.PostgresRole` → `role.origin` → Hyperdrive.
    - Electric role: `withReplication: true`, using a separate role so the replication slot isn't
      tied to the app role.
    - PR stages get their own branch, and dev skips the PlanetScale provider (docker Postgres, the
      maple pattern).
    - **Data migration**: `pg_dump`/restore (or logical replication) from the current host into
      PlanetScale during a maintenance window, then point Railway at PlanetScale first. This
      decouples the DB move from the compute move.
- **Hyperdrive** in front of Postgres for every Worker. Use maple's per-request/scope `pg` dial
  pattern (`DatabasePgLive.layerPg`): Worker sockets are request-bound, so no global pool.
    - `packages/db` (drizzle + postgres.js) gets a `makeDb(connectionString)` that is scoped per
      request.
- **R2**:
    - Declare `Cloudflare.R2.Bucket("uploads")` with `RemovalPolicy.retain()`; adopt the existing
      bucket and keep `cdn.hazel.sh`.
    - Replace `packages/effect-bun/src/S3.ts` with an `ObjectStorage` service: an R2 binding for
      read/write/delete, and alchemy's R2 presign helpers + `R2.S3Credentials` for client uploads.
- **Electric, self-hosted on CF Containers**:
    - `Cloudflare.Container("Electric", { image: electricsql/electric:<pinned>, instanceType: "standard-2", maxInstances: 1 })`,
      reached through a Container-backed Durable Object with a single fixed id (`"electric"`).
    - **Exactly one instance**: Electric owns one replication slot. Set a long/disabled `sleepAfter`
      so the container never idles out; a cold start = a re-snapshot.
    - Env: `DATABASE_URL` is the PlanetScale replication role and goes direct, not via Hyperdrive
      (Hyperdrive can't do logical replication). Also `ELECTRIC_SECRET`,
      `ELECTRIC_MANUAL_TABLE_PUBLISHING=true`, and `ELECTRIC_STORAGE_DIR` on the container's local disk.
    - **Storage is ephemeral**, as in maple's ECS setup (`apps/electric/alchemy.run.ts`: "losing it
      costs only a re-snapshot"). On redeploy or restart, clients get `must-refetch` and resync.
      Acceptable at Hazel's size; revisit if shapes get large.
    - Not publicly exposed: only `electric-proxy` talks to it (DO stub `fetch`), so `ELECTRIC_SECRET`
      is defence in depth.
    - Dev: `Command.Dev` / docker-compose Electric as today.
    - **Spike first**: replication-slot behaviour across container restarts/deploys (slot reuse vs a
      stale slot holding WAL), and the outbound TCP latency from the container to PlanetScale.

## Phase 2: Strip Bun from shared code

| Bun API                                   | Replacement                                         |
| ----------------------------------------- | --------------------------------------------------- |
| `RedisClient` (`effect-bun/Redis.ts`)     | removed; per-use replacements in Phases 3–6         |
| `s3` / `S3File`                           | `ObjectStorage` (Phase 1)                           |
| `randomUUIDv7` (`routes/uploads.http.ts`) | `uuid` v7 / `@hazel/schema` helper                  |
| `BunHttpServer`, `BunRuntime.runMain`     | `{ fetch }` from Worker init + `WorkerPlatformLive` |
| `BunSocket` DevTools in Telemetry         | dev-only, behind a flag                             |
| `RAILWAY_GIT_COMMIT_SHA`                  | `COMMIT_SHA` passed as a plain var from the stack   |

`packages/effect-bun` shrinks to dev tooling (or is deleted). The runtime-agnostic packages
(`backend-core`, `domain`, `auth`, `integrations`) must typecheck under `@cloudflare/workers-types`.

## Phase 3: electric-proxy → Worker (first real migration, lowest risk)

- Template: `maple/apps/electric-sync/src/worker.ts`. Auth (Clerk JWT) → where-clause → forward to
  Electric, with streaming passthrough. The Caddy SSE tweaks are no longer needed.
- Redis access-context cache → the Workers Cache API (`caches.default`), or KV with a short TTL.
  Bot-auth cache works the same way.
- The existing e2e tests in CI run against `alchemy dev`.
- Domain: same hostname, so the web app's `VITE_ELECTRIC_URL` doesn't change.
- Upstream: the Electric container's DO stub (`env.ELECTRIC.get(idFromName("electric")).fetch`) instead of an Electric Cloud URL. `ELECTRIC_SOURCE_ID`/`SOURCE_SECRET` are dropped.

## Phase 4: backend → `api` Worker

- **HTTP/RPC**: `HttpApiBuilder.layer(...)` + `RpcServer` routes → `HttpRouter.toHttpEffect`, cached
  per isolate (maple `apps/api/src/worker/http.ts`). The `ndjson` RPC serialization works unchanged
  over fetch.
- **Redis replacements**:
    - Rate limiter → `Cloudflare.RateLimit(...)` bindings.
    - `RedisResultPersistence` session cache → Cache API/KV.
    - `bot-commands` SSE via Redis pub/sub → `BotGateway` DO (Phase 6), which owns the fan-out.
- **`MessageOutboxDispatcher`** (an `Effect.forever` poll loop) →
    - On write: enqueue to `Cloudflare.Queues.Queue("message-events")`. The consumer triggers the
      workflows.
    - Safety net: a cron sweep every minute for rows still `pending`, so outbox semantics are kept.
- **Discord gateway** (`dfx/gateway`, long-lived outbound WS) → singleton `DiscordGateway` Durable
  Object: an outbound WebSocket kept alive while connected, an alarm-based watchdog that reconnects
  and resumes, and the session/seq stored in DO SQLite. `DiscordSyncWorker` /
  `ChatSyncAttributionReconciler` → cron + queue consumers.
- **Webhooks** (Clerk, GitHub, Linear) are plain fetch routes; long processing is moved to
  Queues/Workflows to stay inside CPU limits.
- **Cluster calls** (`rpc/handlers/channels.ts`, `routes/webhooks.http.ts`,
  `services/message-side-effect-service.ts`) keep using the HTTP `WorkflowClient`, now on
  `FetchHttpClient`. `CLUSTER_URL` points at the cluster through the Tunnel/VPC binding (see Phase 5). The outbox Queue consumer
  calls the cluster the same way.

## Phase 5: Cluster stays on Railway (Workflows port deferred)

`apps/cluster` keeps running as-is on Bun/Railway. That covers its 6 workflows, 5 crons and the
`WorkflowProxyServer`. It needs only these changes to live next to a Cloudflare-hosted backend:

- **DB**: `DATABASE_URL` / `EFFECT_DATABASE_URL` → PlanetScale. Use a direct connection (Hyperdrive
  is Workers-only), with a dedicated `Planetscale.PostgresRole` minted by the stack.
- **Reachability**: once the backend leaves Railway, it can't use `*.railway.internal`, and the
  cluster's HTTP API has no auth today.
    - Recommended: a **Cloudflare Tunnel** (`cloudflared` sidecar on Railway) + a Workers VPC Service
      binding on `api`, both declared in alchemy (`Cloudflare.Tunnel`, `Cloudflare.VpcService`). The
      cluster then stays private.
    - Simpler fallback: a public URL + a shared-secret header checked by `WorkflowProxyServer`.
    - Check what `VITE_CLUSTER_URL` exposes to the browser, and route it through `api` if it's more
      than read-only status.
- **Telemetry**: OTLP straight to Maple, so the Railway collector can still be deleted.
- **In the stack (optional)**: alchemy beta.80 ships a `Railway` provider (`Railway.Service`,
  `Variable`, `CustomDomain`). Declare the cluster service in `alchemy.run.ts` so env, secrets and
  the DB role are wired from one place. Fallback: keep Railway's git deploy and pass env manually.

**Later path (when we pick this back up).** No official Effect Cloudflare workflow engine has
shipped. Effect `4.0.1` only has `ClusterWorkflowEngine`, and effect-smol has no
`platform-cloudflare`. Alchemy's `Cloudflare.Workflow` is Effect-native:

- `Cloudflare.Workflows.task(name, effect, { retries, timeout })` wraps `step.do`.
- `sleep` / `sleepUntil` / `waitForEvent` are Effects.

That maps ~1:1 onto our `Activity.make` usage, and none of our workflows use `DurableDeferred` or
`DurableClock`. Crons → `Cloudflare.Workers.cron`. Re-check for an official DO-backed Effect engine
first.

## Phase 6: bot-gateway + Durable Streams → `BotGateway` DO

One DO per bot:

- **WebSocket hibernation API** for the `/bot-gateway/ws` sessions. Heartbeats are answered via
  `setWebSocketAutoResponse` / alarms.
- **Leases are implicit**: a DO is single-instance per id, so the Redis lease
  `bot-gateway:lease:<botId>` disappears.
- **Durable Streams** (file-backed Node server) → an append-only event log in DO SQLite with
  monotonic offsets. Replay from an offset on reconnect and ack/trim on `batch_ack`. Keep the
  protocol shape so `libs/bot-sdk` changes stay minimal.
- The backend's `bot-gateway-service` writes via a DO RPC stub instead of HTTP to Durable Streams.
  bot-commands SSE also lives on the DO.

**As built** (`apps/bot-gateway/src/worker.ts`, `src/gateway/*`): bots send their token in the
first frame, not on the upgrade, so the gateway Worker terminates the bot's socket, sends HELLO,
answers HEARTBEATs, authenticates IDENTIFY/RESUME through the `HAZEL_DB` Hyperdrive, then relays
the session to `BotGateway.getByName(botId)` over a hibernatable DO socket. The Worker's
lease-TTL watchdog closes silent clients; the DO rejects a second session unless it RESUMEs the
live session's id (the old lease semantics). The backend picks a `BotGatewayTransport`: Durable
Streams HTTP on Bun, `layerDurableObject(namespace)` on Workers. The Bun gateway and
`docker/durable-streams` stay until the Bun backend is retired (Phase 7).

## Phase 7: Bots, observability, cleanup

- **`bots/hazel-bot`, `bots/linear-bot`**: **out of scope, separate follow-up.** They're rewritten
  as Workers there, with a runtime-agnostic `libs/bot-sdk` (no `Bun.serve` / `BunRuntime`). Until
  then they keep running where they are and connect to the new `BotGateway` over the same WS
  protocol, so Phase 6 must stay protocol-compatible.
- **Observability**: Workers logs/traces destinations → Maple (already used by actors) +
  `WorkerTelemetry`. The cluster exports OTLP directly. Delete `infra/otel-collector`.
- **Delete**: `railpack.config.mjs`, `Caddyfile*`, `docker/durable-streams`, and the Redis and MinIO
  services in `docker-compose.yaml`. Local dev keeps only Postgres + Electric in docker.

## Phase 8: CI/CD (copy maple's workflows)

- `deploy-prd.yml`: `workflow_run` after CI on `main` → `bun run alchemy:deploy:prd` → `/health`
  revision check.
- `deploy-pr-preview.yml`: `preview` label → `alchemy deploy --stage pr-<n>`. Write URLs to
  `$GITHUB_OUTPUT` and post a PR comment; destroy on close. PR stages get no Electric creds and their
  own DB branch.
- `cleanup-preview-orphans.yml`.
- Secrets: GitHub Environments or Infisical OIDC (as maple). Set `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID` and DB credentials.
- `typecheck` also runs `tsc -p tsconfig.alchemy.json`.

## Cutover order and rollback

1. Phase 0 (adopt existing CF resources): no user impact.
2. Postgres → PlanetScale. Railway services and Electric Cloud are repointed first; this is the
   only step that needs a maintenance window.
3. Electric container + electric-proxy Worker: DNS switch; rollback = point DNS back at Railway + Electric Cloud.
4. Cluster: repoint to PlanetScale and add Tunnel/auth before the backend moves.
5. backend `api`: same hostname. Keep Railway warm for a week.
6. BotGateway DO: bot-sdk reconnect handles the switch.
7. Decommission on Railway: backend, bot-gateway, Redis, Durable Streams, collector. Also decommission Electric Cloud. **The cluster stays.**

## Known risks

- RivetKit DO class under alchemy (spike in Phase 0).
- Electric on Containers: single instance = brief sync outage on every deploy/restart, and the replication slot must be handled cleanly (spike in Phase 1).
- Cross-provider hop: every `api` → cluster call goes Cloudflare → Railway. That's fine for fire-and-forget workflow `execute`; watch any synchronous `poll`/result calls.
- Discord gateway in a DO: duration billing while connected; resume logic must be solid.
- Worker CPU limits on heavy webhook handlers: push work to Queues/Workflows.
- Hyperdrive + postgres.js prepared statements: verify, or switch to `pg` as maple did.
- alchemy is beta: pin the exact version, and keep maple's patch practice if needed.
