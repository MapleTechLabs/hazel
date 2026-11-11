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
	/** The page sign-in started from (`auth/return-to.ts`); `undefined` until read, `null` if none. */
	returnTo: Schema.UndefinedOr(Schema.NullOr(Schema.String)),
	hasRedirected: Schema.Boolean,
	/** The membership query has not loaded after a while: the loader offers a reload. */
	isStalled: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	UpdatedMembership: { membership: Schema.NullOr(RootMembership) },
	ReadReturnTo: { returnTo: Schema.NullOr(Schema.String) },
	CompletedForgetReturnTo: {},
	StalledMembership: {},
	PressedReload: {},
	CompletedReload: {},
})
export type Message = typeof Message.Type
