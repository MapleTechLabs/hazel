import { Effect, Predicate } from "effect"
import * as CurrentUser from "./current-user"
import { InternalServerError, UnauthorizedError } from "./errors"
import { PermissionError } from "./scopes/permission-error"

/** Infrastructure failures a policy check can hit; they say nothing about permission. */
type InfrastructureError = { readonly _tag: "DatabaseError" | "SchemaError" }

const isInfrastructureError = (u: unknown): u is InfrastructureError =>
	Predicate.isTagged(u, "DatabaseError") || Predicate.isTagged(u, "SchemaError")

/**
 * Transform a policy's failures into an UnauthorizedError with context about the action.
 * Preserves existing UnauthorizedError instances and converts PermissionError into
 * UnauthorizedError (for policy boundaries).
 *
 * Database and schema failures are not permission answers: they become an
 * `InternalServerError` (cause kept server-side) instead of a 401, so a database blip never
 * looks like "you may not do this" or a signed-out session.
 *
 * @param entity - The type of entity being accessed (e.g., "channel", "message")
 * @param action - The action being performed (e.g., "update", "delete")
 * @returns A function that transforms effect errors into UnauthorizedError | InternalServerError
 *
 * @example
 * ```typescript
 * yield* someEffect.pipe(refailUnauthorized("channel", "update"))
 * ```
 */
export const refailUnauthorized = (entity: string, action: string) => {
	return <A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<A, UnauthorizedError | InternalServerError, CurrentUser.Context | R> =>
		effect.pipe(
			Effect.catchIf(isInfrastructureError, (cause) =>
				Effect.fail(
					new InternalServerError({
						message: `Could not check permission to ${action} ${entity}`,
						cause,
					}),
				),
			),
			Effect.catchIf(
				(e) => !UnauthorizedError.is(e) && !InternalServerError.is(e),
				(e) =>
					CurrentUser.Context.use((actor) =>
						Effect.fail(
							new UnauthorizedError({
								// Convert PermissionError to UnauthorizedError with scope info
								message: PermissionError.is(e)
									? e.message
									: `You can't ${action} this ${entity}`,
								detail: `You are not authorized to perform ${action} on ${entity} for ${actor.id}`,
							}),
						),
					),
			),
		) as Effect.Effect<A, UnauthorizedError | InternalServerError, CurrentUser.Context | R>
}
