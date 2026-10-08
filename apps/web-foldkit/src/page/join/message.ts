import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { PublicOrganization } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchOrganization: { organization: Schema.NullOr(PublicOrganization) },
	FailedFetchOrganization: {},
	ClickedSignIn: {},
	ClickedJoin: {},
	SucceededJoinWorkspace: {},
	FailedJoinWorkspace: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	CompletedRedirectToSignIn: {},
	CompletedEnterAnimation: {},
})
export type Message = typeof Message.Type
