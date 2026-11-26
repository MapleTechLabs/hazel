// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Mounts a `hazel` root on the web host for the life of the returned Layer. The host Layer must outlive
 * the mount: provided to `Renderer.mount` alone, BrowserHost's scope closes and its listeners go.
 */
import { type Effect, Layer } from "effect"
import * as WebHost from "./host.ts"

export const withWebHost = <A, E, R>(mounting: Effect.Effect<A, E, R>) =>
	Layer.effectDiscard(mounting).pipe(Layer.provide(WebHost.layer()))
