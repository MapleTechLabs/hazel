import type { Html, HtmlBuilder } from "foldkit/html"
import { IconEye, IconEyeSlash } from "../../icons"
import { iconButton } from "../../ui/button"
import { callout } from "../../ui/callout"
import { copyButton } from "../../ui/copy-button"

/** Port of `components/bots/bot-token-display.tsx`; the owning modal keeps `isVisible`. */

export interface BotTokenDisplayOptions<Message> {
	readonly token: string
	readonly isVisible: boolean
	readonly onToggleVisible: Message
	readonly onCopy: Message
}

export const botTokenDisplay = <Message>(
	h: HtmlBuilder<Message>,
	options: BotTokenDisplayOptions<Message>,
): Html =>
	h.div(
		[h.Class("flex flex-col gap-4")],
		[
			callout(h, { intent: "warning", title: "Save this token now." }, [
				"You won't be able to see it again after closing this dialog.",
			]),
			h.div(
				[h.Class("flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3")],
				[
					h.code(
						[h.Class("flex-1 truncate font-mono text-sm text-fg")],
						[options.isVisible ? options.token : "•".repeat(Math.min(40, options.token.length))],
					),
					iconButton(
						h,
						{
							label: options.isVisible ? "Hide token" : "Show token",
							onPress: options.onToggleVisible,
						},
						options.isVisible
							? IconEyeSlash(h, { attributes: { "data-slot": "icon" } })
							: IconEye(h, { attributes: { "data-slot": "icon" } }),
					),
					copyButton(h, { label: "Copy token", intent: "plain", onPress: options.onCopy }),
				],
			),
			h.p(
				[h.Class("text-muted-fg text-sm")],
				[
					"Use this token with the",
					" ",
					h.code([h.Class("rounded bg-muted px-1.5 py-0.5 font-mono text-xs")], ["@hazel/bot-sdk"]),
					" to authenticate your application.",
				],
			),
		],
	)
