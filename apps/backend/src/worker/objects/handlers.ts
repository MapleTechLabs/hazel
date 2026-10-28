/**
 * The HazelRpc handlers as an object (or the api Worker's directory path) runs them: every
 * `*RpcLive` (and the route calls, `./call-receivers.ts`) over the app services, with the rate
 * limiter admitting everything (the api Worker already limited the call, `rpc/routing.ts`).
 */
import type { Database } from "@hazel/db"
import { type Config, Layer } from "effect"
import type { Persistence } from "effect/persistence"
import type { SqlClient } from "effect/sql/SqlClient"
import { AppServicesLive } from "../../app"
import type { HazelRpcHandlers } from "../../rpc/dispatch"
import { RpcHandlersLive } from "../../rpc/server"
import { RateLimiterAllowAll } from "../../services/rate-limiter"
import type { BotGatewayTransport } from "../../services/bot-gateway-transport"
import type { Directory } from "../../services/directory"
import type { InviteMailer } from "../../services/invite-mailer"
import { ObjectCalls } from "./call-receivers"
import type { ObjectStubs } from "./protocol"

/**
 * What the host supplies: the storage (`Database`, `SqlClient`: the object's SQLite, or D1), the
 * platform the handlers and app services reach, and the `ConfigProvider`. `CurrentRpcScopes` is
 * left out: the scope middleware provides it per request.
 */
export type ObjectHandlersRequirements =
	| Database.Database
	| SqlClient
	| ObjectStubs
	| Directory
	| BotGatewayTransport
	| InviteMailer
	| Persistence.Persistence

/**
 * The cast restores the layer's requirements: the circular `connect-shares` ↔ `org/connect` ↔
 * `org/channel-access` typing can collapse them to `any` (depending on check order).
 */
export const objectHandlersLive = Layer.mergeAll(RpcHandlersLive, ObjectCalls.layer).pipe(
	Layer.provide(AppServicesLive),
	Layer.provide(RateLimiterAllowAll),
) as unknown as Layer.Layer<HazelRpcHandlers | ObjectCalls, Config.ConfigError, ObjectHandlersRequirements>
