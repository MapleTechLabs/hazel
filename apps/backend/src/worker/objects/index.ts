/**
 * The sync objects (`infra/durable-object-sync-plan.md`): `OrgObject`, `ChannelObject`,
 * `UserObject`, hosted by the api Worker. Map of this folder:
 *
 * - `runtime.ts`: one instance (store migrations, sync runtime, outbox, in-process HazelRpc).
 *   `activate.ts` + `*-object.ts` adapt it to alchemy; `testing.ts` runs it on node SQLite.
 * - `sources/`: what each kind streams to whom (each table's per-principal `visible` condition).
 * - `effects/`: the typed outbox registry (`registry.ts`), one module per receiving side,
 *   `deliver.ts` (sending and receiving).
 * - `org/channel-access.ts`: recompute `channel_access` and project it (`setViewers`, index).
 * - `calls.ts` / `call-receivers.ts`: typed request/response calls from the api Worker's HTTP
 *   routes (webhooks, the public API, integrations) for work that is not a HazelRpc method.
 * - `org/connect.ts` + `connect-wire.ts`: Hazel Connect (host conversation, guest mounts).
 * - Routing lives in `rpc/routing.ts`, the Worker's server in `rpc/routed-server.ts`.
 */
export * from "./kinds"
export * from "./principal"
export * from "./protocol"
export * from "./effects/registry"
