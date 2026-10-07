import { UserId } from "@hazel/schema"
import { Schema } from "effect"

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

export const Model = Schema.Struct({
	userId: UserId,
	/** `null` until found; legacy renders "User not found" for both. */
	user: Schema.NullOr(ProfileUser),
})
export type Model = typeof Model.Type
