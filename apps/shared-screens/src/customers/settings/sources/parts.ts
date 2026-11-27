// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The Data sources views' shared pieces (today's `web-foldkit/.../settings/sources/parts.ts` and the
 * helpers the source detail reads from its overview): status badges, eyebrows, chips, what a source
 * adds, the failing source's banner and its connect button.
 */
import type { CustomerProvider } from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { BadgeTone } from "@hazel/ui/vocabulary/options"
import { formatDate, formatRelative } from "../../data/format"
import { providerOf } from "../../data/providers"
import type { ConnectionRow } from "./rows"
import { formatClock, type SourceStatus, syncErrorMessage } from "./status"

/** `/:org/customers/settings/sources/:provider`. */
export const sourceDetailHref = (orgSlug: string, provider: CustomerProvider): string =>
	`/${orgSlug}/customers/settings/sources/${provider}`

const STATUS = {
	connected: { label: "Connected", tone: "success" },
	syncing: { label: "Syncing", tone: "accent" },
	failing: { label: "Sync failing", tone: "danger" },
	disconnected: { label: "Disconnected", tone: "neutral" },
} as const satisfies Record<SourceStatus, { label: string; tone: BadgeTone }>

/** The state as a pill in its tone. */
export const statusBadge = <Msg>(h: Hazel.H<Msg>, status: SourceStatus) =>
	// HAZEL-GAP(p4-badge-status-mark): today's pill leads with a status dot (a spinner while syncing).
	h.badge.tone(STATUS[status].tone).pill().label(STATUS[status].label)

export const comingSoonBadge = <Msg>(h: Hazel.H<Msg>) => h.badge.pill().label("Coming soon")

/** A small label over a value (a card's columns). */
export const eyebrow = <Msg>(h: Hazel.H<Msg>, text: string) =>
	h.text.role("caption").tone("muted").strong().children(text)

/** `Accounts` `Contacts`: what a source writes. */
export const chips = <Msg>(h: Hazel.H<Msg>, labels: ReadonlyArray<string>) =>
	h.stack
		.axis("horizontal")
		.density("snug")
		.wrap()
		.children(...labels.map((label) => h.badge.style("outline").label(label)))

/** "Adds to the model": what connecting brings. */
export const addsList = <Msg>(h: Hazel.H<Msg>, provider: CustomerProvider) =>
	h.stack.density("snug").children(
		...providerOf(provider).adds.map((item) =>
			// HAZEL-GAP(p4-inline-text): today the check is success ink and the detail runs on after the title.
			h.stack
				.axis("horizontal")
				.density("snug")
				.align("start")
				.children(
					h.icon.name("check"),
					h.text.role("label").strong().children(item.title),
					h.text.role("label").tone("muted").children(item.detail),
				),
		),
	)

/** Connect (or reconnect a disconnected source); "Coming soon" while it has no integration. */
export const connectButton = <Msg>(
	h: Hazel.H<Msg>,
	provider: CustomerProvider,
	connection: ConnectionRow | undefined,
	onConnect: Msg,
) => {
	const descriptor = providerOf(provider)
	return descriptor.isAvailable
		? h.button
				.label(`${connection === undefined ? "Connect" : "Reconnect"} ${descriptor.name}`)
				.icon("plus")
				.variant("outline")
				.size("small")
				.on("press", onConnect)
		: h.button.label("Coming soon").variant("outline").size("small").disabled()
}

/** The failing source's banner: what broke, in our words, the last good sync and the way out. */
export const errorBanner = <Msg>(
	h: Hazel.H<Msg>,
	connection: ConnectionRow,
	options: Readonly<{
		nowMs: number
		/** "View failed run" (the overview's way to the detail); null: none. */
		onViewRun: Msg | null
		/** "Reconnect", for an admin when the key was refused; null: none. */
		onReconnect: Msg | null
	}>,
) => {
	const name = providerOf(connection.provider).name
	const error = connection.lastError
	const message =
		error === null
			? { title: "Sync failing", description: "The last syncs failed. Syncs retry with backoff." }
			: syncErrorMessage(error, name)
	const now = new Date(options.nowMs)
	const lastGood =
		connection.lastSuccessAtMs === null
			? "No sync has succeeded yet."
			: `Last successful sync ${formatDate(new Date(connection.lastSuccessAtMs), { now })}, ${formatClock(connection.lastSuccessAtMs)} (${formatRelative(new Date(connection.lastSuccessAtMs), now)}).`
	const { onViewRun, onReconnect } = options
	return h.banner
		.tone("danger")
		.title(message.title)
		.description(`${message.description} ${lastGood}`)
		.actions(
			onViewRun === null
				? null
				: h.button.label("View failed run").variant("ghost").size("small").on("press", onViewRun),
			onReconnect === null || error?.code !== "auth"
				? null
				: h.button.label("Reconnect").size("small").on("press", onReconnect),
		)
}
