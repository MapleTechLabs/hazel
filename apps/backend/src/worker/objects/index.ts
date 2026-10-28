/**
 * The sync objects (`infra/durable-object-sync-plan.md`): `OrgObject`, `ChannelObject`,
 * `UserObject`, hosted by the api Worker. Map of this folder:
 *
 * - `runtime.ts`: one instance (store migrations, sync runtime, outbox, in-process HazelRpc).
 *   `activate.ts` + `*-object.ts` adapt it to alchemy; `testing.ts` runs it on node SQLite.
 * - `sources/`: what each kind streams to whom (Electric's WHERE clauses, ported).
 * - `effects/`: the typed outbox registry (`registry.ts`), one module per receiving side,
 *   `deliver.ts` (sending and receiving).
 * - `org/channel-access.ts`: recompute `channel_access` and project it (`setViewers`, index).
 * - Routing lives in `rpc/routing.ts`, the Worker's server in `rpc/routed-server.ts`.
 *
 * Porting a handler (e.g. `messageReaction.toggle` to the `ChannelObject`):
 *
 * 1. Check its entry in `rpc/routing.ts` names the object owning the rows it writes.
 * 2. In the handler, read and write only that store's tables (`packages/db/src/stores.ts`).
 * 3. Authorize against local rows: `ChannelViewers.require` in a `ChannelObject`,
 *    `OrgResolver` (org members) in an `OrgObject`, the owner in a `UserObject`.
 * 4. Anything for another object, the directory or the bot gateway: `enqueueEffect(Kind, target,
 *    payload)` inside the same `db.transaction` (add the kind and its receiver under `effects/`).
 * 5. Keep `generateTransactionId()` last in the transaction; the object flushes before answering.
 * 6. Drop inline side effects (bot gateway publishes, cluster calls, `MessageOutboxRepo`).
 * 7. Remove the file's `TODO(do-sync)` header and add a test with `makeTestObjects` (see
 *    `objects.test.ts`): call the method through `invoke`, assert the exit and the projections.
 */
export * from "./kinds"
export * from "./principal"
export * from "./protocol"
export * from "./effects/registry"
