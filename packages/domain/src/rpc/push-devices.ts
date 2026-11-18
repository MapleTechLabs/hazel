import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/** An APNs device token: the hex of the bytes iOS hands `didRegisterForRemoteNotifications`. */
export const ApnsDeviceToken = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16,200}$/))

/** Which APNs host the token belongs to: a debug or simulator build's `development`, else `production`. */
export const ApnsEnvironment = Schema.Literals(["development", "production"])
export type ApnsEnvironment = typeof ApnsEnvironment.Type

/**
 * Push devices: the current user's phones that get a system notification for each of the user's
 * notifications (`UserObject`, `user/push.ts`). Both run in the user's own `UserObject`.
 */
export class PushDeviceRpcs extends RpcGroup.make(
	/** Registers (or refreshes) this device's token; idempotent. */
	Rpc.make("pushDevice.register", {
		payload: Schema.Struct({
			token: ApnsDeviceToken,
			environment: ApnsEnvironment,
			/** The app's bundle identifier, the APNs topic. */
			bundleId: Schema.String.check(Schema.isMaxLength(255)),
		}),
		success: Schema.Void,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["notifications:write"])
		.middleware(AuthMiddleware),

	/** Forgets this device's token (sign-out); a token not registered is no error. */
	Rpc.make("pushDevice.unregister", {
		payload: Schema.Struct({ token: ApnsDeviceToken }),
		success: Schema.Void,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["notifications:write"])
		.middleware(AuthMiddleware),
) {}
