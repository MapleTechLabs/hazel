import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../overlay/toasts"
import { PublicOrganization } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchOrganization: { organization: Schema.NullOr(PublicOrganization) },
	FailedFetchOrganization: {},
	ClickedSignIn: {},
	ClickedJoin: {},
	SucceededJoinWorkspace: {},
	FailedJoinWorkspace: { toast: ToastRequest },
	CompletedRedirectToSignIn: {},
	CompletedEnterAnimation: {},
})
export type Message = typeof Message.Type
