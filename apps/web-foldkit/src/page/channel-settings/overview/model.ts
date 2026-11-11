import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { Field, isInvalid } from "foldkit/fieldValidation"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../../ui/aria/interaction"

/** What can go wrong saving the channel, beyond the shared reasons. */
export const UpdateChannelFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type UpdateChannelFailure = typeof UpdateChannelFailure.Type

/** The save request: `Submitting` holds the values sent, which become the saved values on success. */
export const Submission = defineTaggedUnion({
	NotSubmitted: {},
	Submitting: { name: Schema.String, icon: Schema.NullOr(Schema.String) },
	Failed: { reason: UpdateChannelFailure },
})
export type Submission = typeof Submission.Type

/** The channel settings form: the saved values, the edited ones, and the save request. */
export const Form = Schema.Struct({
	savedName: Schema.String,
	savedIcon: Schema.NullOr(Schema.String),
	/** `NotValidated` until the user edits the name. */
	name: Field(Schema.String),
	icon: Schema.NullOr(Schema.String),
	submission: Submission,
})
export type Form = typeof Form.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	/** The form mounts once the channel loads, keyed by its id. */
	form: Schema.NullOr(Form),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const isDirty = (form: Form): boolean =>
	form.name.value !== form.savedName || form.icon !== form.savedIcon

export const isSubmitting = (form: Form): boolean => form.submission._tag === "Submitting"

export const canSave = (form: Form): boolean => isDirty(form) && !isInvalid(form.name) && !isSubmitting(form)

export const nameInputTarget = "channel-name-input"
export const saveButtonTarget = "channel-save"
