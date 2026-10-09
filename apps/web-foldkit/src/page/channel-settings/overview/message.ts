import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../../overlay/toasts"
import * as Interaction from "../../../ui/aria/interaction"

export const LoadedChannel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
})

export const Message = defineMessageUnion({
	UpdatedChannel: { channel: Schema.NullOr(LoadedChannel) },
	ChangedName: { name: Schema.String },
	ClearedIcon: {},
	SubmittedForm: {},
	SucceededUpdateChannel: {},
	FailedUpdateChannel: { toast: ToastRequest },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
