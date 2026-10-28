# Durable Object sync: implementation spec

Replace Postgres + Electric with Durable Objects (DOs) as the system of record and the sync
transport. TanStack DB stays the client store. **Instant cutover**: there is no dual-running and no
per-org flags. A best-effort import script copies the Postgres data once, and some loss is accepted.

> **Supersedes parts of [`cloudflare-migration-plan.md`](./cloudflare-migration-plan.md).** Its
> data plane is replaced by this doc: Phase 1's PlanetScale Postgres, Hyperdrive and self-hosted
> Electric; Phase 3 (the `electric-proxy` Worker); Phase 5 (the cluster, on Railway or as a
> `cluster` Worker), whose workflows and crons now run in the objects; the Durable Streams half of
> Phase 6; and the Postgres, Electric and cluster steps of its cutover order and known risks. Its
> Alchemy foundation, R2, the api and bot-gateway Workers, CI/CD and observability still apply.

This doc is the single brief for everyone working on the change. If the code and this doc
disagree, fix one of them.

Removed by this work:

- Postgres (PlanetScale, Hyperdrive, `@effect/sql-pg`)
- Electric and `apps/electric-proxy`
- `apps/cluster`, both its workflows and its crons
- the RivetKit `apps/actors`
- the global `message_outbox_events` and `OutboxDispatcherObject`
- `channel_access-sync.ts`, which becomes a function inside `OrgObject`
- the Bun runtime of `apps/backend`; local dev becomes `bun run alchemy:dev` (workerd)

---

## 1. Stores

