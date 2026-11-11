import { ChannelId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import { UpdateChannelFailure } from "./model"

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
	FailedUpdateChannel: { reason: UpdateChannelFailure },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type
