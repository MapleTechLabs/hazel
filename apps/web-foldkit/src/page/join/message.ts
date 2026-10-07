import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { MotionMessage } from "../onboarding/motion"
import { PublicOrganization } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchOrganization: { organization: Schema.NullOr(PublicOrganization) },
	ClickedSignIn: {},
	ClickedJoin: {},
	SucceededJoinWorkspace: {},
	FailedJoinWorkspace: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	CompletedRedirectToSignIn: {},
	CompletedNavigateToWorkspace: {},
	GotMotionMessage: { message: MotionMessage },
})
export type Message = typeof Message.Type
