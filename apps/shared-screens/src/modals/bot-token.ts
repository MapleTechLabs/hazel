// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A new bot token, shown once (the deleted Foldkit `overlay/modal/bot-token-display.ts`): the warning,
 * the masked token with its reveal and copy buttons, and where to use it. Create and regenerate share it.
 */
import { Command, Component } from "@effect/ui"
import { Clipboard } from "@hazel/client-data/platform"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Schema } from "effect"
import { errorToast, successToast, toast } from "./feedback"
import { modalServices } from "./services"

/** Copies the token and says so, through the app's toasts. */
export class CopyToken extends Command.Service<CopyToken>()("hazel/modals/CopyToken", {
	args: { token: Schema.String },
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const { run } = yield* modalServices
			const clipboard = yield* Clipboard
			return ({ token }) =>
				run(
					clipboard.write(token).pipe(
						Effect.match({
							onSuccess: () => successToast("Token copied to clipboard"),
							onFailure: () => errorToast({ title: "Failed to copy token" }),
						}),
						Effect.flatMap(toast),
						Effect.as(Component.noop),
					),
				)
		}),
	)
}

/** The token block; `onCopy` is the owner's Message for the field's copy button. */
export const botTokenView = <Msg>(h: Hazel.H<Msg>, token: string, onCopy: Msg) =>
	h.stack.children(
		h.banner
			.tone("warning")
			.title("Save this token now.")
			.description("You won't be able to see it again after closing this dialog."),
		// HAZEL-GAP(po2-token-box): today the token sits in a muted box with no label, eye and copy as icon buttons.
		h.textField
			.label("Token")
			.value(TextField.set(TextField.empty, token))
			.readOnly()
			.monospace()
			.secret()
			.copyable()
			.on("copy", onCopy),
		// HAZEL-GAP(po2-inline-code): today `@hazel/bot-sdk` is inline code inside the sentence.
		h.text
			.tone("muted")
			.children("Use this token with the @hazel/bot-sdk to authenticate your application."),
	)
