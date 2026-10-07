import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCopy, IconEye, IconEyeSlash, IconWarning } from "../../icons"
import { button } from "../../ui/button"

/** Port of `components/bots/bot-token-display.tsx`; the owning modal keeps `isVisible`. */

export interface BotTokenDisplayOptions<Message> {
	readonly token: string
	readonly isVisible: boolean
	readonly onToggleVisible: Message
	readonly onCopy: Message
}

export const botTokenDisplay = <Message>(h: HtmlBuilder<Message>, options: BotTokenDisplayOptions<Message>): Html =>
	h.div(
		[h.Class("flex flex-col gap-4")],
		[
			h.div(
				[h.Class("flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4")],
				[
					IconWarning(h, { className: "mt-0.5 size-5 shrink-0 text-warning" }),
					h.p(
						[h.Class("text-sm")],
						[
							h.span([h.Class("font-medium text-warning")], ["Save this token now."]),
							" ",
							h.span([h.Class("text-fg")], ["You won't be able to see it again after closing this dialog."]),
						],
					),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3")],
				[
					h.code(
						[h.Class("flex-1 truncate font-mono text-sm text-fg")],
						[options.isVisible ? options.token : "•".repeat(Math.min(40, options.token.length))],
					),
					button(
						h,
						{
							size: "sm",
							intent: "plain",
							onPress: options.onToggleVisible,
							attributes: [h.AriaLabel(options.isVisible ? "Hide token" : "Show token")],
						},
						[options.isVisible ? IconEyeSlash(h, { className: "size-4" }) : IconEye(h, { className: "size-4" })],
					),
					button(h, { size: "sm", intent: "plain", onPress: options.onCopy, attributes: [h.AriaLabel("Copy token")] }, [
						IconCopy(h, { className: "size-4" }),
					]),
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
