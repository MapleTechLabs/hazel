import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { UserErrorMessage } from "~/lib/error-messages"
import { formatCount } from "../../../../customers/format"

import { badge } from "../../../../ui/badge"
import { callout } from "../../../../ui/callout"
import { copyButton } from "../../../../ui/copy-button"
import { loader } from "../../../../ui/loader"
import { type StatusTone, statusDot } from "../../../../ui/status-dot"
import { textField } from "../../../../ui/text-field"
import { Message } from "./message"
import type { SourceStatus } from "./model"

/** The Data sources views' shared pieces: status badges, record counts, error copy, fields, cards. */

export type H = HtmlBuilder<Message>

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

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

export const comingSoonBadge = (h: H): Html =>
	badge(h, { intent: "secondary", isPill: true }, ["Coming soon"])

// RECORDS

const STAT_LABELS = [
	["accounts", "account", "accounts"],
	["contacts", "contact", "contacts"],
	["subscriptions", "subscription", "subscriptions"],
	["invoices", "invoice", "invoices"],
	["events", "event", "events"],
	["activityDays", "activity day", "activity days"],
	["metricDays", "metric day", "metric days"],
	["unmatched", "unmatched", "unmatched"],
] as const satisfies ReadonlyArray<readonly [keyof Customers.SyncStats, string, string]>

/** `412 accounts`, `3,180 contacts`, …: the counts a sync wrote, zeros left out. */
export const statParts = (stats: Customers.SyncStats): ReadonlyArray<string> =>
	STAT_LABELS.filter(([key]) => stats[key] > 0).map(
		([key, one, many]) => `${formatCount(stats[key])} ${stats[key] === 1 ? one : many}`,
	)

// TIME

/** `11:20`, local. */
export const formatClock = (ms: number): string =>
	new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms)

/** `0.4s`, `41s`, `6m 12s`, `1h 4m`. */
export const formatDuration = (ms: number): string => {
	const seconds = ms / 1000
	if (seconds < 1) return `${Math.max(0.1, Math.round(seconds * 10) / 10)}s`
	if (seconds < 60) return `${Math.round(seconds)}s`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const TRIGGER_LABEL = {
	schedule: "Schedule",
	webhook: "Webhook",
	manual: "Manual",
	backfill: "Backfill",
} as const satisfies Record<Customers.SyncTrigger, string>

// ERRORS

/**
 * A failed sync in our words, from its code and HTTP status. The error's `message` is the
 * provider's text and is never shown.
 */
export const syncErrorMessage = (error: Customers.SyncError, name: string): UserErrorMessage => {
	const status = error.httpStatus === null ? "" : ` (HTTP ${error.httpStatus})`
	switch (error.code) {
		case "auth":
			return {
				title: "API key revoked or invalid",
				description: `${name} refused the key${status}. Syncing is paused until you reconnect.`,
			}
		case "rate_limited":
			return {
				title: `Rate limited by ${name}`,
				description: `${name} asked Hazel to slow down${status}. Syncs retry with backoff.`,
			}
		case "provider":
			return {
				title: `${name} returned an error`,
				description: `The request failed on ${name}'s side${status}. Syncs retry with backoff.`,
			}
		case "network":
			return {
				title: `Couldn't reach ${name}`,
				description: "The connection failed before an answer. Syncs retry with backoff.",
			}
		case "internal":
			return {
				title: "Sync failed in Hazel",
				description: "Something broke on our side. Syncs retry with backoff.",
			}
	}
}

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
