import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { AuthFailure } from "../../../auth/flows"

/**
 * `Invalid`: a submit was blocked by a missing name, so field errors show from then on (not while the
 * visitor is still typing). `Submitting` stays until the browser navigates away.
 */
export const Submission = defineTaggedUnion({
	NotSubmitted: {},
	Invalid: {},
	Submitting: {},
	Failed: { reason: AuthFailure },
})
export type Submission = typeof Submission.Type

export const Form = Schema.Struct({
	/** From the OAuth callback's redirect. */
	flowId: Schema.String,
	reference: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	submission: Submission,
})
export type Form = typeof Form.Type

/** `BrokenLink`: the callback's `flowId` or `reference` is missing, so the link is unusable. */
export const Model = defineTaggedUnion({
	BrokenLink: {},
	Ready: { form: Form },
})
export type Model = typeof Model.Type

export const isFirstNameMissing = (form: Form) => form.firstName.trim().length === 0
