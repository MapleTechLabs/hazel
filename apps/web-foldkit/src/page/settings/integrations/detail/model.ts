import { Schema } from "effect"
import { Connection } from "../shared/connections"

export const CallbackStatus = Schema.Literals(["success", "error"])
export type CallbackStatus = typeof CallbackStatus.Type

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	integrationId: Schema.String,
	/** The org-level connection for this provider (first row), if any. */
	connection: Schema.NullOr(Connection),
	/** Set by a successful OAuth callback until the connection syncs in (`isVerifying`). */
	pendingVerification: Schema.Boolean,
	isConnecting: Schema.Boolean,
	isDisconnecting: Schema.Boolean,
	apiToken: Schema.String,
	apiBaseUrl: Schema.String,
	/** `ConfigOptionRow` toggles, local only as in legacy. */
	enabledOptionIds: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type
