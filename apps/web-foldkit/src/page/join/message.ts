import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { JoinFailure, PublicOrganization } from "./model"

export const Message = defineMessageUnion({
	/** `null`: no public workspace has this slug. */
	SucceededFetchOrganization: { organization: Schema.NullOr(PublicOrganization) },
	FailedFetchOrganization: { reason: CommonReason },
	ClickedRetryLookup: {},
	ClickedSignIn: {},
	ClickedJoin: {},
	SucceededJoinWorkspace: {},
	FailedJoinWorkspace: { reason: JoinFailure },
	CompletedRedirectToSignIn: {},
	CompletedEnterAnimation: {},
})
export type Message = typeof Message.Type
