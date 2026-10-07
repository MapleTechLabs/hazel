import { Schema } from "effect"

export const TeamMember = Schema.Struct({
	id: Schema.String,
	userId: Schema.String,
	role: Schema.Literals(["owner", "admin", "member"]),
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	presenceStatus: Schema.NullOr(Schema.String),
	presenceLastSeenMs: Schema.NullOr(Schema.Number),
})
export type TeamMember = typeof TeamMember.Type

export const Model = Schema.Struct({ members: Schema.Array(TeamMember) })
export type Model = typeof Model.Type
