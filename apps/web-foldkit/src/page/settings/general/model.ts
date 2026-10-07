import { Schema } from "effect"
import * as Modal from "../../../ui/modal"

export const Model = Schema.Struct({
	orgSlug: Schema.String,
	/** `window.location.origin`, read once (the legacy page reads it on every render). */
	origin: Schema.String,
	/** Draft of the organization name. */
	name: Schema.String,
	/** The server name the draft was last synced from (legacy render-time adjustment). */
	syncedName: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	isSavingName: Schema.Boolean,
	isTogglingPublic: Schema.Boolean,
	isUploading: Schema.Boolean,
	deleteModal: Modal.Model,
	confirmationText: Schema.String,
	isDeleting: Schema.Boolean,
})
export type Model = typeof Model.Type
