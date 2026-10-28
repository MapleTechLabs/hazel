/**
 * The HazelRpc handlers as an object (or the api Worker's directory path) runs them: every
 * `*RpcLive` over the app services, with the rate limiter admitting everything (the api Worker
 * already limited the call, `rpc/routing.ts`).
 *
 * Leaves open what the host supplies: `Database` and `SqlClient` (the object's SQLite, or D1),
 * `ObjectStubs` / `Directory` / `BotGatewayTransport`, and the platform the app services read
 * (`Persistence`, `InviteMailer`, the `ConfigProvider`).
 */
import { Layer } from "effect"
import { AppServicesLive } from "../../app"
import type { HazelRpcHandlers } from "../../rpc/dispatch"
import { RpcHandlersLive } from "../../rpc/server"
import { RateLimiterAllowAll } from "../../services/rate-limiter"

/**
 * The cast restores the layer's output: the circular `DiscordSyncWorker` typing collapses
 * `AppServicesLive`'s error and requirement channels to `unknown` (see index.ts). Its
 * requirements are the host services listed above.
 */
export const objectHandlersLive = RpcHandlersLive.pipe(
	Layer.provide(AppServicesLive),
	Layer.provide(RateLimiterAllowAll),
) as unknown as Layer.Layer<HazelRpcHandlers, never, never>
