import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { Connection } from "../shared/connections"

export const Message = defineMessageUnion({
	ClickedCategory: { categoryId: Schema.String },
	ClickedIntegration: { integrationId: Schema.String },
	UpdatedConnections: { connections: Schema.Array(Connection) },
	UpdatedUserConnections: { connections: Schema.Array(Connection) },
	SucceededListWebhooks: { names: Schema.Array(Schema.String) },
	FailedListWebhooks: { reason: CommonReason },
	ClickedRequestIntegration: {},
})
export type Message = typeof Message.Type
