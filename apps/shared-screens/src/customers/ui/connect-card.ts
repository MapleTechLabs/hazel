// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A data source card (today's `web-foldkit/src/customers/ui/connect-card.ts`): what the source
 * brings, then its state: not connected, syncing with progress, connected, or failing with the way out.
 */
import type { CustomerProvider } from "@hazel/domain/customers"
import type { Hazel, TextTone } from "@hazel/ui/vocabulary/index"
import { Match } from "effect"
import { formatCount, formatRelative, type Instant } from "../data/format"
import { providerOf, sourceLabel } from "../data/providers"
import { sourceMark } from "./identity"

export type ConnectCardStatus<Msg> =
	| Readonly<{ _tag: "NotConnected"; onConnect: Msg }>
	| Readonly<{
			_tag: "Syncing"
			/** `invoices`. */
			step: string
			done: number
			total: number | null
			onCancel?: Msg
	  }>
	| Readonly<{
			_tag: "Connected"
			syncedAt: Instant | null
			/** `214 organizations · 1,862 users`. */
			summary: string
			onSyncNow?: Msg
	  }>
	| Readonly<{
			_tag: "Error"
			at: Instant
			/** `API key was revoked. Last good sync Nov 9, 18:42.` */
			message: string
			action: Readonly<{ label: string; onPress: Msg }>
	  }>

/** `● Connected · Synced 2h ago`: the state in its tone, then the rest muted. */
const stateLine = <Msg>(h: Hazel.H<Msg>, tone: TextTone, label: string, rest: string | null) =>
	h.stack
		.axis("horizontal")
		.density("snug")
		.align("center")
		.children(
			h.text
				.role("label")
				.dot()
				.strong(tone !== "muted")
				.tone(tone)
				.children(label),
			rest === null ? null : h.text.role("label").tone("muted").children(`· ${rest}`),
		)

const footer = <Msg>(h: Hazel.H<Msg>, status: ConnectCardStatus<Msg>, now: Instant) =>
	Match.valueTags(status, {
		NotConnected: (status) => [
			stateLine(h, "muted", "Not connected", null),
			h.button.label("Connect").icon("plus").size("small").on("press", status.onConnect),
		],
		Syncing: (status) => {
			const counts =
				status.total === null
					? `${formatCount(status.done)} ${status.step}`
					: `${formatCount(status.done)} of ${formatCount(status.total)} ${status.step}`
			const known = status.total !== null && status.total > 0
			return [
				h.stack
					.density("compact")
					.children(
						h.stack
							.axis("horizontal")
							.density("snug")
							.align("center")
							.children(
								h.progress.style("inline"),
								h.text.role("label").strong().tone("accent").children("Syncing…"),
								h.text.role("label").tone("muted").numeric().truncate().children(counts),
							),
						known
							? h.progress
									.value(status.done / (status.total ?? 1))
									.label(`Syncing ${status.step}`)
							: h.progress.indeterminate().label(`Syncing ${status.step}`),
					),
				status.onCancel === undefined
					? null
					: h.button.label("Cancel").variant("ghost").size("small").on("press", status.onCancel),
			]
		},
		Connected: (status) => [
			h.stack
				.density("tight")
				.children(
					stateLine(
						h,
						"success",
						"Connected",
						status.syncedAt === null
							? "Not synced yet"
							: `Synced ${formatRelative(status.syncedAt, now)}`,
					),
					h.text.role("label").tone("muted").numeric().children(status.summary),
				),
			status.onSyncNow === undefined
				? null
				: h.button
						.label("Sync now")
						.icon("refresh")
						.variant("outline")
						.size("small")
						.on("press", status.onSyncNow),
		],
		Error: (status) => [
			h.stack
				.density("tight")
				.children(
					stateLine(h, "danger", "Sync failed", formatRelative(status.at, now)),
					h.text.role("label").tone("muted").children(status.message),
				),
			h.button
				.label(status.action.label)
				.variant("outline")
				.size("small")
				.on("press", status.action.onPress),
		],
	})

export const connectCard = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{
		provider: CustomerProvider
		status: ConnectCardStatus<Msg>
		now: Instant
		description?: string
	}>,
) =>
	h.frame
		.surface("tile")
		.footer(...footer(h, options.status, options.now))
		.children(
			h.stack
				.axis("horizontal")
				.align("start")
				.density("cozy")
				.children(
					sourceMark(h, options.provider, { size: "md" }),
					h.stack.density("tight").children(
						h.heading.children(sourceLabel(options.provider)),
						h.text
							.role("label")
							.tone("muted")
							.children(options.description ?? providerOf(options.provider).blurb),
					),
				),
		)
