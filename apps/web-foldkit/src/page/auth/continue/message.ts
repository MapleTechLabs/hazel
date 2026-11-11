import { defineMessageUnion } from "foldkit/message"
import { AuthFailure } from "../../../auth/flows"

export const Message = defineMessageUnion({
	LeftForProvider: {},
	FailedSignIn: { reason: AuthFailure },
})
export type Message = typeof Message.Type
