import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { AuthFailure } from "../../../auth/flows"

export const Message = defineMessageUnion({
	ChangedFirstName: { value: Schema.String },
	ChangedLastName: { value: Schema.String },
	SubmittedRegistration: {},
	/** The account exists and the browser is loading the app. */
	LeftForApp: {},
	FailedRegistration: { reason: AuthFailure },
})
export type Message = typeof Message.Type
