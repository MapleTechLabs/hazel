import { Schema } from "effect"
import { Connection } from "../shared/connections"

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	selectedCategory: Schema.String,
	connections: Schema.Array(Connection),
	/** Lower-cased names of the org's webhooks (OpenStatus, Railway are webhook-based). */
	webhookProviders: Schema.Array(Schema.String),
	hasRequestedWebhooks: Schema.Boolean,
})
export type Model = typeof Model.Type
