import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { PublicOrganization } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchOrganization: { organization: Schema.NullOr(PublicOrganization) },
	ClickedSignIn: {},
	ClickedJoin: {},
	SucceededJoinWorkspace: {},
	FailedJoinWorkspace: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	CompletedRedirectToSignIn: {},
	CompletedNavigateToWorkspace: {},
	CompletedEnterAnimation: {},
})
export type Message = typeof Message.Type