| Store               | Instance key              | Tables (current names kept)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 `directory`      | global                    | `users`; all `auth_*`; `bots`; `bot_commands`; `organization_invitations`; `connect_invites`; index tables: `org_index` (id, slug, name, deletedAt), `membership_index` (userId, organizationId, deletedAt), `channel_index` (channelId, organizationId, hostChannelId, deletedAt), `webhook_index` (webhookId, organizationId, channelId, tokenHash), `integration_index` (provider, externalId, organizationId), `chat_sync_index` (provider, externalWorkspaceId, externalChannelId?, organizationId, channelId?)                                                                                            |
| `OrgObject`         | `organizationId`          | `organizations`, `organization_members`, `channels`, `channel_members`, `channel_sections`, `channel_access`, `custom_emojis`, `bot_installations`, `integration_connections`, `integration_tokens`, `integration_requests`, `chat_sync_connections`, `chat_sync_channel_links`, `channel_webhooks`, `github_subscriptions`, `rss_subscriptions`, `rss_posted_items`, `connect_conversations`, `connect_conversation_channels`, `connect_participants`. **Read-only projections:** `users` (members and Connect participants), `user_presence_status` (same users), `bots` and `bot_commands` (installed bots). |
| `ChannelObject`     | `channelId` (threads too) | `messages`, `message_reactions`, `pinned_messages`, `attachments`, `chat_sync_message_links`, `chat_sync_event_receipts`, `typing_indicators`. **Projections:** `channel_viewers` (userId, organizationId, role; the channel's computed access) and `channel_bots` (botId, botUserId; bots that receive events).                                                                                                                                                                                                                                                                                                |
| `UserObject`        | `userId`                  | `notifications`, `user_presence_status` (authoritative), `user_organizations` (organizationId; tells the client which `OrgObject`s to open).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `MessageLiveObject` | `messageId`               | Live AI or progress state for one message. Replaces the RivetKit `message` actor (**last PR**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Rules:

- Table and column names stay the same, so the client models (`@hazel/domain/models`) don't change.
  Projection tables use the same schema as their source.
- **One owner per row.** Projections are written only through outbox deliveries from the owner.
- **D1 has no transactions** (effect-orm `Database.transaction` refuses on D1). Every directory write
  is a single statement or a `batch`, and it's idempotent.
- **`channel_members` stays whole in `OrgObject`**, including per-user fields (`isMuted`,
  `isFavorite`, `lastSeenMessageId`, `notificationCount`). This keeps the client's `channel_members`
  collection unchanged.
- **Connect** (shared channels across orgs):
    - The host org's `OrgObject` owns the conversation, and the host channel's `ChannelObject` holds
      every message of the conversation.
    - The guest org's mounted channel has its own `channel_index` row with
      `hostChannelId = <host channel>`. Every read and write for it goes to the host
      `ChannelObject`.
    - Guest users get a filtered socket to the host `OrgObject` (the conversation rows only).

## 2. Packages and layout

| Path                                                    | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/src/tables/*`                              | Tables become `SQLite.table` (`@maple-dev/effect-orm/sqlite`). Shared column helpers in `columns.ts`: branded `uuid` → `text`, `timestamptz` → `timestamp`, `jsonb` → `json`, enums → `text` with a literal schema.                                                                                                                                                                                                                                      |
| `packages/db/src/stores.ts`                             | `directoryTables`, `orgTables`, `channelTables`, `userTables`: the table lists per store.                                                                                                                                                                                                                                                                                                                                                                |
| `packages/db/src/services/database.ts`                  | `Database` over the SQLite dialect: `layerSqlite` (`@effect/sql-sqlite-do`, `@effect/sql-sqlite-node` for tests) and `layerD1`. `DatabaseError` classified from SQLite errors (`SQLITE_CONSTRAINT_UNIQUE` → `unique_violation`, and so on).                                                                                                                                                                                                              |
| `packages/db/src/schema-ddl.ts`                         | `renderStoreSchema(tables)` → DDL statements, plus a versioned migration list per store.                                                                                                                                                                                                                                                                                                                                                                 |
| `packages/sync-do/` (new)                               | Sync runtime: change triggers, `_changes` log, broadcaster, hibernatable socket handling, outbox and inbox, `SyncedObject` helpers. Generic over effect-orm tables. No Hazel domain logic.                                                                                                                                                                                                                                                               |
| `packages/domain/src/sync/`                             | Protocol frames (Effect Schema) and `SyncSeq`. Shared by the client and the objects.                                                                                                                                                                                                                                                                                                                                                                     |
| `apps/backend/src/worker/objects/`                      | `OrgObject`, `ChannelObject` and `UserObject`, hosted by the backend Worker beside the existing DOs (an api deploy restarts them, and clients catch up from `since`). The Worker also serves `GET /sync/:kind/:id` (WebSocket).                                                                                                                                                                                                                          |
| `apps/backend/src/rpc/handlers`, `policies`, `services` | **The existing RPC handlers run inside the objects.** Each object hosts the HazelRpc groups in-process, with `Database` set to its own SQLite and `CurrentUser` set from the principal. The api Worker routes each RPC to its target (`org`, `channel`, `user`, or `directory` = run in the Worker against D1) and forwards the encoded request. Porting a handler means making it touch only its own store and send everything else through the outbox. |
| `libs/effect-db-collection`                             | Renamed from `libs/effect-electric-db-collection`. `createEffectCollection` over the DO protocol, plus `optimisticAction` with `awaitSeqEffect`.                                                                                                                                                                                                                                                                                                         |
| `apps/web-foldkit/src/core/db/`                         | Collections pointed at sources, plus a connection manager.                                                                                                                                                                                                                                                                                                                                                                                               |

## 3. Change tracking and the sync protocol

### Triggers (`packages/sync-do`)

- Each synced table gets `AFTER INSERT/UPDATE/DELETE` triggers that insert
  `(_changes.tbl, pk, op)`.
- `_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, pk TEXT NOT NULL, op TEXT NOT NULL)`.
  `pk` is the row's `id`. Tables without one (`channel_access`, `channel_viewers`) use their key
  columns joined with `:`.
- Triggers mean repository code needs no changes to be tracked, the same way Electric reads the WAL.
- **Retention:** keep the newest 50k changes or 7 days. A client whose `since` is below the oldest
  retained `seq` gets a reset.

### Broadcast

Once any request or RPC method has committed, the object calls `flush()`:

1. Read `_changes WHERE seq > lastFlushed`.
2. For each socket and each changed table, select the current rows `WHERE id IN (…) AND <visible(principal)>`.
3. Send the upserts. A changed key that came back missing becomes a delete.
4. Every flush sends `Commit { seq }` to every socket, even when nothing was visible to it, so
   `awaitSeq` always resolves.

### Visibility per object

- **`OrgObject`:** per table, the `WHERE` clauses from `apps/electric-proxy/src/tables/user-tables.ts`,
  ported to local SQL. `channel_access` is local.
    - A socket's principal is either a member of the org or a Connect guest; a guest sees only the
      conversation rows.
    - Tables declare `dependsOn` (`channel_access`, `organization_members`, `connect_participants`).
      A change in a dependency for a user re-snapshots that user's sockets.
- **`ChannelObject`:** a viewer sees everything; a non-viewer is refused, and sockets whose access is
  removed are closed.
- **`UserObject`:** the owner only.

### Frames (`packages/domain/src/sync/protocol.ts`, JSON text)

- **Client → object:** `Hello { since: number | null }`, `Ping`, `Reauth { token }`,
  `LoadOlder { requestId, table, before: { createdAt, id }, limit }` (see Paged history).
- **Object → client:**
    - `Begin { reset: boolean, request?: number, windows?: [{ table, oldest, hasMore }] }`: on
      reset, the client truncates the collections this source feeds.
    - `Rows { table, upserts: unknown[], deletes: string[] }`
    - `Commit { seq }`
    - `Ready { expiresInMs? }` (sent after the first Commit; when the socket expires)
    - `Reauthed { expiresInMs }` (a `Reauth` moved the expiry)
    - `Ephemeral { ... }`
    - `Pong`
    - `Error { code, message }`
- Rows are encoded with the table's schema as JSON. Timestamps are ISO strings; the client models
  already accept them.

### Paged history

A `ChannelObject` pages `messages` instead of sending the whole channel (`SyncTable.paging` in
`packages/sync-do`, `pageMessages` in `channel-source.ts`).

- **Order:** `(createdAt, id)` descending; a cursor is the oldest row's `{ createdAt, id }`, so rows
  sharing a `createdAt` split across pages without loss or repeats.
- **Snapshot** (every reset: first connect, retention or catch-up overflow, a `channel_viewers`
  resnapshot): the newest 200 visible messages, plus older pinned ones (the pins list joins on
  them), and only those messages' `message_reactions`, `pinned_messages`, `attachments` and
  `chat_sync_message_links` (plus uploads with no message yet). `Begin.windows` carries the
  window: `oldest` (the cursor of the 200th message) and `hasMore`. Typing indicators are whole.
- **Paging:** `LoadOlder` is answered, under the flush permit, by
  `Begin { reset: false, request, windows: [lowered window] }`, `Rows…`, and a `Commit` at the
  socket's current `seq` (the page never moves the stream). `limit` is clamped to 200.
- **Deltas** are unchanged: a change to any row goes out by key, paged in or not. The object keeps
  no per-socket horizon.
- **Client** (`libs/effect-db-collection`): the mirror records each source's window. A live upsert
  of a row it does not hold that is older than the window's start is dropped (it would sit next to
  the window with the rows between missing); paging brings it in. A held row (paged in, or a
  pinned one) takes every edit and delete.
    - **Catch-up** (`Hello{since}`) carries no `windows`: the client keeps its pages and window.
    - **Reset** drops the pages with everything else. Demands (`utils.retainHistory`, or a
      `loadSubset` with `limit`/`offset`) outlive it and re-request pages from the new window.
    - A page answer to a request sent before a reset arrived is dropped, so no gap opens.
- **Web:** the channel page's window subscription holds `retainHistory(offset + limit + PAGE_SIZE)`,
  so scrolling back pages older messages in before the window reaches them.

### Auth

- The backend Worker's `/sync` route reads the session token from `Sec-WebSocket-Protocol` (`hazel.v1, <token>`),
  verifies it the way `api` does, and forwards the upgrade to the object with
  `x-hazel-principal: {userId, ...}` JSON.
- Objects are reachable only through bindings, so the header is trusted.
- The object authorizes the principal against its own tables, and checks again on every
  re-snapshot.
- When the token expires, the object closes the socket with code `4001`, and the client reconnects
  with a fresh token. Before that (30 s ahead of `Ready.expiresInMs`), the client sends `Reauth` with
  a fresh access token; the object verifies it locally with the api's signing key (it runs in the
  api Worker and shares its env), requires the same user, and moves the socket's expiry. A refused
  token closes with `4001`; an uncheckable one keeps the old expiry. Revocation is unchanged: an
  ended session cannot mint a new token, so its sockets still close within one token lifetime.

### Write confirmation

- Each object method returns `seq` (the `_changes` head after its commit, once flushed).
- RPC results carry `transactionId: "<kind>:<id>:<seq>"`. `TransactionId` becomes a branded string.
- The client's `awaitSeqEffect(txid)` resolves once that source's stream has passed `Commit.seq`.

### Ephemeral

Typing stays the `typing_indicators` table in `ChannelObject`, so the client is unchanged. An alarm
deletes rows older than 10 s, and the cron goes away.

## 4. Writes and side effects

- **The api Worker stays the RPC and HTTP surface.** Handlers authenticate (`CurrentUser`), resolve
  the target object and call its typed DO RPC method with the principal. **Authorization runs inside
  the object** (ported policies).
- **Routing:**
    - `organizationId` in the payload → `OrgObject`.
    - `channelId` → `channel_index` → `OrgObject` or `ChannelObject` (a mounted Connect channel goes to
      its host).
    - RPCs that have only a message, reaction or pin id gain a `channelId` field in their payload; the
      client knows it.
    - User-scoped calls → `UserObject(CurrentUser)`.
- **Outbox and inbox** (`packages/sync-do`):
    - The `_outbox` row is written in the same SQLite transaction as the change.
    - Delivery is attempted right after the commit, and the alarm retries with backoff.
    - Receivers dedupe on `_inbox(key)`.
- **Flows:**
    - **Message create, update or delete** (`ChannelObject`) → `OrgObject` (channel `lastMessageAt`,
      `notificationCount` increments, mention resolution), `UserObject`s (notifications),
      BotGateway, Discord sync, thread naming (OpenRouter fetch from the object).
    - **Channel create, update or delete; membership; org member changes** (`OrgObject`) → recompute
      `channel_access` locally → `ChannelObject.setViewers` (delivered after the commit and before the
      answer even while another drain runs, `urgentKinds`; versioned so an older one is dropped; the
      outbox retries a failure) → directory `channel_index` and `membership_index` → `UserObject.user_organizations`.
    - **Profile update** (directory `users`) → each `OrgObject` in `membership_index` (projection).
    - **Presence** (`UserObject`) → each `OrgObject` (projection). Expiry is an alarm.
    - **Bot install or uninstall** (`OrgObject`) → `channel_bots` on the affected channels, the bot
      projection, the directory.
    - **RSS:** an `OrgObject` alarm polls its subscriptions. **GitHub webhooks:** api →
      `integration_index` → `OrgObject` → `ChannelObject`. **Upload cleanup:** a daily alarm in
      `ChannelObject`.
    - **Discord gateway DO:** resolves the link via `chat_sync_index`, then the `ChannelObject` ingest
      methods. The chat-sync core logic moves into `ChannelObject` and `OrgObject`.
    - **Bots** still publish through `bindBotGateways`, now called from `ChannelObject`.

## 5. PR stack (`gh stack`)

Each PR typechecks and its tests pass. The app keeps running on the old stack until PR 5 switches
the client.

1. **`do-sync/storage`:** SQLite tables, the `Database` layer, DDL and migrations, `stores.ts`, the
   protocol schema, and the import script's reader half.
   _Verify:_ store DDL applies on node SQLite; the repo tests in `packages/backend-core` run on SQLite.
2. **`do-sync/runtime`:** `packages/sync-do` (triggers, broadcaster, sockets, outbox).
   _Verify:_ unit tests on node SQLite, and workerd tests of a toy object (catch-up, reset,
   visibility, outbox retry, token expiry).
3. **`do-sync/objects`:** the object shells, RPC invoke and routing, and the handlers ported per object, including the cluster
   workflows rehomed.
   _Verify:_ object logic tests on node SQLite, ported from the backend's current tests.
4. **`do-sync/api`:** api handlers and routes routed to objects, auth on D1, the Discord gateway,
   webhooks, the API (v1); the Bun runtime removed.
   _Verify:_ backend tests and typecheck.
5. **`do-sync/client`:** `libs/effect-db-collection`, collections, the connection manager, actions.
   _Verify:_ lib tests, a browser run on `alchemy:dev` (sign in, send, react, thread, DM, unread,
   reconnect), screenshots.
6. **`do-sync/cutover`:** delete Postgres, Electric, the proxy, the cluster and Rivet; the alchemy
   stack; the import script; docs and `CLAUDE.md`.
   _Verify:_ deploy a `pr-<n>` preview, run the import against a staging copy, and do a full
   browser pass.

## 6. Known regressions (follow-ups)

- **Message search** in the command palette only covers channels that are loaded. Follow-up: per-org
  FTS5.
- **Only loaded history is visible outside the channel view** (see §3 Paged history): the thread
  panel shows a thread's newest 200 messages, and the notifications inbox and message search
  see only the messages their channels' windows hold. Pinning a message older than the window
  shows it in the pins list only after the next reset.
- **Auth checks call D1** on every api request; add a short KV cache if latency shows it's needed.
- **Bot creation from the CLI is gone:** `hazel-setup bots` wrote the Bun runtime's SQLite file.
  Create bots in the app.
- **The import is best effort:** `channel_access` is recomputed rather than copied;
  `typing_indicators`, `message_outbox_events` and attachments without a channel are dropped;
  `connect_participants` get the objects' derived ids. One org's finalize runs in a single object
  request, so a very large org could hit Worker time limits.

## 7. Status

- **Done (PRs 1–6):**
    - The SQLite stores and the sync runtime.
    - The org, channel and user objects with every handler, route and side effect ported.
    - The client on the object sources.
    - The cutover:
        - Deleted `apps/electric-proxy`, `apps/cluster`, `packages/domain/src/cluster`, the
          PlanetScale/Hyperdrive stack (`hazel-db.ts`), and Railway/Caddy/Durable Streams.
        - Deleted the backend's and the bot gateway's Bun entries.
        - `docker-compose.yaml` keeps only MinIO.
        - The directory D1 is declared by the root stack (`@hazel/infra/cloudflare`
          `declareDirectoryDb`) and bound by the api Worker and the bot gateway.
    - `OutboxDispatcher` needs no code: alchemy derives the `deleted_classes` migration from the
      previous deploy's class tags.
- **Local dev:** `bun run alchemy:dev` with `.env.local` (`.env.local.example`).
- **Import:** `apps/backend/src/scripts/import-postgres.ts`, through
  `POST /internal/import/:store/:id`. The route answers only while the api Worker has
  `IMPORT_SECRET`, and on prd only with `IMPORT_ENABLED=true` as well (`worker/import-route.ts`,
  `lib/stage.ts`). Neither is in `deploy-prd.yml`: set both by hand in the env of one prd deploy
  for the one-shot import, run it, then redeploy without them (the next CI deploy drops them) and
  delete the `IMPORT_SECRET` repository secret.
- **Not done yet:**
    - The PR 6 verification: a `pr-<n>` preview deploy, the import against a staging copy, and a
      full browser pass.
    - `MessageLiveObject` (the RivetKit `apps/actors` stays until then).
    - Dropping `WorkflowServiceUnavailableError` / `WorkflowInitializationError` from the RPC and
      webhook contracts.
