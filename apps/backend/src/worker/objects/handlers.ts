/**
 * The HazelRpc handlers as an object (or the api Worker's directory path) runs them: every
 * `*RpcLive` (and the route calls, `./call-receivers.ts`) over the app services, with the rate
 * limiter admitting everything (the api Worker already limited the call, `rpc/routing.ts`).
 */
import type { Database } from "@hazel/db"
import type { CurrentRpcScopes } from "@hazel/domain/scopes"
import { type Config, Layer } from "effect"
import type { Persistence } from "effect/persistence"
import type { SqlClient } from "effect/sql/SqlClient"
import { AppServicesLive } from "../../app-services"
import type { CurrentObject } from "../../lib/current-object"
import type { HazelRpcHandlers } from "../../rpc/dispatch"
import { RpcHandlersLive } from "../../rpc/server"
import { RateLimiterAllowAll } from "../../services/rate-limiter"
import type { BotGatewayTransport } from "../../services/bot-gateway-transport"
import type { Directory } from "../../services/directory"
import type { HtmlRenderStore } from "../../services/html-renders"
import type { InviteMailer } from "../../services/invite-mailer"
import { ObjectCalls } from "./call-receivers"
import type { ObjectStubs } from "./protocol"

/**
 * What the host supplies: the storage (`Database`, `SqlClient`: the object's SQLite, or D1), the
 * platform the handlers and app services reach, and the `ConfigProvider`.
 */
export type ObjectHandlersRequirements =
	| Database.Database
	| SqlClient
	| ObjectStubs
	| Directory
	| BotGatewayTransport
	| InviteMailer
	| HtmlRenderStore
	| Persistence.Persistence

/**
 * What each call brings rather than the host: the runtime provides `CurrentObject` around every
 * call (`./runtime.ts`), and the scope middleware `CurrentRpcScopes` per request.
 */
type PerCallServices = CurrentObject | CurrentRpcScopes

const handlersLive = Layer.mergeAll(RpcHandlersLive, ObjectCalls.layer).pipe(
	Layer.provide(AppServicesLive),
	Layer.provide(RateLimiterAllowAll),
)

/** The handlers' layer, with the per-call services left to each call. */
export const objectHandlersLive: Layer.Layer<
	HazelRpcHandlers | ObjectCalls,
	Config.ConfigError,
	ObjectHandlersRequirements
> = handlersLive as Layer.Layer<
	Layer.Success<typeof handlersLive>,
	Layer.Error<typeof handlersLive>,
	Exclude<Layer.Services<typeof handlersLive>, PerCallServices>
>
