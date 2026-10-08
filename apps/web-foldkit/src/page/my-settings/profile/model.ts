import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Interaction from "../../../ui/aria/interaction"
import * as ComboBox from "../../../ui/combo-box"
import * as Modal from "../../../ui/modal"
import { CropImage } from "./crop"

/** The form's values (`useAppForm` defaultValues and state). */
export const FormValues = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	timezone: Schema.NullOr(Schema.String),
})
export type FormValues = typeof FormValues.Type

/** `AvatarCropModal`'s image state: loading, ready (with the crop) or processing (saving). */
export const CropState = Schema.Union([
	Schema.TaggedStruct("Idle", {}),
	/** `loadId` tells this load's result apart from an earlier, cancelled pick's. */
	Schema.TaggedStruct("Loading", { loadId: Schema.Number }),
	Schema.TaggedStruct("Ready", { image: CropImage }),
	Schema.TaggedStruct("Processing", { image: CropImage }),
])
export type CropState = typeof CropState.Type

export const Model = Schema.Struct({
	/** The user the form was initialized for (the legacy `<form key={user?.id}>`). */
	userId: Schema.NullOr(UserId),
	defaults: FormValues,
	values: FormValues,
	/** TanStack Form: `isDirty` stays true once any field changed; validation starts on the first change. */
	isDirty: Schema.Boolean,
	/** Read once by a Command at init; `null` until then. The form falls back to it without a stored timezone. */
	browserTimezone: Schema.NullOr(Schema.String),
	isSubmitting: Schema.Boolean,
	timezone: ComboBox.Model,
	isUploading: Schema.Boolean,
	isResetting: Schema.Boolean,
	isDropTarget: Schema.Boolean,
	dragDepth: Schema.Number,
	crop: CropState,
	/** The last crop image load started; each pick takes the next id. */
	cropLoadId: Schema.Number,
	cropModal: Modal.Model,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const AVATAR_BUTTON = "profile-picture"
export const FILE_INPUT_ID = "profile-picture-file"
