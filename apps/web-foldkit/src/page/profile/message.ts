import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ProfileUser } from "./model"

export const Message = defineMessageUnion({
	UpdatedProfileUser: { user: Schema.NullOr(ProfileUser) },
})
export type Message = typeof Message.Type
