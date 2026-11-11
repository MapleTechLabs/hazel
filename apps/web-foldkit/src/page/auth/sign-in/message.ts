import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { Provider } from "../../../auth/client"
import { SignInFailure } from "./model"

export const Message = defineMessageUnion({
	ClickedProvider: { provider: Schema.Literals(Provider) },
	ClickedPasskey: {},
	/** The browser is leaving for the provider or the app; nothing to render. */
	LeftForSignIn: {},
	/** `Cancelled` when the visitor closed the passkey prompt themselves. */
	FailedSignIn: { reason: SignInFailure },
	/** Desktop: sign in through the system browser. */
	ClickedBrowserSignIn: {},
	ClickedCancelBrowserSignIn: {},
	CompletedCancelBrowserSignIn: {},
	CompletedRetireBrowserSignIn: {},
})
export type Message = typeof Message.Type
