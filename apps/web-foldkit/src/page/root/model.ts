import { OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"

export const RootMembership = Schema.Struct({
	organizationId: OrganizationId,
	slug: Schema.NullOr(Schema.String),
})

export const Model = Schema.Struct({
	/** `undefined` until the live query is ready; `null` when the user has no membership. */
	membership: Schema.UndefinedOr(Schema.NullOr(RootMembership)),
	hasRedirected: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	UpdatedMembership: { membership: Schema.NullOr(RootMembership) },
})
export type Message = typeof Message.Type
