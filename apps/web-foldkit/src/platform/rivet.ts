import { Effect, Schema } from "effect"
import { ManagedResource } from "foldkit"

/**
 * The legacy Rivet actor client (`lib/rivet-client.ts`), created at boot like legacy's module-level
 * `createClient`: creating it starts the manager metadata lookup. Actor connections (streaming AI
 * messages) are opened per message from this client.
 */

export type RivetClient = (typeof import("~/lib/rivet-client"))["rivetClient"]

export const RivetClient = ManagedResource.tag<RivetClient>()("RivetClient")

/** The client chunk failed to load (offline, or a deploy replaced it). */
export class RivetClientLoadError extends Schema.TaggedError<RivetClientLoadError>()("RivetClientLoadError", {
	message: Schema.String,
}) {}

/** Loaded lazily so the client library stays out of the boot chunk. */
export const acquireRivetClient: Effect.Effect<RivetClient, RivetClientLoadError> = Effect.tryPromise({
	try: () => import("~/lib/rivet-client"),
	catch: (error) => new RivetClientLoadError({ message: String(error) }),
}).pipe(Effect.map((module) => module.rivetClient))
