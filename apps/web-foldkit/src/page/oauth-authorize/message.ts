import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { ApproveFailure, ClientSummary } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchClient: { client: ClientSummary },
	FoundInvalidRequest: {},
	FailedFetchClient: { reason: CommonReason },
	ClickedRetryRequest: {},
	ClickedSignIn: {},
	ClickedApprove: {},
	ClickedDeny: {},
	FailedAuthorize: { reason: ApproveFailure },
	/** The browser is loading the client's redirect or sign-in. */
	LeftPage: {},
})
export type Message = typeof Message.Type
