import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Field } from "foldkit/fieldValidation"
import { defineTaggedUnion } from "foldkit/schema"
import * as Interaction from "../../../ui/aria/interaction"
import * as ComboBox from "../../../ui/combo-box"
import * as Modal from "../../../ui/modal"
import * as DropZone from "../../shared/drop-zone"
import { CropImage } from "./crop"

/** The form's values (`useAppForm` defaultValues), and what `SaveProfile` sends. */
export const FormValues = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	timezone: Schema.NullOr(Schema.String),
})
export type FormValues = typeof FormValues.Type

/** `AvatarCropModal`'s image state: loading, ready (with the crop) or processing (saving). */
export const CropState = defineTaggedUnion({
	Idle: {},
	/** `loadId` tells this load's result apart from an earlier, cancelled pick's. */
	Loading: { loadId: Schema.Number },
	Ready: { image: CropImage },
	Processing: { image: CropImage },
})
export type CropState = typeof CropState.Type

/** The profile form's save. */
export const Save = defineTaggedUnion({
	Idle: {},
	Saving: {},
})
export type Save = typeof Save.Type

/** The avatar write in flight: an upload or a removal, never both. */
export const AvatarAction = defineTaggedUnion({
	Idle: {},
	Uploading: {},
	Resetting: {},
})
export type AvatarAction = typeof AvatarAction.Type

export const Model = Schema.Struct({
	/** The user the form was initialized for (the legacy `<form key={user?.id}>`). */
	userId: Schema.NullOr(UserId),
	/** The values the form started from, rebased on a successful save; the form is dirty when it differs. */
	defaults: FormValues,
	/** Validated as typed; untouched fields stay `NotValidated` and show no error. */
	firstName: Field(Schema.String),
	lastName: Field(Schema.String),
	selectedTimezone: Schema.NullOr(Schema.String),
	/** Read once by a Command at init; `null` until then. The form falls back to it without a stored timezone. */
	browserTimezone: Schema.NullOr(Schema.String),
	save: Save,
	timezone: ComboBox.Model,
	avatarAction: AvatarAction,
	dropZone: DropZone.Model,
	crop: CropState,
	/** The last crop image load started; each pick takes the next id. */
	cropLoadId: Schema.Number,
	cropModal: Modal.Model,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const AVATAR_BUTTON = "profile-picture"
export const FILE_INPUT_ID = "profile-picture-file"
