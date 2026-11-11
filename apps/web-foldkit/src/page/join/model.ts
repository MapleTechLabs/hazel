import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

export const PublicOrganization = Schema.Struct({
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
	memberCount: Schema.Number,
})
export type PublicOrganization = typeof PublicOrganization.Type

/**
 * `organization.getBySlugPublic`: `NotFound` is an unknown slug or a workspace without public
 * invites; `Failed` is the lookup itself failing, which can be retried.
 */
export const Lookup = defineTaggedUnion({
	Loading: {},
	Found: { organization: PublicOrganization },
	NotFound: {},
	Failed: { reason: CommonReason },
})
export type Lookup = typeof Lookup.Type

/** Why `organization.joinViaPublicInvite` failed, beyond the shared reasons. */
export const JoinFailure = Schema.Union([
	Schema.Literals(["NotFound", "PublicInvitesDisabled", "AlreadyMember"]),
	CommonReason,
])
export type JoinFailure = typeof JoinFailure.Type

export const Model = Schema.Struct({
	slug: Schema.String,
	lookup: Lookup,
	isJoining: Schema.Boolean,
})
export type Model = typeof Model.Type
