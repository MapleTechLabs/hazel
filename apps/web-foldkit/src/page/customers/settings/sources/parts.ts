import type * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import type { UserErrorMessage } from "~/lib/error-messages"
import { formatCount } from "../../../../customers/format"
import { IconCopy, IconWarning } from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { loader } from "../../../../ui/loader"
import { textField } from "../../../../ui/text-field"
import { Message } from "./message"
import type { SourceStatus } from "./model"

/** The Data sources views' shared pieces: status badges, record counts, error copy, fields, cards. */

export type H = HtmlBuilder<Message>

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL

// STATUS

const STATUS = {
	connected: { label: "Connected", intent: "success", dot: "bg-success-subtle-fg" },
	syncing: { label: "Syncing", intent: "primary", dot: null },
	failing: { label: "Sync failing", intent: "danger", dot: "bg-danger-subtle-fg" },
	disconnected: { label: "Disconnected", intent: "secondary", dot: "bg-muted-fg" },
} as const satisfies Record<SourceStatus, { label: string; intent: string; dot: string | null }>

export const statusBadge = (h: H, status: SourceStatus): Html => {
	const { label, intent, dot } = STATUS[status]
	return badge(h, { intent, isPill: true }, [
		dot === null
			? loader(h, { ariaLabel: "Syncing", className: "size-3" })
			: h.span([h.AriaHidden(true), h.Class(twMerge("size-1.5 rounded-full", dot))]),
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

/** A danger (or, for `tone: "info"`, neutral) callout with a title, a description and actions. */
export const callout = (
	h: H,
	options: Readonly<{
		message: UserErrorMessage
		tone?: "danger" | "info" | "success"
		actions?: ReadonlyArray<Html>
		children?: ReadonlyArray<Html>
	}>,
): Html => {
	const tone = options.tone ?? "danger"
	return h.div(
		[
			h.Role(tone === "danger" ? "alert" : "status"),
			h.Class(
				twMerge(
					"flex flex-wrap items-start gap-3 rounded-lg px-3 py-3",
					tone === "danger" && "bg-danger-subtle text-danger-subtle-fg",
					tone === "info" && "bg-info-subtle text-info-subtle-fg",
					tone === "success" && "bg-success-subtle text-success-subtle-fg",
				),
			),
		],
		[
			IconWarning(h, { className: "mt-0.5 size-4 shrink-0" }),
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col gap-1")],
				[
					h.p([h.Class("font-medium text-sm")], [options.message.title]),
					...(options.message.description === undefined
						? []
						: [h.p([h.Class("text-sm opacity-90")], [options.message.description])]),
					...(options.children ?? []),
				],
			),
			...(options.actions === undefined || options.actions.length === 0
				? []
				: [h.div([h.Class("flex shrink-0 items-center gap-2")], [...options.actions])]),
		],
	)
}

// LAYOUT

export const card = (h: H, children: ReadonlyArray<Html>, className?: string): Html =>
	h.section(
		[
			h.Class(
				twMerge(
					"flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5",
					className,
				),
			),
		],
		[...children],
	)

export const cardHeader = (h: H, title: string, description?: string, aside?: Html): Html =>
	h.header(
		[h.Class("flex items-start justify-between gap-4")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					h.h2([h.Class("font-semibold text-base/6 text-fg")], [title]),
					...(description === undefined
						? []
						: [h.p([h.Class("text-muted-fg text-sm")], [description])]),
				],
			),
			...(aside === undefined ? [] : [aside]),
		],
	)

/** A small uppercase label over a value (the source card's columns, the connection card's rows). */
export const eyebrow = (h: H, text: string): Html =>
	h.span([h.Class("font-medium text-muted-fg text-xs uppercase tracking-wide")], [text])

/** `Accounts` `Contacts`: what a source writes. */
export const chips = (h: H, labels: ReadonlyArray<string>): Html =>
	h.div(
		[h.Class("flex flex-wrap gap-1.5")],
		labels.map((label) =>
			h.span([h.Class("rounded-md border border-border px-1.5 py-0.5 text-fg text-xs")], [label]),
		),
	)

export const codeChips = (h: H, labels: ReadonlyArray<string>): Html =>
	h.div(
		[h.Class("flex flex-wrap gap-1.5")],
		labels.map((label) =>
			h.code([h.Class("rounded-md bg-secondary px-1.5 py-0.5 font-mono text-fg text-xs")], [label]),
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
			...(options.description === undefined ? [] : [parts.description([options.description])]),
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
			button(h, { intent: "outline", size: "xs", onPress: Message.PressedCopyWebhookUrl({ url }) }, [
				IconCopy(h, { attributes: { "data-slot": "icon" } }),
				"Copy",
			]),
		],
	)
