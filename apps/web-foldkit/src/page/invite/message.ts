import { defineMessageUnion } from "foldkit/message"
import { AcceptFailure, Preview, PreviewFailure } from "./model"

export const Message = defineMessageUnion({
	SucceededFetchPreview: { preview: Preview },
	FailedFetchPreview: { reason: PreviewFailure },
	ClickedRetryPreview: {},
	ClickedSignIn: {},
	ClickedAccept: {},
	ClickedSignOut: {},
	/** The browser is loading the workspace or sign-in. */
	LeftPage: {},
	FailedAccept: { reason: AcceptFailure },
})
export type Message = typeof Message.Type
