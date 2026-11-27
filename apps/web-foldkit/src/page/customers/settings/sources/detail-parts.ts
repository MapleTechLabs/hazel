import type { CustomerProvider } from "@hazel/domain/customers"
import type { Html } from "foldkit/html"
import { formatDate, formatRelative } from "../../../../customers/format"
import { providerOf } from "../../../../customers/providers"
import { IconCheck, IconPlus } from "../../../../icons"
import { button } from "../../../../ui/button"
import { statusDot } from "../../../../ui/status-dot"
import { Message } from "./message"
import { formatClock, type H, messageCallout, syncErrorMessage } from "./parts"
import type { ConnectionRow } from "./queries"

/** What the source detail drew from the overview before it went native: the banner, adds, connect. */

export interface Context {
	readonly orgSlug: string
	readonly nowMs: number
	readonly isAdmin: boolean
}

/** The failing source's banner: what broke, in our words, and the way out. */
export const errorBanner = (h: H, connection: ConnectionRow, context: Context): Html => {
	const descriptor = providerOf(connection.provider)
	const error = connection.lastError
	const message =
		error === null
			? { title: "Sync failing", description: "The last syncs failed. Syncs retry with backoff." }
			: syncErrorMessage(error, descriptor.name)
	const lastGood =
		connection.lastSuccessAtMs === null
			? "No sync has succeeded yet."
			: `Last successful sync ${formatDate(new Date(connection.lastSuccessAtMs), { now: new Date(context.nowMs) })}, ${formatClock(connection.lastSuccessAtMs)} (${formatRelative(new Date(connection.lastSuccessAtMs), new Date(context.nowMs))}).`
	return messageCallout(h, {
		message: { title: message.title, description: `${message.description} ${lastGood}` },
		actions: [
			...(context.isAdmin && error?.code === "auth"
				? [
						button(
							h,
							{
								intent: "primary",
								size: "sm",
								onPress: Message.PressedReconnect({ connectionId: connection.id }),
							},
							["Reconnect"],
						),
					]
				: []),
		],
	})
}

const detail = (h: H, text: string): Html =>
	h.p([h.Class("truncate text-muted-fg text-xs max-sm:whitespace-normal")], [text])

/** The sync mode, and whether the webhook can be verified (its signing secret is stored). */
export const syncModeLines = (h: H, connection: ConnectionRow): ReadonlyArray<Html> => {
	const descriptor = providerOf(connection.provider)
	return [
		// Wraps: a sentence, not a value to clip.
		h.p([h.Class("font-medium text-fg text-sm")], [descriptor.syncMode]),
		descriptor.webhook === null
			? detail(h, "No webhooks")
			: h.p(
					[h.Class("flex items-center gap-1.5 text-muted-fg text-xs")],
					[
						statusDot(h, { tone: connection.hasWebhookSecret ? "success" : "warning" }),
						connection.hasWebhookSecret ? "Signing secret set" : "Signing secret missing",
					],
				),
	]
}

/** "Adds to the model": what connecting brings. */
export const addsList = (h: H, provider: CustomerProvider): Html =>
	h.ul(
		[h.Class("flex flex-col gap-1.5")],
		providerOf(provider).adds.map((item) =>
			h.li(
				[h.Class("flex items-start gap-2 text-sm")],
				[
					IconCheck(h, { className: "mt-0.5 size-3.5 shrink-0 text-success-subtle-fg" }),
					h.span(
						[],
						[
							h.span([h.Class("font-medium text-fg")], [item.title]),
							h.span([h.Class("text-muted-fg")], [` ${item.detail}`]),
						],
					),
				],
			),
		),
	)

/** Connect (or reconnect a disconnected source); "Coming soon" while it has no integration. */
export const connectButton = (
	h: H,
	provider: CustomerProvider,
	connection: ConnectionRow | undefined,
): Html => {
	const descriptor = providerOf(provider)
	return descriptor.isAvailable
		? button(
				h,
				{
					intent: "outline",
					size: "sm",
					// The overview card's grid would otherwise stretch it across a narrow card.
					className: "justify-self-start",
					onPress: Message.PressedConnect({ provider }),
				},
				[
					IconPlus(h, { attributes: { "data-slot": "icon" } }),
					`${connection === undefined ? "Connect" : "Reconnect"} ${descriptor.name}`,
				],
			)
		: button(h, { intent: "outline", size: "sm", className: "justify-self-start", isDisabled: true }, [
				"Coming soon",
			])
}
