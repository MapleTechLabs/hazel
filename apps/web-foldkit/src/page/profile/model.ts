import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

/** The user shown on `/$orgSlug/profile/$userId`, with their stored presence. */
export const ProfileUser = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	presenceStatus: Schema.NullOr(Schema.String),
	presenceLastSeenMs: Schema.NullOr(Schema.Number),
})
export type ProfileUser = typeof ProfileUser.Type

/** The user live query: `Loading` until it is ready, then the row or `NotFound`. */
export const ProfileLookup = defineTaggedUnion({
	Loading: {},
	Found: { user: ProfileUser },
	NotFound: {},
})
export type ProfileLookup = typeof ProfileLookup.Type

export const Model = Schema.Struct({
	userId: UserId,
	user: ProfileLookup,
})
export type Model = typeof Model.Type
