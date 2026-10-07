import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"

/** The ChannelSettingsForm state (TanStack Form plus the icon `useState`s). */
export const Form = Schema.Struct({
	initialName: Schema.String,
	initialIcon: Schema.NullOr(Schema.String),
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
	/** TanStack Form `isDirty` stays true once the field changed. */
	isNameDirty: Schema.Boolean,
	isIconDirty: Schema.Boolean,
	isSubmitting: Schema.Boolean,
})
export type Form = typeof Form.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	/** The form mounts once the channel loads, keyed by its id. */
	form: Schema.NullOr(Form),
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

/** arktype `name: "1<string<101"` (exclusive bounds). */
export const isNameValid = (name: string) => name.length > 1 && name.length < 101

export const canSave = (form: Form) =>
	!(form.isNameDirty && !isNameValid(form.name)) && !form.isSubmitting && (form.isNameDirty || form.isIconDirty)

export const nameInputTarget = "channel-name-input"
export const saveButtonTarget = "channel-save"
