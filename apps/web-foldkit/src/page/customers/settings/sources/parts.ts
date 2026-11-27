import type { Html, HtmlBuilder } from "foldkit/html"
import type { UserErrorMessage } from "~/lib/error-messages"
import { badge } from "../../../../ui/badge"
import { callout } from "../../../../ui/callout"
import { copyButton } from "../../../../ui/copy-button"
import { loader } from "../../../../ui/loader"
import { type StatusTone, statusDot } from "../../../../ui/status-dot"
import { textField } from "../../../../ui/text-field"
import { Message } from "./message"
import type { SourceStatus } from "./model"
import { apiUrl } from "~/config/server"

/** The Data sources views' shared pieces: status badges, record counts, error copy, fields, cards. */

export type H = HtmlBuilder<Message>

export const BACKEND_URL = apiUrl()

// STATUS

const STATUS = {
	connected: { label: "Connected", intent: "success", dot: "success" },
	syncing: { label: "Syncing", intent: "primary", dot: null },
	failing: { label: "Sync failing", intent: "danger", dot: "danger" },
	disconnected: { label: "Disconnected", intent: "secondary", dot: "neutral" },
} as const satisfies Record<SourceStatus, { label: string; intent: string; dot: StatusTone | null }>

export const statusBadge = (h: H, status: SourceStatus): Html => {
	const { label, intent, dot } = STATUS[status]
	return badge(h, { intent, isPill: true }, [
		dot === null ? loader(h, { ariaLabel: "Syncing", className: "size-3" }) : statusDot(h, { tone: dot }),
		label,
	])
}

// RECORDS, TIME, ERRORS (shared with the native Data sources page)

export {
	formatClock,
	formatDuration,
	statParts,
	syncErrorMessage,
	TRIGGER_LABEL,
} from "@hazel/shared-screens/customers/settings/sources/status"

/** A sync or connect failure (`UserErrorMessage`) as the kit callout's title and text. */
export const messageCallout = (
	h: H,
	options: Readonly<{
		message: UserErrorMessage
		intent?: "danger" | "info" | "success"
		actions?: ReadonlyArray<Html>
	}>,
): Html =>
	callout(
		h,
		{ intent: options.intent ?? "danger", title: options.message.title, actions: options.actions },
		options.message.description === undefined ? [] : [options.message.description],
	)

/** A small label over a value (the source card's columns, the connection card's rows). */
export const eyebrow = (h: H, text: string): Html =>
	h.span([h.Class("font-medium text-muted-fg text-xs")], [text])

/** `Accounts` `Contacts`: what a source writes. */
export const chips = (h: H, labels: ReadonlyArray<string>): Html =>
	h.div(
		[h.Class("flex flex-wrap gap-1.5")],
		labels.map((label) => badge(h, { intent: "outline" }, [label])),
	)

export const codeChips = (h: H, labels: ReadonlyArray<string>): Html =>
	h.div(
		[h.Class("flex flex-wrap gap-1.5")],
		labels.map((label) =>
			badge(h, { intent: "secondary", className: "font-mono font-normal" }, [h.code([], [label])]),
		),
	)

// FIELDS

/** A labelled text input; `isCode` sets ids and keys in monospace. */
export const formField = (
	h: H,
	options: Readonly<{
		id: string
		label: string
		description?: string
		value: string
		placeholder?: string
		onInput: (value: string) => Message
		isCode?: boolean
		isSecret?: boolean
		isDisabled?: boolean
		className?: string
	}>,
): Html =>
	textField(
		h,
		{
			id: options.id,
			value: options.value,
			onInput: options.onInput,
			isDisabled: options.isDisabled,
			className: options.className,
		},
		(parts) => [
			parts.label([options.label]),
			parts.input({
				placeholder: options.placeholder,
				className: options.isCode === true ? "font-mono text-sm" : undefined,
				attributes: [
					...(options.isSecret === true ? [h.Type("password")] : []),
					h.Attribute("autocomplete", "off"),
					h.Attribute("spellcheck", "false"),
				],
			}),
			...(options.description === undefined
				? []
				: [parts.description([options.description], { className: "text-xs/5" })]),
		],
	)

/** The webhook endpoint in a monospace box, with Copy. */
export const webhookUrlField = (h: H, url: string): Html =>
	h.div(
		[
			h.Class(
				"flex min-w-0 items-center gap-2 rounded-lg border border-border bg-secondary/40 py-1 pr-1 pl-3",
			),
		],
		[
			h.code([h.Class("min-w-0 flex-1 truncate font-mono text-fg text-xs"), h.Title(url)], [url]),
			copyButton(h, {
				label: "Copy",
				showLabel: true,
				size: "xs",
				onPress: Message.PressedCopyWebhookUrl({ url }),
			}),
		],
	)
