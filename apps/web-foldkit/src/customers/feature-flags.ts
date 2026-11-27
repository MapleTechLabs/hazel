/**
 * Feature flags: the boolean keys of each customer's record in the source with the `featureFlags`
 * capability, shown on the Feature flags settings page and the customer
 * page. A customer has a flag when its key is `true`; a `false` key is off but still lists the flag.
 */
import type {
	CustomerFeatureFlagsError,
	CustomersInvalidRequestError,
	CustomersNotFoundError,
} from "@hazel/domain/rpc"
import { Effect, Schema } from "effect"
import { type CommonError, CommonReason } from "~/lib/error-messages"
import { catchCommon, errorToast, reasonToast } from "../data/actions"
import type { ToastRequest } from "../overlay/toasts"
import type { AccountRow } from "./queries"

/** The flags: the ones created in Hazel and every key a live account holds (on or off), sorted. */
export const featureFlagKeysOf = (
	created: ReadonlyArray<string>,
	accounts: ReadonlyArray<AccountRow>,
): ReadonlyArray<string> =>
	[...new Set([...created, ...accounts.flatMap((account) => Object.keys(account.featureFlags))])].sort()

/** Why a change failed: the server's own words (what the source refused), else a common reason. */
export const FeatureFlagFailure = Schema.Union([
	Schema.Struct({ message: Schema.String }),
	Schema.Struct({ reason: CommonReason }),
])
export type FeatureFlagFailure = typeof FeatureFlagFailure.Type

type FeatureFlagError =
	| CustomerFeatureFlagsError
	| CustomersInvalidRequestError
	| CustomersNotFoundError
	| CommonError

/** Settle a feature flag Command: its errors become a `FeatureFlagFailure`. */
export const settleFeatureFlags =
	<M>(onFailure: (failure: FeatureFlagFailure) => M) =>
	<A, R>(effect: Effect.Effect<A, FeatureFlagError, R>): Effect.Effect<A | M, never, R> =>
		effect.pipe(
			Effect.catchTags({
				CustomerFeatureFlagsError: (error) => Effect.succeed(onFailure({ message: error.message })),
				CustomersInvalidRequestError: (error) =>
					Effect.succeed(onFailure({ message: error.message })),
				CustomersNotFoundError: () =>
					Effect.succeed(onFailure({ message: "The customer was removed." })),
			}),
			catchCommon((reason) => onFailure({ reason })),
		)

export const featureFlagToast = (title: string, failure: FeatureFlagFailure): ToastRequest =>
	"message" in failure ? errorToast(title, failure.message) : reasonToast(failure.reason)
