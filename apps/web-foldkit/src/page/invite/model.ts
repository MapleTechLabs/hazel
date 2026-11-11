import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"

export const Preview = Schema.Struct({
	organizationName: Schema.String,
	organizationLogoUrl: Schema.NullOr(Schema.String),
	email: Schema.String,
	status: Schema.Literals(["Pending", "Accepted", "Revoked", "Expired"]),
})
export type Preview = typeof Preview.Type

/** Why `invitation.preview` failed; a malformed token reads as `NotFound`. */
export const PreviewFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type PreviewFailure = typeof PreviewFailure.Type

/** Why `invitation.accept` failed, beyond the shared reasons. */
export const AcceptFailure = Schema.Union([
	Schema.Literals(["EmailMismatch", "NoLongerValid", "WorkspaceGone"]),
	CommonReason,
])
export type AcceptFailure = typeof AcceptFailure.Type

/** `invitation.preview`: the invite link's organization and status. */
export const Lookup = defineTaggedUnion({
	Loading: {},
	Loaded: { preview: Preview },
	NotFound: {},
	Failed: { reason: CommonReason },
})
export type Lookup = typeof Lookup.Type

/** Accepting stays in flight until the browser loads the workspace. */
export const Acceptance = defineTaggedUnion({
	Idle: {},
	Accepting: {},
	Failed: { reason: AcceptFailure },
})
export type Acceptance = typeof Acceptance.Type

export const Model = Schema.Struct({
	token: Schema.String,
	lookup: Lookup,
	acceptance: Acceptance,
})
export type Model = typeof Model.Type
