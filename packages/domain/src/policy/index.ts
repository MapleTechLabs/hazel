import { Effect } from "effect"
import * as CurrentUser from "../current-user"
import { UnauthorizedError } from "../errors"

export const policy = <Entity extends string, Action extends string, E, R>(
	entity: Entity,
	action: Action,
	f: (actor: typeof CurrentUser.Schema.Type) => Effect.Effect<boolean, E, R>,
): Effect.Effect<void, E | UnauthorizedError, R | CurrentUser.Context> =>
	CurrentUser.Context.use((actor: typeof CurrentUser.Schema.Type) =>
		Effect.flatMap(f(actor), (can) =>
			can
				? Effect.void
				: Effect.fail(
						new UnauthorizedError({
							message: `You can't ${action} this ${entity}`,
							detail: `You are not authorized to perform ${action} on ${entity} for ${actor.id}`,
						}),
					),
		),
	) as Effect.Effect<void, E | UnauthorizedError, R | CurrentUser.Context>
