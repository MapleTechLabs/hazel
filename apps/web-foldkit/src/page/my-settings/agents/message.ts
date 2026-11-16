import { AgentGrantId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { CreatedToken, Grant, TokenAccess } from "./model"

export const CopyTarget = Schema.Literals(["McpUrl", "Token"])
export type CopyTarget = typeof CopyTarget.Type

export const Message = defineMessageUnion({
	SucceededFetchGrants: { grants: Schema.Array(Grant), mcpUrl: Schema.String },
	FailedFetchGrants: { reason: CommonReason },
	ClickedRetry: {},
	ClickedRevoke: { grantId: AgentGrantId },
	ClickedCancelRevoke: {},
	ClickedConfirmRevoke: { grantId: AgentGrantId },
	SucceededRevoke: { grantId: AgentGrantId },
	FailedRevoke: { reason: CommonReason },
	ChangedTokenName: { value: Schema.String },
	SelectedTokenAccess: { access: TokenAccess },
	ClickedCreateToken: {},
	SucceededCreateToken: { token: CreatedToken, grant: Grant },
	FailedCreateToken: { reason: CommonReason },
	ClickedDismissToken: {},
	ClickedCopy: { target: CopyTarget, text: Schema.String },
	SucceededCopy: { target: CopyTarget },
	FailedCopy: { target: CopyTarget },
})
export type Message = typeof Message.Type
